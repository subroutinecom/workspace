#!/usr/bin/env node

const { Command, InvalidOptionArgumentError } = require("commander");
const path = require("path");
const fs = require("fs");
const os = require("os");
const readline = require("readline");
const {
  discoverRepoRoot,
  findWorkspaceDir,
  buildDefaultConfig,
  writeConfig,
  loadConfig,
  resolveConfig,
  configExists,
  DEFAULT_CONFIG_FILENAME,
} = require("./config");
const { runCommand, runCommandStreaming, runCommandWithLogging, ensureDir, writeJson, sleep, ora } = require("./utils");

const createLogger = (verbose) => {
  const spinner = verbose ? null : ora();

  return {
    start: (text) => {
      if (spinner) {
        spinner.start(text);
      } else {
        console.log(text);
      }
    },
    update: (text) => {
      if (spinner) {
        spinner.text = text;
      }
    },
    succeed: (text) => {
      if (spinner) {
        spinner.succeed(text);
      } else {
        console.log(text);
      }
    },
    fail: (text) => {
      if (spinner) {
        spinner.fail(text);
      }
    },
    info: (text) => {
      if (spinner) {
        spinner.info(text);
      } else {
        console.log(text);
      }
    },
    isVerbose: () => verbose,
  };
};
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
  networkExists,
  createNetwork,
  volumeExists,
  createVolume,
  connectToNetwork,
  execInContainer,
} = require("./docker");
const { ensureWorkspaceState, removeWorkspaceState, listWorkspaceNames } = require("./state");
const pkg = require("../package.json");
const updateNotifier = require("update-notifier");

// const notifier = updateNotifier({ pkg });
const notifier = updateNotifier.default({
  pkg: pkg,
  updateCheckInterval: 0,
});
notifier.notify({
  message: "New version available. Run `workspace update`",
});

const program = new Command();
program.name("workspace").description("Self-contained CLI for Docker-in-Docker workspaces").version(pkg.version);

const parseInteger = (value, dummyPrevious) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new InvalidOptionArgumentError("Not a number.");
  }
  return parsed;
};

/**
 * Prompt user for confirmation
 * @param {string} message - Confirmation message
 * @returns {Promise<boolean>} true if user confirmed
 */
const confirmPrompt = (message) => {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
};

const withConfig = async (options = {}, workspaceName) => {
  const configFilename = options.config || DEFAULT_CONFIG_FILENAME;

  const workspaceDir = await findWorkspaceDir(options);

  const raw = await loadConfig(workspaceDir, configFilename);
  const resolved = await resolveConfig(raw, workspaceDir, {
    workspaceNameOverride: workspaceName,
  });

  return { configDir: workspaceDir, raw, resolved };
};

/**
 * Get minimal workspace info without requiring config file.
 * Allows commands like stop, destroy, logs to work even when .workspace.yml is missing.
 */
