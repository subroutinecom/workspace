const { runCommand, runCommandStreaming } = require("./utils");

const dockerCommand = (args, options = {}) => runCommand("docker", args, options);
const dockerCommandStreaming = (args, options = {}) =>
  runCommandStreaming("docker", args, options);

const imageExists = async (tag) => {
  try {
    await dockerCommand(["image", "inspect", tag]);
    return true;
  } catch {
    return false;
  }
};

const buildImage = async (tag, contextDir, options = {}) => {
  const args = ["build", "-t", tag, contextDir];
  if (options.noCache) {
    args.splice(1, 0, "--no-cache");
  }
  if (options.buildArgs) {
    Object.entries(options.buildArgs).forEach(([key, value]) => {
      args.splice(1, 0, "--build-arg", `${key}=${value}`);
    });
  }
  await dockerCommandStreaming(args, { cwd: contextDir });
};

const containerExists = async (name) => {
  const { stdout } = await dockerCommand([
    "ps",
    "-a",
    "-q",
    "--filter",
    `name=^${name}$`,
  ]);
  return stdout.trim().length > 0;
};

const containerRunning = async (name) => {
  const { stdout } = await dockerCommand([
    "ps",
    "-q",
    "--filter",
    `name=^${name}$`,
    "--filter",
    "status=running",
  ]);
  return stdout.trim().length > 0;
};

const createContainer = async (args, options = {}) => {
  const quiet = options.quiet !== false;
  await dockerCommandStreaming(["run", ...args], { quiet, ...options });
};

const startContainer = async (name, options = {}) => {
  const quiet = options.quiet !== false;
  await dockerCommandStreaming(["start", name], { quiet });
};

const stopContainer = async (name) => {
  await dockerCommandStreaming(["stop", name]);
};

const removeContainer = async (name, { force = false } = {}) => {
  if (force) {
    await dockerCommandStreaming(["rm", "-f", name]);
  } else {
    await dockerCommandStreaming(["rm", name]);
  }
};

const removeVolumes = async (volumes = []) => {
  if (!volumes.length) {
    return;
  }
  const existing = [];
  for (const vol of volumes) {
    if (await volumeExists(vol)) {
      existing.push(vol);
    }
  }
  if (existing.length > 0) {
    await dockerCommandStreaming(["volume", "rm", ...existing]);
  }
};

const inspectContainer = async (name) => {
  try {
    const { stdout } = await dockerCommand(["inspect", name]);
    return JSON.parse(stdout);
  } catch {
    return null;
  }
};

const networkExists = async (name) => {
  try {
    await dockerCommand(["network", "inspect", name]);
    return true;
  } catch {
    return false;
  }
};

const createNetwork = async (name) => {
  await dockerCommand(["network", "create", name]);
};

const volumeExists = async (name) => {
  try {
    await dockerCommand(["volume", "inspect", name]);
    return true;
  } catch {
    return false;
  }
};

const createVolume = async (name) => {
  await dockerCommand(["volume", "create", name]);
};

const connectToNetwork = async (containerName, networkName) => {
  try {
    await dockerCommand(["network", "connect", networkName, containerName]);
  } catch (err) {
    if (!err.stderr?.includes("already exists in network")) {
      throw err;
    }
  }
};

const execInContainer = async (containerName, command, { user = null } = {}) => {
  const args = ["exec"];
  if (user) {
    args.push("-u", user);
  }
  args.push(containerName, ...command);
  return await dockerCommand(args);
};

module.exports = {
  dockerCommand,
  dockerCommandStreaming,
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
};
