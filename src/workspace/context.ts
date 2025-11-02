import fs from "fs";
import os from "os";
import path from "path";
import type { WorkspaceConfig, ResolvedWorkspaceConfig } from "../config";
import {
  DEFAULT_CONFIG_FILENAME,
  ensureUserConfig,
  findWorkspaceDir,
  loadConfig,
  loadUserConfig,
  mergeConfigs,
  resolveConfig,
} from "../config";

export interface BaseCommandOptions {
  config?: string;
  path?: string;
  verbose?: boolean;
  [key: string]: unknown;
}

export interface WorkspaceConfigResult {
  configDir: string;
  raw: WorkspaceConfig;
  resolved: ResolvedWorkspaceConfig;
}

export interface WorkspaceInfo {
  name: string;
  containerName: string;
  keyPath: string;
  stateDir: string;
  configInfo: WorkspaceConfigResult | null;
}

export interface StoredWorkspaceState {
  sshPort: number;
  forwards: number[];
  configDir: string;
}

export const withConfig = async (
  options: BaseCommandOptions = {},
  workspaceName?: string,
): Promise<WorkspaceConfigResult> => {
  const configFilename = options.config || DEFAULT_CONFIG_FILENAME;

  await ensureUserConfig();

  const workspaceDir = await findWorkspaceDir(options);

  const projectConfig = await loadConfig(workspaceDir, configFilename);
  const userConfig = await loadUserConfig();

  if (options.verbose) {
    console.log("\n=== Configuration Loading ===");
    console.log(`Project config dir: ${workspaceDir}`);
    console.log(`Project config file: ${configFilename}`);
    console.log("\n--- Project Config ---");
    console.log(JSON.stringify(projectConfig, null, 2));
    console.log("\n--- User Config (~/.workspaces/config.yml) ---");
    console.log(JSON.stringify(userConfig, null, 2));
  }

  const raw = mergeConfigs(projectConfig, userConfig);

  if (options.verbose) {
    console.log("\n--- Merged Config ---");
    console.log(JSON.stringify(raw, null, 2));
    console.log("=== End Configuration Loading ===\n");
  }

  const resolved = await resolveConfig(raw, workspaceDir, {
    workspaceNameOverride: workspaceName,
  });

  return { configDir: workspaceDir, raw, resolved };
};

export const getWorkspaceInfo = async (
  workspaceName: string,
  options: BaseCommandOptions = {},
): Promise<WorkspaceInfo> => {
  const containerName = `workspace-${workspaceName}`;
  const stateDir = path.join(os.homedir(), ".workspaces", "state", workspaceName);
  const keyPath = path.join(stateDir, "ssh", "id_ed25519");

  let configInfo: WorkspaceConfigResult | null = null;
  try {
    configInfo = await withConfig(options, workspaceName);
  } catch {
    configInfo = null;
  }

  return {
    name: workspaceName,
    containerName,
    keyPath,
    stateDir,
    configInfo,
  };
};

export const loadWorkspaceState = async (
  workspaceName: string,
): Promise<StoredWorkspaceState | null> => {
  const STATE_FILE = path.join(os.homedir(), ".workspaces", "state", "state.json");
  try {
    const stateData = await fs.promises.readFile(STATE_FILE, "utf8");
    const state = JSON.parse(stateData) as { workspaces?: Record<string, StoredWorkspaceState> };
    return state.workspaces?.[workspaceName] ?? null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
};
