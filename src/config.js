const fs = require("fs");
const path = require("path");
const os = require("os");
const yaml = require("yaml");
const fsExtra = require("fs-extra");
const { runCommand } = require("./utils");

const DEFAULT_CONFIG_FILENAME = ".workspace.yml";
const DEFAULT_TEMPLATE_DIR = ".workspace";
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

  // Search upward from CWD for .workspace.yml
  let currentDir = startDir;

  while (true) {
    const configPath = path.join(currentDir, DEFAULT_CONFIG_FILENAME);
    if (await fsExtra.pathExists(configPath)) {
      return currentDir;
    }

    // Stop if we've reached repo root or home
    if (currentDir === repoRoot || currentDir === homeDir || currentDir === '/') {
      break;
    }

    // Move up one directory
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break; // Reached filesystem root
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

const resolveConfig = async (config, configDir, { workspaceNameOverride } = {}) => {
  if (!config) {
    throw new Error("Invalid configuration");
  }

  // Derive workspace name from override or directory name
  const name = workspaceNameOverride || path.basename(configDir);
  const imageTag = 'workspace:latest';
  const containerName = `workspace-${name}`;

  // State directory
  const stateRoot = path.join(os.homedir(), ".workspaces", "state");
  const stateDir = path.join(stateRoot, name);

  // Repository configuration
  const repoRemote = (config.repo && config.repo.remote) || "";
  const repoBranch = (config.repo && config.repo.branch) || "main";

  // Forwards - convert to simple port numbers, expanding ranges
  const forwards = Array.isArray(config.forwards)
    ? config.forwards
        .flatMap((forward) => {
          // Support simple numbers
          if (typeof forward === "number") {
            return forward;
          }
          // Support port ranges like "5000-5010"
          if (typeof forward === "string" && forward.includes("-")) {
            const [start, end] = forward.split("-").map((s) => Number.parseInt(s.trim(), 10));
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

  // Bootstrap scripts
  const bootstrapScripts =
    config.bootstrap && Array.isArray(config.bootstrap.scripts)
      ? config.bootstrap.scripts
      : [];

  // State paths (stateRoot and stateDir already defined above)
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
      },
      forwards,
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

const ensureTemplate = async (destination) => {
  // Copy template to destination if it doesn't exist
  if (await fsExtra.pathExists(destination)) {
    return;
  }

  await fsExtra.copy(TEMPLATE_SOURCE, destination, {
    overwrite: true,
    errorOnExist: false,
  });

  const scriptsDir = path.join(destination, "scripts");
  if (await fsExtra.pathExists(scriptsDir)) {
    const files = await fsExtra.readdir(scriptsDir);
    await Promise.all(
      files
        .filter((file) => !file.startsWith("."))
        .map((file) =>
          fs.promises.chmod(path.join(scriptsDir, file), 0o755).catch(() => {}),
        ),
    );
  }
};

module.exports = {
  DEFAULT_CONFIG_FILENAME,
  DEFAULT_TEMPLATE_DIR,
  TEMPLATE_SOURCE,
  discoverRepoRoot,
  findWorkspaceDir,
  buildDefaultConfig,
  writeConfig,
  loadConfig,
  resolveConfig,
  ensureTemplate,
  configExists,
};
