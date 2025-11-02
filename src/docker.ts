import {
  runCommand,
  runCommandStreaming,
  type CommandOptions,
  type StreamingCommandOptions,
  type CommandResult,
} from "./utils";

type DockerCommandOptions = CommandOptions;
type DockerStreamingOptions = StreamingCommandOptions;

export const dockerCommand = (args: string[], options: DockerCommandOptions = {}): Promise<CommandResult> =>
  runCommand("docker", args, options);

export const dockerCommandStreaming = (
  args: string[],
  options: DockerStreamingOptions = {},
): Promise<void> => runCommandStreaming("docker", args, options);

export const imageExists = async (tag: string): Promise<boolean> => {
  try {
    await dockerCommand(["image", "inspect", tag]);
    return true;
  } catch {
    return false;
  }
};

interface BuildImageOptions {
  noCache?: boolean;
  buildArgs?: Record<string, string>;
}

export const buildImage = async (
  tag: string,
  contextDir: string,
  options: BuildImageOptions = {},
): Promise<void> => {
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

export const containerExists = async (name: string): Promise<boolean> => {
  const { stdout } = await dockerCommand(["ps", "-a", "-q", "--filter", `name=^${name}$`]);
  return stdout.trim().length > 0;
};

export const containerRunning = async (name: string): Promise<boolean> => {
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

interface RunContainerOptions extends DockerStreamingOptions {
  quiet?: boolean;
}

export const createContainer = async (args: string[], options: RunContainerOptions = {}): Promise<void> => {
  const quiet = options.quiet !== false;
  await dockerCommandStreaming(["run", ...args], { ...options, quiet });
};

export const startContainer = async (name: string, options: RunContainerOptions = {}): Promise<void> => {
  const quiet = options.quiet !== false;
  await dockerCommandStreaming(["start", name], { quiet });
};

export const stopContainer = async (name: string): Promise<void> => {
  await dockerCommandStreaming(["stop", name]);
};

export const removeContainer = async (name: string, { force = false }: { force?: boolean } = {}): Promise<void> => {
  if (force) {
    await dockerCommandStreaming(["rm", "-f", name]);
  } else {
    await dockerCommandStreaming(["rm", name]);
  }
};

export const removeVolumes = async (volumes: string[] = []): Promise<void> => {
  if (!volumes.length) {
    return;
  }
  const existing: string[] = [];
  for (const vol of volumes) {
    if (await volumeExists(vol)) {
      existing.push(vol);
    }
  }
  if (existing.length > 0) {
    await dockerCommandStreaming(["volume", "rm", ...existing]);
  }
};

export const inspectContainer = async (name: string): Promise<unknown[] | null> => {
  try {
    const { stdout } = await dockerCommand(["inspect", name]);
    return JSON.parse(stdout) as unknown[];
  } catch {
    return null;
  }
};

export const networkExists = async (name: string): Promise<boolean> => {
  try {
    await dockerCommand(["network", "inspect", name]);
    return true;
  } catch {
    return false;
  }
};

export const createNetwork = async (name: string): Promise<void> => {
  await dockerCommand(["network", "create", name]);
};

export const volumeExists = async (name: string): Promise<boolean> => {
  try {
    await dockerCommand(["volume", "inspect", name]);
    return true;
  } catch {
    return false;
  }
};

export const createVolume = async (name: string): Promise<void> => {
  await dockerCommand(["volume", "create", name]);
};

export const connectToNetwork = async (containerName: string, networkName: string): Promise<void> => {
  try {
    await dockerCommand(["network", "connect", networkName, containerName]);
  } catch (err) {
    const message = err instanceof Error ? (err as { stderr?: string }).stderr : null;
    if (!message || !message.includes("already exists in network")) {
      throw err;
    }
  }
};

export const execInContainer = async (
  containerName: string,
  command: string[],
  { user = null }: { user?: string | null } = {},
): Promise<CommandResult> => {
  const args = ["exec"];
  if (user) {
    args.push("-u", user);
  }
  args.push(containerName, ...command);
  return dockerCommand(args);
};
