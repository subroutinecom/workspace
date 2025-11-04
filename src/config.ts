import path from "path";
import os from "os";
import yaml from "yaml";
import fsExtra from "fs-extra";
import { runCommand } from "./utils";

export const DEFAULT_CONFIG_FILENAME = ".workspace.yml";
export const USER_CONFIG_FILENAME = "config.yml";

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const TEMPLATE_SOURCE = path.join(PACKAGE_ROOT, "workspace");

type ForwardInput = number | string | { internal: string | number };

interface RepoConfig {
  remote?: string;
  branch?: string;
  cloneArgs?: string[];
}

type BootstrapScriptEntry = string | { path: string; source?: string };

interface BootstrapConfig {
  scripts?: BootstrapScriptEntry[];
}

export interface WorkspaceConfig {
  repo?: RepoConfig;
  forwards?: ForwardInput[];
  mounts?: string[];
  bootstrap?: BootstrapConfig;
  mountAgentsCredentials?: boolean;
  [key: string]: unknown;
}

export interface ResolvedBootstrapScript {
  path: string;
  source: string;
}

export interface ResolvedMount {
  source: string;
  target: string;
  mode: string;
}

export interface ResolvedWorkspaceConfig {
  raw: WorkspaceConfig;
  paths: {
    configDir: string;
    configFile: string;
  };
  workspace: {
    name: string;
    imageTag: string;
    containerName: string;
    configDir: string;
    buildContext: string;
    repo: {
      remote: string;
      branch: string;
      cloneArgs: string[];
    };
    forwards: number[];
    mounts: ResolvedMount[];
    bootstrap: {
      scripts: ResolvedBootstrapScript[];
    };
    state: {
      root: string;
      sshDir: string;
      keyPath: string;
      runtimeConfigPath: string;
    };
  };
}

interface FindWorkspaceOptions {
  path?: string;
}

export const discoverRepoRoot = async (cwd: string = process.cwd()): Promise<string> => {
  try {
    const { stdout } = await runCommand("git", ["rev-parse", "--show-toplevel"], {
      cwd,
    });
    return stdout || cwd;
  } catch {
    return cwd;
  }
};

export const findWorkspaceDir = async (options: FindWorkspaceOptions = {}): Promise<string> => {
  const startDir = options.path ? path.resolve(options.path) : process.cwd();
  const repoRoot = await discoverRepoRoot(startDir);
  const homeDir = os.homedir();

  let currentDir = startDir;

  while (true) {
    const configPath = path.join(currentDir, DEFAULT_CONFIG_FILENAME);
    if (await fsExtra.pathExists(configPath)) {
      return currentDir;
    }

    if (currentDir === repoRoot || currentDir === homeDir || currentDir === "/") {
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
      `Create ${DEFAULT_CONFIG_FILENAME} in your project directory.`,
  );
};

const getGitRemote = async (configDir: string): Promise<string> => {
  try {
    const { stdout } = await runCommand("git", ["config", "--get", "remote.origin.url"], {
      cwd: configDir,
    });
    return stdout || "";
  } catch {
    return "";
  }
};

const getGitBranch = async (configDir: string): Promise<string> => {
  try {
    const { stdout } = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: configDir,
    });
    return stdout || "main";
  } catch {
    return "main";
  }
};

