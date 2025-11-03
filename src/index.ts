#!/usr/bin/env node

import path from "path";
import fs from "fs";
import os from "os";
import { Command, InvalidOptionArgumentError } from "commander";
import updateNotifier from "update-notifier";
import pkg from "../package.json";
import type { ResolvedWorkspaceConfig } from "./config";
import type { WorkspaceState } from "./state";
import type { Logger } from "./cli/ui";
import {
  discoverRepoRoot,
  buildDefaultConfig,
  writeConfig,
  configExists,
  DEFAULT_CONFIG_FILENAME,
  TEMPLATE_SOURCE,
} from "./config";
import {
  runCommand,
  runCommandStreaming,
  runCommandWithLogging,
  ensureDir,
  writeJson,
} from "./utils";
import type { CommandError } from "./utils";
import { getUserConfig } from "./user-config";
import { selectKeyForRepo, getKeyBasename } from "./ssh";
import {
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
} from "./docker";
import {
  ensureWorkspaceState,
  removeWorkspaceState,
  listWorkspaceNames,
  recordSharedImageBuild,
  getLastSharedImageBuild,
} from "./state";
import { configureBuildxInContainer, ensureSharedBuildKit, waitForContainer, waitForDockerd } from "./buildkit";
import { createLogger, confirmPrompt } from "./cli/ui";
import { withConfig, getWorkspaceInfo, loadWorkspaceState } from "./workspace/context";

const notifier = updateNotifier({
  pkg,
  updateCheckInterval: 0,
});
notifier.notify({
  message: "New version available. Run `workspace update`",
});

const program = new Command();
program.name("workspace").description("Self-contained CLI for Docker-in-Docker workspaces").version(pkg.version);

const parseInteger = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new InvalidOptionArgumentError("Not a number.");
  }
  return parsed;
};

interface SshKeyInfo {
  privateKey: string;
  publicKey: string;
  publicKeyPath: string;
}

interface DockerRunOptions {
  extraDockerArgs?: string[];
}

interface DockerInspectData {
  State?: {
    Running?: boolean;
    Status?: string;
  };
  Mounts?: Array<{
    Source?: string;
    Destination?: string;
  }>;
  NetworkSettings?: {
    Networks?: Record<string, unknown>;
  };
}

interface VolumeMapping {
  home: string;
  docker: string;
  cache: string;
}

interface WorkspaceInspectData extends DockerInspectData {
  Config?: {
    Image?: string;
  };
}

const isCommandError = (error: unknown): error is CommandError => {
  return Boolean(
    error &&
      typeof error === "object" &&
      "message" in error,
  );
};

const ensureSshKey = async (resolved: ResolvedWorkspaceConfig): Promise<SshKeyInfo> => {
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

const writeRuntimeMetadata = async (
  resolved: ResolvedWorkspaceConfig,
  runtime: WorkspaceState,
): Promise<void> => {
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
      selectedKey: runtime.selectedKey || null,
    },
    forwards: runtime.forwards,
    bootstrap: {
      scripts: resolved.workspace.bootstrap.scripts,
    },
  };
  await writeJson(resolved.workspace.state.runtimeConfigPath, runtimeData);
};

const SHARED_IMAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const ensureImage = async (
  resolved: ResolvedWorkspaceConfig,
  { rebuild = false, noCache = false }: { rebuild?: boolean; noCache?: boolean } = {},
): Promise<void> => {
  const imageTag = resolved.workspace.imageTag;
  const buildContext = resolved.workspace.buildContext;

  const imagePresent = await imageExists(imageTag);
  let needsBuild = !imagePresent || rebuild;

  if (!needsBuild) {
    const lastBuild = await getLastSharedImageBuild();
    if (!lastBuild) {
      needsBuild = true;
    } else if (Date.now() - lastBuild > SHARED_IMAGE_MAX_AGE_MS) {
      console.log("Workspace image is stale. Rebuilding...");
      needsBuild = true;
    }
  }

  if (needsBuild) {
    console.log(`Building workspace image ${imageTag}...`);
    await buildImage(imageTag, buildContext, { noCache });
    await recordSharedImageBuild();
  }
};

const computeVolumes = (containerName: string): VolumeMapping => ({
  home: `${containerName}-home`,
  docker: `${containerName}-docker`,
  cache: `${containerName}-cache`,
});

