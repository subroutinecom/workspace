const fs = require("fs");
const path = require("path");
const os = require("os");
const yaml = require("yaml");
const fsExtra = require("fs-extra");
const { runCommand } = require("./utils");

const DEFAULT_CONFIG_FILENAME = ".workspace.yml";
const USER_CONFIG_FILENAME = "config.yml";
const PACKAGE_ROOT = path.resolve(__dirname, "..");
const TEMPLATE_SOURCE = path.join(PACKAGE_ROOT, "workspace");

const discoverRepoRoot = async (cwd = process.cwd()) => {
  try {
    const { stdout } = await runCommand("git", ["rev-parse", "--show-toplevel"], {
      cwd,
    });
    return stdout || cwd;
  } catch {
    return cwd;
  }
};

/**
 * Search upward from CWD (or options.path) for the nearest .workspace.yml
 * Workspace name is completely independent of directory structure
 */
const findWorkspaceDir = async (options = {}) => {
  const startDir = options.path
    ? path.resolve(options.path)
    : process.cwd();
  const repoRoot = await discoverRepoRoot(startDir);
  const homeDir = os.homedir();

  let currentDir = startDir;

  while (true) {
    const configPath = path.join(currentDir, DEFAULT_CONFIG_FILENAME);
    if (await fsExtra.pathExists(configPath)) {
      return currentDir;
    }

    if (currentDir === repoRoot || currentDir === homeDir || currentDir === '/') {
      break;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  throw new Error(
    `No ${DEFAULT_CONFIG_FILENAME} found from ${startDir} to ${repoRoot}. ` +
    `Create ${DEFAULT_CONFIG_FILENAME} in your project directory.`
  );
};

const getGitRemote = async (configDir) => {
  try {
    const { stdout } = await runCommand("git", ["config", "--get", "remote.origin.url"], {
      cwd: configDir,
    });
    return stdout || "";
  } catch {
    return "";
  }
};

const getGitBranch = async (configDir) => {
  try {
    const { stdout } = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: configDir,
    });
    return stdout || "main";
  } catch {
    return "main";
  }
};

const buildDefaultConfig = async (configDir) => {
  const remote = await getGitRemote(configDir);
  const branch = await getGitBranch(configDir);

  return {
    repo: {
      remote: remote || "",
      branch: branch || "main",
    },
    forwards: [3000],
  };
};

const configExists = async (configDir, filename = DEFAULT_CONFIG_FILENAME) =>
  fsExtra.pathExists(path.join(configDir, filename));

const writeConfig = async (configDir, config, options = {}) => {
  const configPath = path.join(
    configDir,
    options.filename || DEFAULT_CONFIG_FILENAME,
  );
  const yamlContents = yaml.stringify(config, { indent: 2 });
  await fsExtra.writeFile(configPath, yamlContents, "utf8");
  return configPath;
};

const loadConfig = async (configDir, filename = DEFAULT_CONFIG_FILENAME) => {
  const configPath = path.join(configDir, filename);
  const contents = await fsExtra.readFile(configPath, "utf8");
  return yaml.parse(contents);
};

const getUserConfigDir = () => {
  return path.join(os.homedir(), ".workspaces");
};

const getUserConfigPath = () => {
  return path.join(getUserConfigDir(), USER_CONFIG_FILENAME);
};

const ensureUserConfig = async () => {
  const configDir = getUserConfigDir();
  const configPath = getUserConfigPath();
  const userScriptsDir = path.join(configDir, "userscripts");

  await fsExtra.ensureDir(configDir);
  await fsExtra.ensureDir(userScriptsDir);

  if (!(await fsExtra.pathExists(configPath))) {
    const defaultUserConfig = {
      bootstrap: {
        scripts: ["userscripts"],
      },
    };
    await writeConfig(configDir, defaultUserConfig, { filename: USER_CONFIG_FILENAME });
  }

  const exampleScriptPath = path.join(userScriptsDir, "example.sh");
  if (!(await fsExtra.pathExists(exampleScriptPath))) {
    const exampleScript = `#!/bin/bash
# Example user bootstrap script
# This script runs in all workspaces after project-specific scripts
echo "Hello from user bootstrap script!"
`;
    await fsExtra.writeFile(exampleScriptPath, exampleScript, "utf8");
    await fsExtra.chmod(exampleScriptPath, 0o755);
  }
};

const loadUserConfig = async () => {
  const configPath = getUserConfigPath();
  if (!(await fsExtra.pathExists(configPath))) {
    return null;
  }
  const contents = await fsExtra.readFile(configPath, "utf8");
  return yaml.parse(contents);
};

