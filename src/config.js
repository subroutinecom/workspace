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

const getGitRemote = async (repoRoot) => {
  try {
    const { stdout } = await runCommand("git", ["config", "--get", "remote.origin.url"], {
      cwd: repoRoot,
    });
    return stdout || "";
  } catch {
    return "";
  }
};

const getGitBranch = async (repoRoot) => {
  try {
    const { stdout } = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repoRoot,
    });
    return stdout || "main";
  } catch {
    return "main";
  }
};

const buildDefaultConfig = async (repoRoot) => {
  const remote = await getGitRemote(repoRoot);
  const branch = await getGitBranch(repoRoot);

  return {
    repo: {
      remote: remote || "",
      branch: branch || "main",
    },
    forwards: [3000],
  };
};

const configExists = async (repoRoot, filename = DEFAULT_CONFIG_FILENAME) =>
  fsExtra.pathExists(path.join(repoRoot, filename));

const writeConfig = async (repoRoot, config, options = {}) => {
  const configPath = path.join(
    repoRoot,
    options.filename || DEFAULT_CONFIG_FILENAME,
  );
  const yamlContents = yaml.stringify(config, { indent: 2 });
  await fsExtra.writeFile(configPath, yamlContents, "utf8");
  return configPath;
};

const loadConfig = async (repoRoot, filename = DEFAULT_CONFIG_FILENAME) => {
  const configPath = path.join(repoRoot, filename);
  const contents = await fsExtra.readFile(configPath, "utf8");
  return yaml.parse(contents);
};

const resolveConfig = async (config, repoRoot, { workspaceNameOverride, gitRepoRoot } = {}) => {
  if (!config) {
    throw new Error("Invalid configuration");
  }

  // Derive workspace name from override or repo root
  const name = workspaceNameOverride || path.basename(repoRoot);
  const imageTag = `workspace/${name}:latest`;
  const containerName = `workspace-${name}`;

  // Calculate relative path from git repo root to config directory
  // This is used to resolve bootstrap scripts inside the container
  const actualGitRoot = gitRepoRoot || (await discoverRepoRoot(repoRoot));
  const configDirRelative = path.relative(actualGitRoot, repoRoot);

  // Template directory (stored in state dir, not in repo)
  const stateRoot = path.join(os.homedir(), ".workspaces");
  const stateDir = path.join(stateRoot, name);
  const templateAbsolute = path.join(stateDir, ".workspace");

  // Repository configuration
  const repoRemote = (config.repo && config.repo.remote) || "";
  const repoBranch = (config.repo && config.repo.branch) || "main";

  // Forwards - convert to simple port numbers
  const forwards = Array.isArray(config.forwards)
    ? config.forwards
        .map((forward) => {
          // Support both simple numbers and objects for backwards compatibility
          if (typeof forward === "number") {
            return forward;
          }
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
      repoRoot,
      configFile: path.join(repoRoot, DEFAULT_CONFIG_FILENAME),
    },
    workspace: {
      name,
      imageTag,
      containerName,
      templateDir: {
        absolute: templateAbsolute,
      },
      repo: {
        remote: repoRemote,
        branch: repoBranch,
      },
      forwards,
      bootstrap: {
        scripts: bootstrapScripts,
        configDirRelative,
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
  buildDefaultConfig,
  writeConfig,
  loadConfig,
  resolveConfig,
  ensureTemplate,
  configExists,
};
