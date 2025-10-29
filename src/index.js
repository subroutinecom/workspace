#!/usr/bin/env node

const { Command, InvalidOptionArgumentError } = require("commander");
const path = require("path");
const fs = require("fs");
const os = require("os");
const {
  discoverRepoRoot,
  findWorkspaceDir,
  buildDefaultConfig,
  writeConfig,
  loadConfig,
  resolveConfig,
  ensureTemplate,
  configExists,
  DEFAULT_CONFIG_FILENAME,
} = require("./config");
const {
  runCommand,
  runCommandStreaming,
  ensureDir,
  writeJson,
  sleep,
} = require("./utils");
const {
  imageExists,
  buildImage,
  containerExists,
  containerRunning,
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  removeVolumes,
  inspectContainer,
} = require("./docker");
const { ensureWorkspaceState, removeWorkspaceState, listWorkspaceNames } = require("./state");
const pkg = require("../package.json");

const program = new Command();
program.name("workspace").description("Self-contained CLI for Docker-in-Docker workspaces").version(pkg.version);

const parseInteger = (value, dummyPrevious) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new InvalidOptionArgumentError("Not a number.");
  }
  return parsed;
};

const withConfig = async (options = {}, workspaceName) => {
  const configFilename = options.config || DEFAULT_CONFIG_FILENAME;

  // Find the workspace directory by searching upward for .workspace.yml
  const workspaceDir = await findWorkspaceDir(options);

  // Load and resolve config
  const raw = await loadConfig(workspaceDir, configFilename);
  const resolved = await resolveConfig(raw, workspaceDir, {
    workspaceNameOverride: workspaceName,
  });

  return { configDir: workspaceDir, raw, resolved };
};

/**
 * Get minimal workspace info without requiring config file.
 * Tries to load config if available, otherwise falls back to workspace name only.
 * This allows commands like stop, destroy, logs to work even when .workspace.yml is missing.
 */
const getWorkspaceInfo = async (workspaceName, options = {}) => {
  const containerName = `workspace-${workspaceName}`;
  const stateDir = path.join(os.homedir(), ".workspaces", "state", workspaceName);
  const keyPath = path.join(stateDir, "ssh", "id_ed25519");

  // Try to load config if available (but don't throw if missing)
  let configInfo = null;
  try {
    configInfo = await withConfig(options, workspaceName);
  } catch (err) {
    // Config not found - that's okay for many commands
  }

  return {
    name: workspaceName,
    containerName,
    keyPath,
    stateDir,
    configInfo, // Will be null if config not found
  };
};

/**
 * Load workspace state from the state file (without requiring config)
 */
const loadWorkspaceState = async (workspaceName) => {
  const STATE_FILE = path.join(os.homedir(), ".workspaces", "state", "state.json");
  try {
    const stateData = await fs.promises.readFile(STATE_FILE, "utf8");
    const state = JSON.parse(stateData);
    return state.workspaces[workspaceName] || null;
  } catch (err) {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
};

const ensureSshKey = async (resolved) => {
  const { keyPath } = resolved.workspace.state;
  const keyDir = path.dirname(keyPath);
  await ensureDir(keyDir);
  const pubPath = `${keyPath}.pub`;
  if (!fs.existsSync(keyPath)) {
    await runCommand("ssh-keygen", [
      "-t",
      "ed25519",
      "-f",
      keyPath,
      "-N",
      "",
      "-C",
      `workspace-${resolved.workspace.name}`,
    ]);
  }
  const publicKey = fs.readFileSync(pubPath, "utf8").trim();
  return {
    privateKey: keyPath,
    publicKey,
    publicKeyPath: pubPath,
  };
};

const writeRuntimeMetadata = async (resolved, runtime) => {
  const runtimeData = {
    workspace: {
      name: resolved.workspace.name,
      repo: {
        remote: resolved.workspace.repo.remote,
        branch: resolved.workspace.repo.branch,
        cloneArgs: resolved.workspace.repo.cloneArgs,
      },
    },
    ssh: {
      port: runtime.sshPort,
    },
    forwards: runtime.forwards.map((port) => ({
      port: port,
    })),
    bootstrap: {
      scripts: resolved.workspace.bootstrap.scripts,
      configDirRelative: resolved.workspace.bootstrap.configDirRelative,
    },
  };
  await writeJson(resolved.workspace.state.runtimeConfigPath, runtimeData);
};

const ensureImage = async (resolved, { rebuild = false, noCache = false } = {}) => {
  const imageTag = resolved.workspace.imageTag;
  const buildContext = resolved.workspace.buildContext;

  const imagePresent = await imageExists(imageTag);
  if (!imagePresent || rebuild) {
    console.log(`Building workspace image ${imageTag}...`);
    await buildImage(imageTag, buildContext, { noCache });
  }
};

const waitForContainer = async (containerName, timeoutMs = 15000) => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      await runCommand("docker", ["exec", containerName, "true"]);
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`Timed out waiting for container ${containerName} to become ready`);
};

