import path from "path";
import os from "os";
import fsExtra from "fs-extra";
import lockfile from "proper-lockfile";
import { getListeningPorts } from "./utils";
import type { ResolvedWorkspaceConfig } from "./config";

export interface WorkspaceState {
  sshPort: number;
  forwards: number[];
  configDir: string;
  selectedKey?: string | null;
}

interface State {
  workspaces: Record<string, WorkspaceState>;
}

const STATE_FILE = path.join(os.homedir(), ".workspaces", "state", "state.json");
const DEFAULT_STATE: State = {
  workspaces: {},
};
const SSH_PORT_START = 2300;

const loadState = async (): Promise<State> => {
  try {
    return await fsExtra.readJson(STATE_FILE);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { workspaces: {} };
    }
    throw err;
  }
};

const saveState = async (state: State): Promise<void> => {
  await fsExtra.ensureDir(path.dirname(STATE_FILE));
  await fsExtra.writeJson(STATE_FILE, state, { spaces: 2 });
};

const withLock = async <T>(fn: () => Promise<T>): Promise<T> => {
  await fsExtra.ensureDir(path.dirname(STATE_FILE));
  if (!(await fsExtra.pathExists(STATE_FILE))) {
    await saveState(DEFAULT_STATE);
  }

  let release: (() => Promise<void>) | undefined;
  try {
    release = await lockfile.lock(STATE_FILE, {
      retries: {
        retries: 10,
        minTimeout: 50,
        maxTimeout: 500,
      },
    });

    return await fn();
  } finally {
    if (release) {
      await release();
    }
  }
};

const findAvailableSshPort = async (state: State): Promise<number> => {
  const allocatedPorts = new Set(
    Object.values(state.workspaces || {}).map((ws) => ws.sshPort),
  );

  const listeningPorts = await getListeningPorts();

  let candidatePort = SSH_PORT_START;

  while (true) {
    if (!allocatedPorts.has(candidatePort) && !listeningPorts.has(candidatePort)) {
      return candidatePort;
    }
    candidatePort += 1;
  }
};

export const ensureWorkspaceState = async (
  resolved: ResolvedWorkspaceConfig,
): Promise<WorkspaceState> => {
  return withLock(async () => {
    const state = await loadState();
    const name = resolved.workspace.name;

    if (!state.workspaces[name]) {
      const sshPort = await findAvailableSshPort(state);
      state.workspaces[name] = {
        sshPort,
        forwards: [],
        configDir: resolved.workspace.configDir,
      };
    }

    const workspaceState = state.workspaces[name];

    workspaceState.forwards = [...resolved.workspace.forwards];
    workspaceState.configDir = resolved.workspace.configDir;

    await saveState(state);

    return {
      sshPort: workspaceState.sshPort,
      forwards: workspaceState.forwards,
      configDir: workspaceState.configDir,
      selectedKey: workspaceState.selectedKey ?? null,
    };
  });
};

export const removeWorkspaceState = async (workspaceName: string): Promise<void> => {
  await withLock(async () => {
    const state = await loadState();
    if (state.workspaces[workspaceName]) {
      delete state.workspaces[workspaceName];
      await saveState(state);
    }
  });

  const stateDir = path.join(os.homedir(), ".workspaces", "state", workspaceName);
  if (await fsExtra.pathExists(stateDir)) {
    await fsExtra.remove(stateDir);
  }
};

export const listWorkspaceNames = async (): Promise<string[]> => {
  const state = await loadState();
  return Object.keys(state.workspaces || {});
};