const getWorkspaceInfo = async (workspaceName, options = {}) => {
  const containerName = `workspace-${workspaceName}`;
  const stateDir = path.join(os.homedir(), ".workspaces", "state", workspaceName);
  const keyPath = path.join(stateDir, "ssh", "id_ed25519");

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
    configInfo,
  };
};

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
    await runCommand("ssh-keygen", ["-t", "ed25519", "-f", keyPath, "-N", "", "-C", `workspace-${resolved.workspace.name}`]);
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
    forwards: runtime.forwards,
    bootstrap: {
      scripts: resolved.workspace.bootstrap.scripts,
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

const waitForContainer = async (containerName, logger, timeoutMs = 15000) => {
  logger.update("Waiting for container to be ready...");
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

const waitForDockerd = async (containerName, logger, timeoutMs = 30000) => {
  logger.update("Waiting for Docker daemon...");
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      await execInContainer(containerName, ["docker", "info"]);
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`Timed out waiting for Docker daemon in ${containerName} to become ready`);
};

/**
 * Ensure shared BuildKit infrastructure exists:
 * - Network: workspace-internal-buildnet
 * - Volume: workspace-internal-buildkit-cache
 * - BuildKit daemon: workspace-internal-buildkitd
 */
const ensureSharedBuildKit = async (logger) => {
  const networkName = "workspace-internal-buildnet";
  const volumeName = "workspace-internal-buildkit-cache";
  const buildkitdName = "workspace-internal-buildkitd";
  const buildkitdPort = 1234;

  logger.update("Setting up BuildKit infrastructure...");

  if (!(await networkExists(networkName))) {
    await createNetwork(networkName);
  }

  if (!(await volumeExists(volumeName))) {
    await createVolume(volumeName);
  }

  const buildkitdExists = await containerExists(buildkitdName);
  const buildkitdRunning = buildkitdExists && (await containerRunning(buildkitdName));

  if (!buildkitdRunning) {
    if (buildkitdExists) {
      await startContainer(buildkitdName);
    } else {
      await createContainer([
        "--detach",
        "--name",
        buildkitdName,
        "--privileged",
        "--network",
        networkName,
        "-v",
        `${volumeName}:/var/lib/buildkit`,
        "-p",
        `127.0.0.1:${buildkitdPort}:${buildkitdPort}`,
        "moby/buildkit:latest",
        "--addr",
        `tcp://0.0.0.0:${buildkitdPort}`,
      ]);

      await sleep(2000);
    }
  }

  return {
    networkName,
    volumeName,
    buildkitdName,
    buildkitdPort,
  };
};

/**
 * Configure docker buildx in a workspace container to use the shared BuildKit daemon.
 *
 * This makes the following commands use the shared cache automatically:
 * - docker buildx build (explicit buildx usage)
 * - docker build (when DOCKER_BUILDKIT=1, uses default buildx builder)
 * - docker compose build (when DOCKER_BUILDKIT=1, uses default buildx builder)
 * - docker compose up --build (same as above)
 */
const configureBuildxInContainer = async (containerName, buildkitInfo, logger) => {
  const builderName = "workspace-internal-builder";
  const buildkitdEndpoint = `tcp://${buildkitInfo.buildkitdName}:${buildkitInfo.buildkitdPort}`;
  const user = "workspace";

  logger.update("Configuring buildx...");

  try {
    await execInContainer(containerName, ["docker", "buildx", "rm", builderName], { user });
  } catch (err) {
  }

  try {
    await execInContainer(
      containerName,
      ["docker", "buildx", "create", "--name", builderName, "--driver", "remote", buildkitdEndpoint, "--use"],
      { user }
    );
  } catch (err) {
    throw new Error(`Failed to create buildx builder: ${err.message}`);
  }

  try {
    await execInContainer(containerName, ["docker", "buildx", "inspect", "--bootstrap"], { user });
  } catch (err) {
    throw new Error(`Failed to bootstrap buildx builder: ${err.message}`);
  }
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

  addEnv("USER", "workspace");
  addEnv("WORKSPACE_NAME", resolved.workspace.name);
  addEnv("SSH_PUBLIC_KEY", sshKeyInfo.publicKey);
  addEnv("WORKSPACE_RUNTIME_CONFIG", "/workspace/config/runtime.json");
  addEnv("WORKSPACE_SOURCE_DIR", "/workspace/source");
  addEnv("HOST_HOME", "/host/home");
  addEnv("WORKSPACE_ASSIGNED_SSH_PORT", runtime.sshPort);
  addEnv("WORKSPACE_REPO_URL", resolved.workspace.repo.remote);
  addEnv("WORKSPACE_REPO_BRANCH", resolved.workspace.repo.branch);

  // Enable BuildKit for docker build and docker compose
  addEnv("DOCKER_BUILDKIT", "1");
  addEnv("COMPOSE_DOCKER_CLI_BUILD", "1");

  runArgs.push("-v", `${resolved.workspace.state.runtimeConfigPath}:/workspace/config/runtime.json:ro`);
  runArgs.push("-v", `${resolved.workspace.configDir}:/workspace/source:ro`);

  // Mount user scripts directory if it exists
  const userScriptsDir = path.join(os.homedir(), ".workspaces", "userscripts");
  if (fs.existsSync(userScriptsDir)) {
    runArgs.push("-v", `${userScriptsDir}:/workspace/userscripts:ro`);
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
  }

  runArgs.push("-v", `${volumes.home}:/home/workspace`);
  runArgs.push("-v", `${volumes.docker}:/var/lib/docker`);
  runArgs.push("-v", `${volumes.cache}:/home/workspace/.cache`);

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

const runInitScript = async (resolved, logger) => {
  const args = ["exec", "-u", "workspace", resolved.workspace.containerName, "/usr/local/bin/init-workspace.sh"];

  const logsDir = path.join(os.homedir(), ".workspaces", "logs");
  await ensureDir(logsDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const logFile = path.join(logsDir, `${resolved.workspace.name}-${timestamp}.log`);

  try {
    await runCommandWithLogging("docker", args, {
      logFile,
      onOutput: (data) => {
        if (logger.isVerbose()) {
          process.stdout.write(data);
        } else {
          const lines = data.split("\n").filter(l => l.trim());
          for (const line of lines) {
            logger.update(line);
          }
        }
      }
    });
  } catch (err) {
    if (err.logFile) {
      err.message = `${err.message}\nSee logs: ${err.logFile}`;
    }
    throw err;
  }
};

program
  .command("init")
  .description("Create a .workspace.yml config file in the current directory")
  .argument("[name]", "optional workspace name (defaults to directory name)")
  .option("-f, --force", "overwrite existing config file", false)
  .action(async (workspaceName, options) => {
    const targetDir = process.cwd();
    const dirName = path.basename(targetDir);
    const name = workspaceName || dirName;
    const configPath = path.join(targetDir, DEFAULT_CONFIG_FILENAME);

    if (await configExists(targetDir)) {
      if (!options.force) {
        console.error(`Config file already exists: ${configPath}`);
        console.error("Use --force to overwrite.");
        process.exitCode = 1;
        return;
      }
      console.log(`Overwriting existing config: ${configPath}`);
    }

    const config = await buildDefaultConfig(targetDir);

    const writtenPath = await writeConfig(targetDir, config);
    console.log(`Created workspace config: ${writtenPath}`);
    console.log("");
    console.log("Configuration scaffold:");
    console.log("  repo:");
    console.log(`    remote: ${config.repo.remote || "(none - add your git remote)"}`);
    console.log(`    branch: ${config.repo.branch}`);
    console.log(`  forwards:`);
    console.log(`    - ${config.forwards.join("\n    - ")}`);
    console.log("");
    console.log("Edit the config file to customize:");
    console.log("  - Add bootstrap scripts under 'bootstrap.scripts'");
    console.log("  - Add host directory mounts under 'mounts'");
    console.log("  - Configure port forwards under 'forwards'");
    console.log("");
    console.log(`Start your workspace with: workspace start ${name}`);
  });

program
  .command("build")
  .description("Build the shared workspace Docker image")
  .option("--no-cache", "build without using Docker cache")
  .action(async (options) => {
    const { TEMPLATE_SOURCE } = require("./config");
    const imageTag = "workspace:latest";
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
  .option("--verbose", "show detailed output instead of spinner", false)
  .option("--path <path>", "use workspace configuration from a specific path")
  .action(async (workspaceName, options) => {
    const wsInfo = await getWorkspaceInfo(workspaceName, options);

    const containerAlreadyExists = await containerExists(wsInfo.containerName);

    if (containerAlreadyExists && !options.forceRecreate && !options.rebuild && !options.noCache) {
      if (await containerRunning(wsInfo.containerName)) {
        console.log(`Workspace '${workspaceName}' is already running.`);
        console.log(`Connect with: workspace shell ${workspaceName}`);
        return;
      } else {
        const logger = createLogger(options.verbose);
        logger.start(`Starting workspace '${workspaceName}'...`);

        try {
          await startContainer(wsInfo.containerName);
          await waitForDockerd(wsInfo.containerName, logger);
          const buildkitInfo = await ensureSharedBuildKit(logger);
          await connectToNetwork(wsInfo.containerName, buildkitInfo.networkName);
          await configureBuildxInContainer(wsInfo.containerName, buildkitInfo, logger);

          if (!options.noInit && wsInfo.configInfo) {
            logger.update("Running initialization...");
            await runInitScript(wsInfo.configInfo.resolved, logger);
          }

          logger.succeed("Workspace started");
          console.log(`Connect with: workspace shell ${workspaceName}`);
          return;
        } catch (err) {
          logger.fail("Failed to start workspace");
          throw err;
        }
      }
    }

    if (!wsInfo.configInfo) {
      console.error(`Cannot create workspace '${workspaceName}': .workspace.yml not found.`);
      console.error("Config file is required for first-time workspace creation.");
      console.error(`Create a .workspace.yml file in your project directory, or run from a directory containing one.`);
      process.exitCode = 1;
      return;
    }

    const { resolved } = wsInfo.configInfo;
    const wsName = resolved.workspace.name;
    const cliHint = `workspace shell${wsName ? " " + wsName : ""}`;
    const proxyHint = `workspace proxy${wsName ? " " + wsName : ""}`;

    await ensureDir(resolved.workspace.state.root);
    const runtime = await ensureWorkspaceState(resolved);
    await writeRuntimeMetadata(resolved, runtime);
    const sshKeyInfo = await ensureSshKey(resolved);

    await ensureImage(resolved, {
      rebuild: options.rebuild || options.noCache,
      noCache: options.noCache,
    });

    const logger = createLogger(options.verbose);
    logger.start(`Starting workspace '${resolved.workspace.name}'...`);

    try {
      const buildkitInfo = await ensureSharedBuildKit(logger);

      if (containerAlreadyExists) {
        if (options.forceRecreate) {
          logger.update("Removing existing container...");
          await removeContainer(resolved.workspace.containerName, { force: true });
        } else if (await containerRunning(resolved.workspace.containerName)) {
          logger.info(`Workspace '${resolved.workspace.name}' is already running`);
          console.log(`Connect with: ${cliHint}`);
          return;
        } else {
          logger.update("Starting container...");
          await startContainer(resolved.workspace.containerName);
          await waitForDockerd(resolved.workspace.containerName, logger);
          await connectToNetwork(resolved.workspace.containerName, buildkitInfo.networkName);
          await configureBuildxInContainer(resolved.workspace.containerName, buildkitInfo, logger);

          if (!options.noInit) {
            logger.update("Running initialization...");
            await runInitScript(resolved, logger);
          }

          logger.succeed("Workspace started");
          console.log(`Connect with: ${cliHint}`);
          return;
        }
      }

      const { runArgs, volumes } = assembleRunArgs(resolved, sshKeyInfo, runtime, options);
      logger.update("Creating container...");
      await createContainer(runArgs);

      await connectToNetwork(resolved.workspace.containerName, buildkitInfo.networkName);

      await waitForContainer(resolved.workspace.containerName, logger);
      await waitForDockerd(resolved.workspace.containerName, logger);

      await configureBuildxInContainer(resolved.workspace.containerName, buildkitInfo, logger);

      if (!options.noInit) {
        logger.update("Running initialization...");
        await runInitScript(resolved, logger);
      }

      logger.succeed("Workspace is ready!");
      console.log(`  SSH port: ${runtime.sshPort}`);
      if (runtime.forwards.length) {
        console.log(`  Port forwarding: ${runtime.forwards.map((port) => `${port}`).join(", ")}`);
      }
      console.log(`  Connect with: ${cliHint}`);
      if (runtime.forwards.length) {
        console.log(`  Forward ports: ${proxyHint}`);
      }
    } catch (err) {
      logger.fail("Failed to start workspace");
      throw err;
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
  .argument("<workspaces...>", "name(s) of the workspace(s)")
  .option("--keep-volumes", "only remove the container", false)
  .option("-f, --force", "skip confirmation prompt", false)
  .action(async (workspaceNames, options) => {
    // Show warning and ask for confirmation unless --force is used
    if (!options.force) {
      console.log("\n⚠️  WARNING: This will permanently delete the following workspace(s):");
      for (const name of workspaceNames) {
        console.log(`  - ${name}`);
      }
      if (!options.keepVolumes) {
        console.log("\nThis will remove:");
        console.log("  • Container");
        console.log("  • All volumes (home directory, docker storage, cache)");
        console.log("  • Workspace state");
      } else {
        console.log("\nThis will remove:");
        console.log("  • Container");
        console.log("  • Workspace state");
        console.log("  (Volumes will be kept)");
      }
      console.log("\nThis action cannot be undone.");

      const confirmed = await confirmPrompt("\nAre you sure you want to continue?");
      if (!confirmed) {
        console.log("Aborted.");
        return;
      }
    }

    for (const workspaceName of workspaceNames) {
      console.log(`\n=== Removing workspace '${workspaceName}' ===`);
      const wsInfo = await getWorkspaceInfo(workspaceName, options);
      try {
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
      } catch (err) {
        console.error(`Warning: Error during cleanup: ${err.message}`);
        console.log("Continuing with state cleanup...");
      }
      console.log("Workspace removed.");
      await removeWorkspaceState(wsInfo.name);
    }
  });

program
  .command("list")
  .alias("ls")
  .description("List all available workspaces")
  .option("--path <path>", "list workspaces in a specific repository path")
  .action(async (options) => {
    const startDir = options.path ? path.resolve(options.path) : await discoverRepoRoot(process.cwd());

    const workspaceSet = new Set();

    // Search for directories containing .workspace.yml
    const findWorkspaces = async (dir, maxDepth = 3, currentDepth = 0) => {
      if (currentDepth > maxDepth) return;

      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
            const entryPath = path.join(dir, entry.name);
            const configPath = path.join(entryPath, DEFAULT_CONFIG_FILENAME);

            if (
              await fs.promises
                .access(configPath)
                .then(() => true)
                .catch(() => false)
            ) {
              workspaceSet.add(entry.name);
            }

            // Recursively search subdirectories
            await findWorkspaces(entryPath, maxDepth, currentDepth + 1);
          }
        }
      } catch (err) {}
    };

    await findWorkspaces(startDir);

    const stateWorkspaces = await listWorkspaceNames();
    stateWorkspaces.forEach((name) => workspaceSet.add(name));

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
    console.log(running ? `Use 'workspace shell ${workspaceName}' to connect.` : `Start the workspace with 'workspace start ${workspaceName}'.`);
  });

program
  .command("info")
  .description("Show quick workspace summary")
  .argument("<workspace>", "name of the workspace")
  .option("--path <path>", "use workspace configuration from a specific path")
  .action(async (workspaceName, options) => {
    const wsInfo = await getWorkspaceInfo(workspaceName, options);
    const exists = await containerExists(wsInfo.containerName);
    const running = exists && (await containerRunning(wsInfo.containerName));

    let runtime = null;
    if (wsInfo.configInfo) {
      runtime = await ensureWorkspaceState(wsInfo.configInfo.resolved);
    } else {
      runtime = await loadWorkspaceState(wsInfo.name);
    }

    const formatPortRanges = (ports) => {
      if (!ports || !ports.length) return "none";
      const sorted = [...ports].sort((a, b) => a - b);
      const ranges = [];
      let start = sorted[0];
      let end = sorted[0];

      for (let i = 1; i <= sorted.length; i++) {
        if (i < sorted.length && sorted[i] === end + 1) {
          end = sorted[i];
        } else {
          ranges.push(start === end ? `${start}` : `${start}-${end}`);
          if (i < sorted.length) {
            start = sorted[i];
            end = sorted[i];
          }
        }
      }
      return ranges.join(", ");
    };

    const status = !exists ? "not created" : running ? "running" : "stopped";
    const sshPort = runtime?.sshPort || "n/a";
    const forwards = formatPortRanges(runtime?.forwards);
    const configPath = runtime?.configDir || wsInfo.configInfo?.configDir || "n/a";

    console.log(`${workspaceName} | ${status} | SSH: ${sshPort} | Forwards: ${forwards} | Config: ${configPath}`);
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
      console.error(`Workspace container is not running. Start it with 'workspace start ${workspaceName}'.`);
      process.exitCode = 1;
      return;
    }
    const user = options.root ? "root" : options.user;

    let userShell = "/bin/bash";
    try {
      const { stdout } = await runCommand("docker", ["exec", "-u", user, wsInfo.containerName, "getent", "passwd", user]);
      const passwdEntry = stdout.trim();
      if (passwdEntry) {
        const shellPath = passwdEntry.split(":")[6];
        if (shellPath) {
          userShell = shellPath;
        }
      }
    } catch (err) {}

    const args = ["exec", "-u", user, wsInfo.containerName];

    if (process.env.TERM) {
      args.splice(1, 0, "-e", `TERM=${process.env.TERM}`);
    }

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

    const formatPortRanges = (ports) => {
      if (!ports.length) return "";
      const sorted = [...ports].sort((a, b) => a - b);
      const ranges = [];
      let start = sorted[0];
      let end = sorted[0];

      for (let i = 1; i <= sorted.length; i++) {
        if (i < sorted.length && sorted[i] === end + 1) {
          end = sorted[i];
        } else {
          ranges.push(start === end ? `${start}` : `${start}-${end}`);
          if (i < sorted.length) {
            start = sorted[i];
            end = sorted[i];
          }
        }
      }
      return ranges.join(", ");
    };

    console.log(`SSH: ${runtime.sshPort} | Forwards: ${formatPortRanges(forwards)}`);
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

program
  .command("buildkit")
  .description("Manage shared BuildKit infrastructure")
  .option("--status", "show status of shared BuildKit resources", false)
  .option("--stop", "stop the shared BuildKit daemon", false)
  .option("--restart", "restart the shared BuildKit daemon", false)
  .option("--clean", "remove all shared BuildKit resources (stops daemon, removes network and cache)", false)
  .action(async (options) => {
    const networkName = "workspace-internal-buildnet";
    const volumeName = "workspace-internal-buildkit-cache";
    const buildkitdName = "workspace-internal-buildkitd";

    if (options.clean) {
      console.log("Cleaning up shared BuildKit resources...");

      if (await containerExists(buildkitdName)) {
        console.log(`Removing BuildKit daemon: ${buildkitdName}`);
        await removeContainer(buildkitdName, { force: true });
      }

      if (await networkExists(networkName)) {
        console.log(`Removing network: ${networkName}`);
        await runCommand("docker", ["network", "rm", networkName]);
      }

      if (await volumeExists(volumeName)) {
        console.log(`Removing cache volume: ${volumeName}`);
        await removeVolumes([volumeName]);
      }

      console.log("Shared BuildKit resources cleaned up.");
      return;
    }

    if (options.stop) {
      if (await containerExists(buildkitdName)) {
        console.log(`Stopping BuildKit daemon: ${buildkitdName}`);
        await stopContainer(buildkitdName);
        console.log("BuildKit daemon stopped.");
      } else {
        console.log("BuildKit daemon does not exist.");
      }
      return;
    }

    if (options.restart) {
      if (await containerExists(buildkitdName)) {
        console.log(`Restarting BuildKit daemon: ${buildkitdName}`);
        await stopContainer(buildkitdName);
        await startContainer(buildkitdName);
        console.log("BuildKit daemon restarted.");
      } else {
        console.log("BuildKit daemon does not exist. Starting it...");
        await ensureSharedBuildKit();
        console.log("BuildKit daemon started.");
      }
      return;
    }

    console.log("Shared BuildKit Infrastructure Status:\n");

    console.log(`Network: ${networkName}`);
    const netExists = await networkExists(networkName);
    console.log(`  Status: ${netExists ? "exists" : "not found"}\n`);

    console.log(`Volume: ${volumeName}`);
    const volExists = await volumeExists(volumeName);
    if (volExists) {
      const { stdout } = await runCommand("docker", ["volume", "inspect", volumeName, "--format", "{{.Mountpoint}}"]);
      console.log(`  Status: exists`);
      console.log(`  Path: ${stdout.trim()}`);
    } else {
      console.log(`  Status: not found`);
    }
    console.log("");

    console.log(`BuildKit Daemon: ${buildkitdName}`);
    const daemonExists = await containerExists(buildkitdName);
    if (daemonExists) {
      const daemonRunning = await containerRunning(buildkitdName);
      console.log(`  Status: ${daemonRunning ? "running" : "stopped"}`);

      if (daemonRunning) {
        const inspect = await inspectContainer(buildkitdName);
        if (inspect && inspect.length > 0) {
          const networks = Object.keys(inspect[0].NetworkSettings.Networks || {});
          console.log(`  Networks: ${networks.join(", ")}`);
        }
      }
    } else {
      console.log(`  Status: not found`);
    }
    console.log("");

    console.log("Commands:");
    console.log("  workspace buildkit --stop       Stop the BuildKit daemon");
    console.log("  workspace buildkit --restart    Restart the BuildKit daemon");
    console.log("  workspace buildkit --clean      Remove all BuildKit resources");
  });

program
  .command("update")
  .description("Update workspace CLI to the latest version")
  .action(async () => {
    console.log("Updating workspace CLI...");
    const packageName = pkg.name;
    try {
      await runCommandStreaming("npm", ["install", "-g", `${packageName}@latest`]);
      console.log("\nUpdate complete!");
    } catch (err) {
      console.error("Update failed:", err.message);
      process.exitCode = 1;
    }
  });

program.configureHelp({
  sortSubcommands: true,
});

program.parseAsync(process.argv).catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