const computeVolumes = (containerName) => ({
  home: `${containerName}-home`,
  docker: `${containerName}-docker`,
  cache: `${containerName}-cache`,
});

const assembleRunArgs = (resolved, sshKeyInfo, runtime, options = {}) => {
  const runArgs = [
    "--detach",
    "--privileged",
    "--name",
    resolved.workspace.containerName,
    "--hostname",
    resolved.workspace.containerName,
    "-p",
    `${runtime.sshPort}:22`,
  ];

  const volumes = computeVolumes(resolved.workspace.containerName);

  const addEnv = (key, value) => {
    if (value !== undefined && value !== null && value !== "") {
      runArgs.push("-e", `${key}=${value}`);
    }
  };

  addEnv("SSH_PUBLIC_KEY", sshKeyInfo.publicKey);
  addEnv("WORKSPACE_RUNTIME_CONFIG", "/workspace/config/runtime.json");
  addEnv("WORKSPACE_SOURCE_DIR", "/workspace/source");
  addEnv("HOST_HOME", "/host/home");
  addEnv("WORKSPACE_ASSIGNED_SSH_PORT", runtime.sshPort);
  addEnv("WORKSPACE_REPO_URL", resolved.workspace.repo.remote);
  addEnv("WORKSPACE_REPO_BRANCH", resolved.workspace.repo.branch);

  runArgs.push(
    "-v",
    `${resolved.workspace.state.runtimeConfigPath}:/workspace/config/runtime.json:ro`,
  );
  runArgs.push(
    "-v",
    `${resolved.workspace.configDir}:/workspace/source:ro`,
  );

  // Mount user scripts directory if it exists
  const userScriptsDir = path.join(os.homedir(), ".workspaces", "userscripts");
  if (fs.existsSync(userScriptsDir)) {
    runArgs.push(
      "-v",
      `${userScriptsDir}:/workspace/userscripts:ro`,
    );
  }

  // Always mount host home directory
  const hostHome = os.homedir();
  if (fs.existsSync(hostHome)) {
    runArgs.push("-v", `${hostHome}:/host/home:ro`);
  }

  // Mount SSH agent if available, otherwise fall back to mounting SSH keys
  const agentSocket = process.env.SSH_AUTH_SOCK;
  if (agentSocket && fs.existsSync(agentSocket)) {
    runArgs.push("-v", `${agentSocket}:/ssh-agent`);
    addEnv("SSH_AUTH_SOCK", "/ssh-agent");
  } else {
    // No SSH agent - mount host SSH directory for key-based auth
    const hostSshDir = path.join(os.homedir(), ".ssh");
    if (fs.existsSync(hostSshDir)) {
      runArgs.push("-v", `${hostSshDir}:/host/.ssh:ro`);
    }
  }

  runArgs.push("-v", `${volumes.home}:/home/workspace`);
  runArgs.push("-v", `${volumes.docker}:/var/lib/docker`);
  runArgs.push("-v", `${volumes.cache}:/home/workspace/.cache`);

  // Add user-configured mounts from config
  if (Array.isArray(resolved.workspace.mounts)) {
    resolved.workspace.mounts.forEach((mount) => {
      runArgs.push("-v", `${mount.source}:${mount.target}:${mount.mode}`);
    });
  }

  if (Array.isArray(options.extraDockerArgs)) {
    options.extraDockerArgs.forEach((arg) => runArgs.push(arg));
  }

  runArgs.push(resolved.workspace.imageTag);

  return { runArgs, volumes };
};