const mergeConfigs = (projectConfig, userConfig) => {
  if (!userConfig) {
    return projectConfig;
  }

  const merged = { ...projectConfig };

  if (userConfig.forwards) {
    merged.forwards = [
      ...(merged.forwards || []),
      ...(userConfig.forwards || []),
    ];
  }

  if (userConfig.mounts) {
    merged.mounts = [
      ...(merged.mounts || []),
      ...(userConfig.mounts || []),
    ];
  }

  if (userConfig.bootstrap) {
    const projectScripts = (projectConfig.bootstrap?.scripts || []).map(script => ({
      path: script,
      source: 'project'
    }));
    const userScripts = (userConfig.bootstrap?.scripts || []).map(script => ({
      path: script,
      source: 'user'
    }));

    merged.bootstrap = {
      scripts: [...projectScripts, ...userScripts],
    };
  }

  if (userConfig.repo) {
    merged.repo = {
      ...(merged.repo || {}),
      ...(userConfig.repo || {}),
    };
  }

  return merged;
};

const resolveConfig = async (config, configDir, { workspaceNameOverride } = {}) => {
  if (!config) {
    throw new Error("Invalid configuration");
  }

  const name = workspaceNameOverride || path.basename(configDir);
  const imageTag = 'workspace:latest';
  const containerName = `workspace-${name}`;

  const stateRoot = path.join(os.homedir(), ".workspaces", "state");
  const stateDir = path.join(stateRoot, name);

  const repoRemote = (config.repo && config.repo.remote) || "";
  const repoBranch = (config.repo && config.repo.branch) || "main";
  const repoCloneArgs = (config.repo && config.repo.cloneArgs) || [];

  const forwards = Array.isArray(config.forwards)
    ? config.forwards
        .flatMap((forward) => {
          if (typeof forward === "number") {
            return forward;
          }
          // Support port ranges like "5000-5010" or "5000:5010"
          if (typeof forward === "string" && (forward.includes("-") || forward.includes(":"))) {
            const separator = forward.includes(":") ? ":" : "-";
            const [start, end] = forward.split(separator).map((s) => Number.parseInt(s.trim(), 10));
            if (!Number.isNaN(start) && !Number.isNaN(end) && start <= end && start > 0) {
              const range = [];
              for (let port = start; port <= end; port++) {
                range.push(port);
              }
              return range;
            }
            return null;
          }
          // Support objects for backwards compatibility
          if (typeof forward === "object" && forward.internal) {
            return Number.parseInt(forward.internal, 10);
          }
          return null;
        })
        .filter((port) => !Number.isNaN(port) && port > 0)
    : [];

  const bootstrapScripts =
    config.bootstrap && Array.isArray(config.bootstrap.scripts)
      ? config.bootstrap.scripts.map(script => {
          if (typeof script === 'string') {
            return { path: script, source: 'project' };
          }
          return script;
        })
      : [];

  // Parse mount format: /host/path:/container/path[:ro|:rw]
  const mounts = Array.isArray(config.mounts)
    ? config.mounts
        .map((mount) => {
          if (typeof mount !== "string") return null;

          const parts = mount.split(":");
          if (parts.length < 2) return null;

          let source, target, mode;

          if (parts.length === 2) {
            [source, target] = parts;
            mode = "rw";
          } else if (parts.length === 3) {
            [source, target, mode] = parts;
            if (mode !== "ro" && mode !== "rw") {
              mode = "rw";
            }
          } else if (parts.length === 4) {
            // Handle Windows paths like C:/path:/container/path:ro
            source = `${parts[0]}:${parts[1]}`;
            target = parts[2];
            mode = parts[3];
            if (mode !== "ro" && mode !== "rw") {
              mode = "rw";
            }
          } else {
            return null;
          }

          if (source.startsWith("~")) {
            source = source.replace("~", os.homedir());
          }

          if (!path.isAbsolute(source)) {
            source = path.join(configDir, source);
          }

          return { source, target, mode };
        })
        .filter((mount) => mount !== null)
    : [];

  const sshDir = path.join(stateDir, "ssh");
  const keyPath = path.join(sshDir, "id_ed25519");
  const runtimeConfigPath = path.join(stateDir, "runtime.json");

  return {
    raw: config,
    paths: {
      configDir,
      configFile: path.join(configDir, DEFAULT_CONFIG_FILENAME),
    },
    workspace: {
      name,
      imageTag,
      containerName,
      configDir,
      buildContext: TEMPLATE_SOURCE,
      repo: {
        remote: repoRemote,
        branch: repoBranch,
        cloneArgs: repoCloneArgs,
      },
      forwards,
      mounts,
      bootstrap: {
        scripts: bootstrapScripts,
      },
      state: {
        root: stateDir,
        sshDir,
        keyPath,
        runtimeConfigPath,
      },
    },
  };
};

module.exports = {
  DEFAULT_CONFIG_FILENAME,
  USER_CONFIG_FILENAME,
  TEMPLATE_SOURCE,
  discoverRepoRoot,
  findWorkspaceDir,
  buildDefaultConfig,
  writeConfig,
  loadConfig,
  resolveConfig,
  configExists,
  getUserConfigDir,
  getUserConfigPath,
  ensureUserConfig,
  loadUserConfig,
  mergeConfigs,
};
