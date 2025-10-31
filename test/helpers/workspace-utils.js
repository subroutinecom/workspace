const { execSync, spawn } = require("child_process");
const fs = require("fs-extra");
const path = require("path");
const yaml = require("yaml");

/**
 * E2E test utilities for workspace CLI
 */

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const PACKAGES_DIR = path.join(PROJECT_ROOT, "packages");
const WORKSPACE_CLI = path.join(PROJECT_ROOT, "src/index.js");

/**
 * Generate a unique test workspace name with timestamp
 * @param {string} baseName - Base name for the workspace
 * @returns {string} Namespaced workspace name
 */
function generateTestWorkspaceName(baseName) {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6);
  return `test-${timestamp}-${random}-${baseName}`;
}

/**
 * Execute workspace CLI command
 */
function execWorkspace(args, options = {}) {
  const cmd = `node ${WORKSPACE_CLI} ${args}`;
  return execSync(cmd, {
    encoding: "utf8",
    cwd: PROJECT_ROOT,
    ...options,
  });
}

/**
 * Create a test workspace configuration and scripts
 * @param {string} name - Workspace name
 * @param {object} config - Workspace configuration
 * @param {object} scripts - Map of script filenames to content
 * @returns {string} Path to workspace directory
 */
async function createTestWorkspace(name, config = {}, scripts = {}) {
  const workspaceDir = path.join(PACKAGES_DIR, name);
  const scriptsDir = path.join(workspaceDir, "scripts");

  await fs.ensureDir(workspaceDir);
  await fs.ensureDir(scriptsDir);

  const defaultConfig = {
    repo: {
      remote: "",
      branch: "main",
    },
    forwards: [],
    bootstrap: {
      scripts: Object.keys(scripts).map((filename) => `scripts/${filename}`),
    },
    ...config,
  };

  const configPath = path.join(workspaceDir, ".workspace.yml");
  await fs.writeFile(configPath, yaml.stringify(defaultConfig), "utf8");

  for (const [filename, content] of Object.entries(scripts)) {
    const scriptPath = path.join(scriptsDir, filename);
    await fs.writeFile(scriptPath, content, "utf8");
    await fs.chmod(scriptPath, 0o755); // Make executable
  }

  return workspaceDir;
}

/**
 * Execute a command inside a running workspace container
 * Uses docker exec directly to avoid TTY issues in tests
 * @param {string} name - Workspace name
 * @param {string} command - Command to execute
 * @param {object} options - Execution options
 * @returns {string} Command output
 */
function execInWorkspace(name, command, options = {}) {
  try {
    const containerName = `workspace-${name}`;
    // Use docker exec directly instead of the CLI to avoid -it TTY flags
    const cmd = `docker exec -u workspace ${containerName} ${command}`;
    return execSync(cmd, {
      encoding: "utf8",
      cwd: PROJECT_ROOT,
      ...options,
    });
  } catch (err) {
    // Include stderr in error for better debugging
    err.message = `${err.message}\nStderr: ${err.stderr || ""}`;
    throw err;
  }
}

/**
 * Read a file from inside a workspace container
 * @param {string} name - Workspace name
 * @param {string} filePath - Absolute path inside container
 * @returns {string} File contents
 */
function readFileInWorkspace(name, filePath) {
  return execInWorkspace(name, `cat ${filePath}`).trim();
}

/**
 * Check if a file or directory exists inside a workspace container
 * @param {string} name - Workspace name
 * @param {string} filePath - Absolute path inside container
 * @returns {boolean}
 */