const runInitScript = async (resolved, { quick = true } = {}) => {
  const args = [
    "exec",
    "-u",
    "workspace",
    resolved.workspace.containerName,
    "/usr/local/bin/init-workspace.sh",
  ];
  if (quick) {
    args.push("--quick");
  }
  await runCommandStreaming("docker", args);
};

// init command removed - just create .workspace.yml manually in your project directory

program
  .command("build")
  .description("Build the shared workspace Docker image")
  .option("--no-cache", "build without using Docker cache")
  .action(async (options) => {
    const { TEMPLATE_SOURCE } = require("./config");
    const imageTag = 'workspace:latest';
    console.log(`Building shared image ${imageTag}...`);
    await buildImage(imageTag, TEMPLATE_SOURCE, {
      noCache: options.noCache,
    });
  });

program
  .command("start")
  .alias("up")
  .description("Start the workspace container (builds image if needed)")
  .argument("<workspace>", "name of the workspace")
  .option("--rebuild", "force a rebuild of the workspace image before starting", false)
  .option("--no-cache", "rebuild image without cache (implies --rebuild)", false)
  .option("--force-recreate", "remove any existing container before starting", false)
  .option("--no-init", "skip running init-workspace.sh after start", false)
  .option("--path <path>", "use workspace configuration from a specific path")
  .action(async (workspaceName, options) => {
    const wsInfo = await getWorkspaceInfo(workspaceName, options);

    // Check if container already exists
    const containerAlreadyExists = await containerExists(wsInfo.containerName);

    // For restarting an existing container, we don't need config
    if (containerAlreadyExists && !options.forceRecreate && !options.rebuild && !options.noCache) {
      if (await containerRunning(wsInfo.containerName)) {
        console.log(`Workspace '${workspaceName}' is already running.`);
        console.log(`Connect with: workspace shell ${workspaceName}`);
        return;
      } else {
        console.log(`Starting existing container ${wsInfo.containerName}...`);
        await startContainer(wsInfo.containerName);

        // Try to run init script if config is available
        if (!options.noInit && wsInfo.configInfo) {
          await runInitScript(wsInfo.configInfo.resolved, { quick: true });
        }
        console.log("Workspace started.");
        console.log(`Connect with: workspace shell ${workspaceName}`);
        return;
      }
    }

    // For creating a new container or recreating, we NEED the config
    if (!wsInfo.configInfo) {
      console.error(`Cannot create workspace '${workspaceName}': .workspace.yml not found.`);
      console.error("Config file is required for first-time workspace creation.");
      console.error(`Create a .workspace.yml file in your project directory, or run from a directory containing one.`);
      process.exitCode = 1;
      return;
    }

    const { resolved } = wsInfo.configInfo;
    const wsName = resolved.workspace.name;
    const cliHint = `workspace shell${wsName ? ' ' + wsName : ''}`;
    const proxyHint = `workspace proxy${wsName ? ' ' + wsName : ''}`;

    await ensureDir(resolved.workspace.state.root);
    const runtime = await ensureWorkspaceState(resolved);
    await writeRuntimeMetadata(resolved, runtime);
    const sshKeyInfo = await ensureSshKey(resolved);

    await ensureImage(resolved, {
      rebuild: options.rebuild || options.noCache,
      noCache: options.noCache,
    });

    if (containerAlreadyExists) {
      if (options.forceRecreate) {
        console.log(`Removing existing container ${resolved.workspace.containerName}...`);
        await removeContainer(resolved.workspace.containerName, { force: true });
      } else if (await containerRunning(resolved.workspace.containerName)) {
        console.log(`Workspace '${resolved.workspace.name}' is already running.`);
        console.log(`Connect with: ${cliHint}`);
        return;
      } else {
        console.log(`Starting existing container ${resolved.workspace.containerName}...`);
        await startContainer(resolved.workspace.containerName);
        if (!options.noInit) {
          await runInitScript(resolved, { quick: true });
        }
        console.log("Workspace started.");
        return;
      }
    }

    const { runArgs, volumes } = assembleRunArgs(resolved, sshKeyInfo, runtime, options);
    console.log(`Starting new workspace '${resolved.workspace.name}'...`);
    await createContainer(runArgs);

    try {
      await waitForContainer(resolved.workspace.containerName);
    } catch (err) {
      console.warn(`Container created but not ready yet: ${err.message}`);
    }

    if (!options.noInit) {
      await runInitScript(resolved, { quick: true });
      console.log("Initialization script completed.");
    }

    console.log("");
    console.log("Workspace is ready!");
    console.log(`  Container : ${resolved.workspace.containerName}`);
    console.log(`  SSH port  : ${runtime.sshPort}`);
    if (runtime.forwards.length) {
      console.log(
        `  Forwards  : ${runtime.forwards
          .map((port) => `${port}->${port}`)
          .join(", ")}`,
      );
    }
    console.log(`  Volumes   : ${Object.values(volumes).join(", ")}`);
    console.log("");
    console.log("Connect via:");
    console.log(`  ${cliHint}`);
    if (runtime.forwards.length) {
      console.log("Forward ports:");
      console.log(`  ${proxyHint}`);
    }
  });

