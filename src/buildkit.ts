import { runCommand, sleep } from "./utils";
import {
  containerExists,
  containerRunning,
  createContainer,
  createNetwork,
  createVolume,
  execInContainer,
  networkExists,
  startContainer,
  volumeExists,
} from "./docker";
import type { Logger } from "./cli/ui";

export interface SharedBuildKitInfo {
  networkName: string;
  volumeName: string;
  buildkitdName: string;
  buildkitdPort: number;
}

export const waitForContainer = async (
  containerName: string,
  logger: Logger,
  timeoutMs = 15000,
): Promise<void> => {
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

export const waitForDockerd = async (
  containerName: string,
  logger: Logger,
  timeoutMs = 30000,
): Promise<void> => {
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

export const ensureSharedBuildKit = async (logger: Logger): Promise<SharedBuildKitInfo> => {
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

export const configureBuildxInContainer = async (
  containerName: string,
  buildkitInfo: SharedBuildKitInfo,
  logger: Logger,
): Promise<void> => {
  const builderName = "workspace-internal-builder";
  const buildkitdEndpoint = `tcp://${buildkitInfo.buildkitdName}:${buildkitInfo.buildkitdPort}`;
  const user = "workspace";

  logger.update("Configuring buildx...");

  try {
    await execInContainer(containerName, ["docker", "buildx", "rm", builderName], { user });
  } catch {
    // Builder might not exist yet; ignore.
  }

  try {
    await execInContainer(
      containerName,
      ["docker", "buildx", "create", "--name", builderName, "--driver", "remote", buildkitdEndpoint, "--use"],
      { user },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create buildx builder: ${message}`);
  }

  try {
    await execInContainer(containerName, ["docker", "buildx", "inspect", "--bootstrap"], { user });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to bootstrap buildx builder: ${message}`);
  }
};