function fileExistsInWorkspace(name, filePath) {
  try {
    execInWorkspace(name, `test -e ${filePath}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start a workspace and wait for it to be ready
 * @param {string} name - Workspace name
 * @param {object} options - Start options
 */
function startWorkspace(name, options = {}) {
  const args = ["start", name];
  if (options.rebuild) args.push("--rebuild");
  if (options.noCache) args.push("--no-cache");
  if (options.forceRecreate) args.push("--force-recreate");

  const workspaceDir = path.join(PACKAGES_DIR, name);
  if (fs.existsSync(path.join(workspaceDir, ".workspace.yml"))) {
    return execSync(
      `cd ${workspaceDir} && node ${path.join(__dirname, "../../src/index.js")} ${args.join(" ")}`,
      { stdio: "inherit", encoding: "utf8", shell: "/bin/bash" }
    );
  }

  throw new Error(`Workspace ${name} not found at ${workspaceDir}`);
}

/**
 * Stop a workspace
 * @param {string} name - Workspace name
 */
function stopWorkspace(name) {
  try {
    const workspaceDir = path.join(PACKAGES_DIR, name);
    if (fs.existsSync(path.join(workspaceDir, ".workspace.yml"))) {
      return execSync(
        `cd ${workspaceDir} && node ${path.join(__dirname, "../../src/index.js")} stop ${name}`,
        { stdio: "inherit", encoding: "utf8", shell: "/bin/bash" }
      );
    }
  } catch (err) {
    // Ignore errors if workspace is already stopped
    if (!err.message.includes("already stopped")) {
      throw err;
    }
  }
}

/**
 * Destroy a workspace (remove container and volumes)
 * @param {string} name - Workspace name
 */
function destroyWorkspace(name) {
  try {
    // First try to use workspace command from workspace directory
    const workspaceDir = path.join(PACKAGES_DIR, name);
    if (fs.existsSync(path.join(workspaceDir, ".workspace.yml"))) {
      return execSync(
        `cd ${workspaceDir} && node ${path.join(__dirname, "../../src/index.js")} destroy ${name} --force`,
        { stdio: "pipe", encoding: "utf8", shell: "/bin/bash" }
      );
    }
  } catch (err) {
    // Ignore and fall through to docker cleanup
  }

  // Fallback: use docker directly to clean up
  try {
    const containerName = `workspace-${name}`;

    // Remove container if exists
    try {
      execSync(`docker rm -f ${containerName}`, { stdio: "pipe" });
    } catch (err) {
      // Container might not exist
    }

    // Remove volumes if exist
    const volumes = [`${containerName}-home`, `${containerName}-docker`, `${containerName}-cache`];
    for (const vol of volumes) {
      try {
        execSync(`docker volume rm ${vol}`, { stdio: "pipe" });
      } catch (err) {
        // Volume might not exist
      }
    }

    return;
  } catch (err) {
    // Ignore cleanup errors
    return;
  }
}

/**
 * Clean up test workspace files and container
 * @param {string} name - Workspace name
 */
async function cleanupTestWorkspace(name) {
  destroyWorkspace(name);

  const workspaceDir = path.join(PACKAGES_DIR, name);
  if (await fs.pathExists(workspaceDir)) {
    await fs.remove(workspaceDir);
  }
}

/**
 * Wait for a condition with timeout
 * @param {Function} condition - Async function that returns true when ready
 * @param {number} timeout - Timeout in milliseconds
 * @param {number} interval - Check interval in milliseconds
 */
async function waitFor(condition, timeout = 30000, interval = 1000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

/**
 * Get workspace container status
 * @param {string} name - Workspace name
 * @returns {object|null} Container status or null if not found
 */
function getWorkspaceStatus(name) {
  try {
    const output = execWorkspace(`status ${name}`);
    return { running: output.includes("Status    : running") };
  } catch {
    return null;
  }
}

module.exports = {
  execWorkspace,
  createTestWorkspace,
  execInWorkspace,
  readFileInWorkspace,
  fileExistsInWorkspace,
  startWorkspace,
  stopWorkspace,
  destroyWorkspace,
  cleanupTestWorkspace,
  waitFor,
  getWorkspaceStatus,
  generateTestWorkspaceName,
};