program
  .command("stop")
  .description("Stop the workspace container")
  .argument("<workspace>", "name of the workspace")
  .action(async (workspaceName, options) => {
    const wsInfo = await getWorkspaceInfo(workspaceName, options);
    if (!(await containerExists(wsInfo.containerName))) {
      console.log("Workspace container does not exist.");
      return;
    }
    if (!(await containerRunning(wsInfo.containerName))) {
      console.log("Workspace container is already stopped.");
      return;
    }
    await stopContainer(wsInfo.containerName);
    console.log("Workspace stopped.");
  });

program
  .command("destroy")
  .alias("rm")
  .alias("delete")
  .description("Stop and remove the workspace container and its volumes")
  .argument("<workspace>", "name of the workspace")
  .option("--keep-volumes", "only remove the container", false)
  .action(async (workspaceName, options) => {
    const wsInfo = await getWorkspaceInfo(workspaceName, options);
    if (await containerExists(wsInfo.containerName)) {
      console.log(`Removing container ${wsInfo.containerName}...`);
      await removeContainer(wsInfo.containerName, { force: true });
    }
    if (!options.keepVolumes) {
      const volumes = computeVolumes(wsInfo.containerName);
      console.log("Removing volumes...");
      await removeVolumes(Object.values(volumes));
    } else {
      console.log("Retained Docker volumes as requested.");
    }
    console.log("Workspace removed.");
    await removeWorkspaceState(wsInfo.name);
  });

program
  .command("list")
  .alias("ls")
  .description("List all available workspaces")
  .option("--path <path>", "list workspaces in a specific repository path")
  .action(async (options) => {
    const startDir = options.path
      ? path.resolve(options.path)
      : await discoverRepoRoot(process.cwd());

    const workspaceSet = new Set();

    // Search for directories containing .workspace.yml
    const findWorkspaces = async (dir, maxDepth = 3, currentDepth = 0) => {
      if (currentDepth > maxDepth) return;

      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
            const entryPath = path.join(dir, entry.name);
            const configPath = path.join(entryPath, DEFAULT_CONFIG_FILENAME);

            if (await fs.promises.access(configPath).then(() => true).catch(() => false)) {
              workspaceSet.add(entry.name);
            }

            // Recursively search subdirectories
            await findWorkspaces(entryPath, maxDepth, currentDepth + 1);
          }
        }
      } catch (err) {
        // Ignore permission errors and continue
      }
    };

    await findWorkspaces(startDir);

    // Add workspaces that have been initialized (exist in state)
    const stateWorkspaces = await listWorkspaceNames();
    stateWorkspaces.forEach(name => workspaceSet.add(name));

    const workspaces = Array.from(workspaceSet).sort();

    if (workspaces.length === 0) {
      console.log("No workspaces found.");
      console.log(`Create one with: workspace init <name>`);
      return;
    }

    console.log(`Found ${workspaces.length} workspace(s):\n`);
    for (const workspace of workspaces) {
      console.log(`  ${workspace}`);
    }
  });