const assembleRunArgs = (
  resolved: ResolvedWorkspaceConfig,
  sshKeyInfo: SshKeyInfo,
  runtime: WorkspaceState,
  options: DockerRunOptions = {},
): { runArgs: string[]; volumes: VolumeMapping } => {
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

  const addEnv = (key: string, value: unknown) => {
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
  if (runtime.selectedKey) {
    addEnv("WORKSPACE_SELECTED_SSH_KEY", runtime.selectedKey);
  }

  // Enable BuildKit for docker build and docker compose
  addEnv("DOCKER_BUILDKIT", "1");
  addEnv("COMPOSE_DOCKER_CLI_BUILD", "1");

  runArgs.push("-v", `${resolved.workspace.state.runtimeConfigPath}:/workspace/config/runtime.json:ro`);
  runArgs.push("-v", `${resolved.workspace.configDir}:/workspace/source:ro`);

  const userConfigDir = path.join(os.homedir(), ".workspaces");
  if (fs.existsSync(userConfigDir)) {
    runArgs.push("-v", `${userConfigDir}:/workspace/userconfig:ro`);
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

const runInitScript = async (resolved: ResolvedWorkspaceConfig, logger: Logger): Promise<string> => {
  const args = ["exec", "-u", "workspace", resolved.workspace.containerName, "/usr/local/bin/workspace-internal", "init"];

  const logsDir = path.join(os.homedir(), ".workspaces", "logs");
  await ensureDir(logsDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const logFile = path.join(logsDir, `${resolved.workspace.name}-${timestamp}.log`);
  const headerLines = [
    `=== Workspace init started ${new Date().toISOString()} ===`,
    `Workspace : ${resolved.workspace.name}`,
    `Container : ${resolved.workspace.containerName}`,
    `Image     : ${resolved.workspace.imageTag}`,
    `ConfigDir : ${resolved.workspace.configDir}`,
    `Repo      : ${resolved.workspace.repo.remote || "(none)"}`,
    `Branch    : ${resolved.workspace.repo.branch}`,
    `Forwards  : ${
      resolved.workspace.forwards.length ? resolved.workspace.forwards.join(", ") : "(none)"
    }`,
  ];
  fs.writeFileSync(logFile, `${headerLines.join("\n")}\n\n`, "utf8");

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
    fs.appendFileSync(logFile, `\n=== Workspace init completed ${new Date().toISOString()} ===\n`, "utf8");
    return logFile;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fs.appendFileSync(logFile, `\n=== Workspace init failed ${new Date().toISOString()} ===\n${message}\n`, "utf8");
    if (isCommandError(error) && error.logFile) {
      error.message = `${error.message}\nSee logs: ${error.logFile}`;
    }
    throw error;
  }
};

const verifyRepositoryClone = async (
  resolved: ResolvedWorkspaceConfig,
  logFile?: string,
): Promise<void> => {
  if (!resolved.workspace.repo.remote) {
    return;
  }
  try {
    await execInContainer(
      resolved.workspace.containerName,
      ["test", "-d", "/workspace/source/.git"],
      { user: "workspace" },
    );
  } catch {
    const suffix = logFile ? ` See logs: ${logFile}` : "";
    throw new Error(`Workspace repository clone did not complete successfully.${suffix}`);
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
    const repo = config.repo ?? { remote: "", branch: "" };
    console.log("Configuration scaffold:");
    console.log("  repo:");
    console.log(`    remote: ${repo.remote || "(none - add your git remote)"}`);
    console.log(`    branch: ${repo.branch || "main"}`);
    const forwardsList = config.forwards && config.forwards.length ? config.forwards : [3000];
    console.log("  forwards:");
    forwardsList.forEach((forward) => {
      console.log(`    - ${forward}`);
    });
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
    const imageTag = "workspace:latest";
    console.log(`Building shared image ${imageTag}...`);
    await buildImage(imageTag, TEMPLATE_SOURCE, {
      noCache: options.noCache,
    });
    await recordSharedImageBuild();
  });

program
  .command("start")
  .alias("up")
  .description("Start the workspace container (builds image if needed)")
  .argument("<workspace>", "name of the workspace")
  .option("--rebuild", "force a rebuild of the workspace image before starting", false)
  .option("--no-cache", "rebuild image without cache (implies --rebuild)", false)
  .option("--force-recreate", "remove any existing container before starting", false)
  .option("--no-init", "skip running workspace-internal init after start", false)
  .option("-v, --verbose", "show detailed output instead of spinner", false)
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
          logger.update("Starting Docker container...");
          await startContainer(wsInfo.containerName, { quiet: !options.verbose });
          await waitForDockerd(wsInfo.containerName, logger);
          const buildkitInfo = await ensureSharedBuildKit(logger);
          await connectToNetwork(wsInfo.containerName, buildkitInfo.networkName);
          await configureBuildxInContainer(wsInfo.containerName, buildkitInfo, logger);

          if (!options.noInit && wsInfo.configInfo) {
            logger.update("Running initialization...");
            const initLogPath = await runInitScript(wsInfo.configInfo.resolved, logger);
            await verifyRepositoryClone(wsInfo.configInfo.resolved, initLogPath);
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

    const userConfig = getUserConfig();

    if (options.verbose) {
      console.log("\n=== SSH Key Selection ===");
      console.log(`Repository URL: ${resolved.workspace.repo.remote}`);
      console.log("\n--- User SSH Config (~/.workspaces/config.yml) ---");
      if (userConfig.ssh && Object.keys(userConfig.ssh).length > 0) {
        console.log(JSON.stringify(userConfig.ssh, null, 2));
      } else {
        console.log("No SSH configuration found");
      }
    }

    const selectedKey = selectKeyForRepo(resolved.workspace.repo.remote, userConfig);
    const selectedKeyBasename = getKeyBasename(selectedKey);
    runtime.selectedKey = selectedKeyBasename;

    if (options.verbose) {
      console.log(`\nMatched key: ${selectedKey || "(none - will use SSH agent or default)"}`);
      console.log(`Key basename for container: ${selectedKeyBasename || "(none)"}`);
      console.log("=== End SSH Key Selection ===\n");
    }

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
          logger.update("Starting Docker container...");
          await startContainer(resolved.workspace.containerName, { quiet: !options.verbose });
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
      logger.update("Creating Docker container...");
      await createContainer(runArgs, { quiet: !options.verbose });

      await connectToNetwork(resolved.workspace.containerName, buildkitInfo.networkName);

      await waitForContainer(resolved.workspace.containerName, logger);
      await waitForDockerd(resolved.workspace.containerName, logger);

      await configureBuildxInContainer(resolved.workspace.containerName, buildkitInfo, logger);

      if (!options.noInit) {
        logger.update("Running initialization...");
        const initLogPath = await runInitScript(resolved, logger);
        await verifyRepositoryClone(resolved, initLogPath);
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Warning: Error during cleanup: ${message}`);
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
    const findWorkspaces = async (dir: string, maxDepth = 3, currentDepth = 0): Promise<void> => {
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

    const runtime: WorkspaceState | null = wsInfo.configInfo
      ? await ensureWorkspaceState(wsInfo.configInfo.resolved)
      : await loadWorkspaceState(wsInfo.name);

    const container = info[0] as WorkspaceInspectData;
    const running = Boolean(container.State?.Running);
    console.log(`Container : ${wsInfo.containerName}`);
    console.log(`Status    : ${container.State?.Status ?? "unknown"}`);
    console.log(`Image     : ${container.Config?.Image ?? "unknown"}`);
    if (runtime?.sshPort) {
      console.log(`SSH port  : ${runtime.sshPort}`);
    }
    if (runtime?.forwards?.length) {
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

    const formatPortRanges = (ports: number[] | undefined): string => {
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

    const formatPortRanges = (ports: number[]): string => {
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
      } catch (error) {
        failures += 1;
        console.log("failed");
        if (isCommandError(error) && error.stderr) {
          console.log(error.stderr.trim());
        } else if (error instanceof Error) {
          console.log(error.message);
        } else {
          console.log(String(error));
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
        await ensureSharedBuildKit(createLogger(false));
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
        const inspectData = inspect && inspect.length > 0 ? (inspect[0] as DockerInspectData) : null;
        if (inspectData?.NetworkSettings?.Networks) {
          const networks = Object.keys(inspectData.NetworkSettings.Networks);
          console.log(`  Networks: ${networks.join(", ")}`);
        } else if (inspectData) {
          console.log("  Networks: unavailable");
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
      console.log("\nUpdate complete! Rebuilding shared workspace image...");
      try {
        await runCommandStreaming("workspace", ["build"]);
        console.log("Shared workspace image rebuilt.");
      } catch (buildError) {
        const message = buildError instanceof Error ? buildError.message : String(buildError);
        console.error("Workspace image rebuild failed:", message);
        process.exitCode = 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Update failed:", message);
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