export const buildDefaultConfig = async (configDir: string): Promise<WorkspaceConfig> => {
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

export const configExists = async (
  configDir: string,
  filename: string = DEFAULT_CONFIG_FILENAME,
): Promise<boolean> => fsExtra.pathExists(path.join(configDir, filename));

export const writeConfig = async (
  configDir: string,
  config: WorkspaceConfig,
  options: { filename?: string } = {},
): Promise<string> => {
  const configPath = path.join(configDir, options.filename || DEFAULT_CONFIG_FILENAME);
  const yamlContents = yaml.stringify(config, { indent: 2 });
  await fsExtra.writeFile(configPath, yamlContents, "utf8");
  return configPath;
};

export const loadConfig = async (
  configDir: string,
  filename: string = DEFAULT_CONFIG_FILENAME,
): Promise<WorkspaceConfig> => {
  const configPath = path.join(configDir, filename);
  const contents = await fsExtra.readFile(configPath, "utf8");
  return yaml.parse(contents) as WorkspaceConfig;
};

export const getUserConfigDir = (): string => {
  return path.join(os.homedir(), ".workspaces");
};

export const getUserConfigPath = (): string => {
  return path.join(getUserConfigDir(), USER_CONFIG_FILENAME);
};

export const ensureUserConfig = async (): Promise<void> => {
  const configDir = getUserConfigDir();
  const configPath = getUserConfigPath();
  const userScriptsDir = path.join(configDir, "userscripts");

  await fsExtra.ensureDir(configDir);
  await fsExtra.ensureDir(userScriptsDir);

  if (!(await fsExtra.pathExists(configPath))) {
    const defaultUserConfig: WorkspaceConfig = {
      bootstrap: {
        scripts: ["userscripts"],
      },
      mountAgentsCredentials: false,
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

export const loadUserConfig = async (): Promise<WorkspaceConfig | null> => {
  const configPath = getUserConfigPath();
  if (!(await fsExtra.pathExists(configPath))) {
    return null;
  }
  const contents = await fsExtra.readFile(configPath, "utf8");
  return yaml.parse(contents) as WorkspaceConfig;
};

export const mergeConfigs = (
  projectConfig: WorkspaceConfig,
  userConfig: WorkspaceConfig | null,
): WorkspaceConfig => {
  if (!userConfig) {
    return projectConfig;
  }

  const merged: WorkspaceConfig = { ...projectConfig };

  if (userConfig.forwards) {
    merged.forwards = [...(merged.forwards || []), ...(userConfig.forwards || [])];
  }

  if (userConfig.mounts) {
    merged.mounts = [...(merged.mounts || []), ...(userConfig.mounts || [])];
  }

  if (userConfig.bootstrap) {
    const normalizeScripts = (scripts: any) => {
      if (!scripts) return [];
      if (typeof scripts === "string") return [scripts];
      if (Array.isArray(scripts)) return scripts;
      return [];
    };

    const projectScripts = normalizeScripts(projectConfig.bootstrap?.scripts).map((script) => {
      if (typeof script === "string") {
        return { path: script, source: "project" };
      }
      return { path: script.path, source: script.source || "project" };
    });
    const userScripts = normalizeScripts(userConfig.bootstrap?.scripts).map((script) => {
      if (typeof script === "string") {
        return { path: script, source: "user" };
      }
      return { path: script.path, source: script.source || "user" };
    });

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

  if (typeof userConfig.mountAgentsCredentials === "boolean") {
    merged.mountAgentsCredentials = userConfig.mountAgentsCredentials;
  }

  return merged;
};

export const resolveConfig = async (
  config: WorkspaceConfig,
  configDir: string,
  { workspaceNameOverride }: { workspaceNameOverride?: string } = {},
): Promise<ResolvedWorkspaceConfig> => {
  if (!config) {
    throw new Error("Invalid configuration");
  }

  const name = workspaceNameOverride || path.basename(configDir);
  const imageTag = "workspace:latest";
  const containerName = `workspace-${name}`;

  const stateRoot = path.join(os.homedir(), ".workspaces", "state");
  const stateDir = path.join(stateRoot, name);

  const repoRemote = config.repo?.remote || "";
  const repoBranch = config.repo?.branch || "main";
  const repoCloneArgs = config.repo?.cloneArgs || [];

  const forwards = Array.isArray(config.forwards)
    ? config.forwards
        .flatMap((forward) => {
          if (typeof forward === "number") {
            return forward;
          }
          if (typeof forward === "string" && (forward.includes("-") || forward.includes(":"))) {
            const separator = forward.includes(":") ? ":" : "-";
            const [start, end] = forward.split(separator).map((s) => Number.parseInt(s.trim(), 10));
            if (!Number.isNaN(start) && !Number.isNaN(end) && start <= end && start > 0) {
              const range: number[] = [];
              for (let port = start; port <= end; port++) {
                range.push(port);
              }
              return range;
            }
            return null;
          }
          if (typeof forward === "object" && forward.internal) {
            return Number.parseInt(String(forward.internal), 10);
          }
          return null;
        })
        .filter((port): port is number => port != null && !Number.isNaN(port) && port > 0)
    : [];

  const bootstrapScripts: ResolvedBootstrapScript[] =
    config.bootstrap && Array.isArray(config.bootstrap.scripts)
      ? config.bootstrap.scripts.map((script) => {
          if (typeof script === "string") {
            return { path: script, source: "project" };
          }
          return { path: script.path, source: script.source || "project" };
        })
      : [];

  const mounts: ResolvedMount[] = Array.isArray(config.mounts)
    ? config.mounts
        .map((mount) => {
          if (typeof mount !== "string") return null;

          const parts = mount.split(":");
          if (parts.length < 2) return null;

          let source: string;
          let target: string;
          let mode: string;

          if (parts.length === 2) {
            [source, target] = parts;
            mode = "rw";
          } else if (parts.length === 3) {
            [source, target, mode] = parts;
            if (mode !== "ro" && mode !== "rw") {
              mode = "rw";
            }
          } else if (parts.length === 4) {
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
        .filter((mount): mount is ResolvedMount => mount !== null)
    : [];

  if (config.mountAgentsCredentials === true) {
    const homeDir = os.homedir();
    const credentialCandidates = [
      {
        source: path.join(homeDir, ".codex", "auth.json"),
        target: "/home/workspace/.codex/auth.json",
      },
      {
        source: path.join(homeDir, ".local", "share", "opencode", "auth.json"),
        target: "/home/workspace/.local/share/opencode/auth.json",
      },
      {
        source: path.join(homeDir, ".claude", ".credentials.json"),
        target: "/home/workspace/.claude/.credentials.json",
      },
    ];

    for (const credential of credentialCandidates) {
      if (await fsExtra.pathExists(credential.source)) {
        mounts.push({
          source: credential.source,
          target: credential.target,
          mode: "rw",
        });
      }
    }
  }

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

export { TEMPLATE_SOURCE };