program
  .command("status")
  .description("Show workspace container status")
  .argument("<workspace>", "name of the workspace")
  .option("--path <path>", "use workspace configuration from a specific path")
  .action(async (workspaceName, options) => {
    const wsInfo = await getWorkspaceInfo(workspaceName, options);
    const info = await inspectContainer(wsInfo.containerName);
    if (!info || !info.length) {
      console.log("Workspace container not found.");
      return;
    }

    // Try to get runtime info from config if available, otherwise from state file
    let runtime = null;
    if (wsInfo.configInfo) {
      runtime = await ensureWorkspaceState(wsInfo.configInfo.resolved);
    } else {
      runtime = await loadWorkspaceState(wsInfo.name);
    }

    const container = info[0];
    const running = container.State.Running;
    console.log(`Container : ${wsInfo.containerName}`);
    console.log(`Status    : ${container.State.Status}`);
    console.log(`Image     : ${container.Config.Image}`);
    if (runtime && runtime.sshPort) {
      console.log(`SSH port  : ${runtime.sshPort}`);
    }
    if (runtime && runtime.forwards && runtime.forwards.length) {
      runtime.forwards.forEach((port) => {
        console.log(`Forward   : ${port} -> ${port}`);
      });
    }
    if (wsInfo.configInfo && wsInfo.configInfo.resolved.workspace.repo.remote) {
      console.log(`Remote    : ${wsInfo.configInfo.resolved.workspace.repo.remote} (${wsInfo.configInfo.resolved.workspace.repo.branch})`);
    }
    console.log("");
    console.log(
      running
        ? `Use 'workspace shell ${workspaceName}' to connect.`
        : `Start the workspace with 'workspace start ${workspaceName}'.`,
    );
  });

program
  .command("shell")
  .description("Open an interactive shell inside the workspace via docker exec")
  .argument("<workspace>", "name of the workspace")
  .option("-c, --command <command>", "run a command instead of launching an interactive shell")
  .option("-u, --user <user>", "user to run as (default: workspace)", "workspace")
  .option("--root", "connect as root user (shorthand for -u root)", false)
  .action(async (workspaceName, options) => {
    const wsInfo = await getWorkspaceInfo(workspaceName, options);
    if (!(await containerRunning(wsInfo.containerName))) {
      console.error(
        `Workspace container is not running. Start it with 'workspace start ${workspaceName}'.`,
      );
      process.exitCode = 1;
      return;
    }
    const user = options.root ? "root" : options.user;

    // Detect user's shell from container
    let userShell = "/bin/bash"; // default fallback
    try {
      const { stdout } = await runCommand("docker", [
        "exec",
        "-u",
        user,
        wsInfo.containerName,
        "getent",
        "passwd",
        user,
      ]);
      const passwdEntry = stdout.trim();
      if (passwdEntry) {
        const shellPath = passwdEntry.split(":")[6];
        if (shellPath) {
          userShell = shellPath;
        }
      }
    } catch (err) {
      // Fall back to bash if detection fails
    }

    const args = [
      "exec",
      "-u",
      user,
      wsInfo.containerName,
    ];
    if (options.command) {
      args.splice(1, 0, "-i");
      args.push(userShell, "-c", options.command);
    } else {
      args.splice(1, 0, "-it");
      args.push(userShell);
    }
    await runCommandStreaming("docker", args);
  });

program
  .command("proxy")
  .description("Start SSH port forwarding to the workspace")
  .argument("<workspace>", "name of the workspace")
  .action(async (workspaceName, options) => {
    const wsInfo = await getWorkspaceInfo(workspaceName, options);

    // Get runtime info (SSH port and forwards)
    let runtime = null;
    if (wsInfo.configInfo) {
      runtime = await ensureWorkspaceState(wsInfo.configInfo.resolved);
    } else {
      runtime = await loadWorkspaceState(wsInfo.name);
      if (!runtime) {
        console.error(`Workspace '${workspaceName}' has not been started yet. Start it first with 'workspace start ${workspaceName}'.`);
        process.exitCode = 1;
        return;
      }
    }

    const forwards = runtime.forwards || [];
    if (!forwards.length) {
      console.log("No port forwards configured. Add entries under workspace.forwards in the config file.");
      return;
    }

    // Check if SSH key exists
    if (!fs.existsSync(wsInfo.keyPath)) {
      console.error(`SSH key not found at ${wsInfo.keyPath}. The workspace may not be properly initialized.`);
      process.exitCode = 1;
      return;
    }

    const baseArgs = [
      "-i",
      wsInfo.keyPath,
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-N",
      "-p",
      String(runtime.sshPort),
    ];

    forwards.forEach((port) => {
      const mapping = `127.0.0.1:${port}:localhost:${port}`;
      baseArgs.push("-L", mapping);
    });

    baseArgs.push("workspace@localhost");

    console.log("Starting SSH port forwarding (Ctrl+C to stop)...");
    forwards.forEach((port) => {
      console.log(`  127.0.0.1:${port} -> localhost:${port}`);
    });
    await runCommandStreaming("ssh", baseArgs);
  });

program
  .command("logs")
  .description("Tail workspace container logs")
  .argument("<workspace>", "name of the workspace")
  .option("--tail <lines>", "number of lines to show", parseInteger, 200)
  .option("-f, --follow", "follow logs", false)
  .action(async (workspaceName, options) => {
    const wsInfo = await getWorkspaceInfo(workspaceName, options);
    if (!(await containerExists(wsInfo.containerName))) {
      console.error("Workspace container does not exist.");
      process.exitCode = 1;
      return;
    }
    const args = ["logs", "--tail", String(options.tail)];
    if (options.follow) {
      args.push("--follow");
    }
    args.push(wsInfo.containerName);
    await runCommandStreaming("docker", args);
  });

program
  .command("config")
  .description("Show the resolved workspace configuration")
  .argument("<workspace>", "name of the workspace")
  .option("--path <path>", "repository path")
  .action(async (workspaceName, options) => {
    const { resolved } = await withConfig(options, workspaceName);
    console.log(JSON.stringify(resolved, null, 2));
  });

program
  .command("doctor")
  .description("Check prerequisites for running the workspace CLI")
  .action(async () => {
    const checks = [
      {
        name: "Docker CLI",
        fn: () => runCommand("docker", ["version"]),
      },
      {
        name: "SSH client",
        fn: () => runCommand("ssh", ["-V"]),
      },
      {
        name: "ssh-keygen",
        fn: () => runCommand("which", ["ssh-keygen"]),
      },
    ];

    let failures = 0;
    for (const check of checks) {
      process.stdout.write(`• ${check.name}... `);
      try {
        await check.fn();
        console.log("ok");
      } catch (err) {
        failures += 1;
        console.log("failed");
        if (err.stderr) {
          console.log(err.stderr.trim());
        } else {
          console.log(err.message);
        }
      }
    }

    if (failures > 0) {
      console.log("");
      console.log(`Detected ${failures} issue(s). Resolve them before using workspace.`);
      process.exitCode = 1;
    } else {
      console.log("");
      console.log("All prerequisite checks passed.");
    }
  });

program.configureHelp({
  sortSubcommands: true,
});

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
