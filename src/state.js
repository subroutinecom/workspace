const path = require("path");
const os = require("os");
const fsExtra = require("fs-extra");
const lockfile = require("proper-lockfile");
const { getListeningPorts } = require("./utils");

const STATE_FILE = path.join(os.homedir(), ".workspaces", "state", "state.json");
const DEFAULT_STATE = {
  workspaces: {},
};
const SSH_PORT_START = 2300;

const loadState = async () => {
  try {
    return await fsExtra.readJson(STATE_FILE);
  } catch (err) {
    if (err.code === "ENOENT") {
      return { ...DEFAULT_STATE };
    }
    throw err;
  }
};

const saveState = async (state) => {
  await fsExtra.ensureDir(path.dirname(STATE_FILE));
  await fsExtra.writeJson(STATE_FILE, state, { spaces: 2 });
};

const withLock = async (fn) => {
  await fsExtra.ensureDir(path.dirname(STATE_FILE));
  if (!(await fsExtra.pathExists(STATE_FILE))) {
    await saveState(DEFAULT_STATE);
  }

  let release;
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

const findAvailableSshPort = async (state) => {
  const allocatedPorts = new Set(
    Object.values(state.workspaces || {}).map(ws => ws.sshPort)
  );

  const listeningPorts = await getListeningPorts();

  let candidatePort = SSH_PORT_START;

  while (true) {
    if (!allocatedPorts.has(candidatePort) && !listeningPorts.has(candidatePort)) {
      return candidatePort;
    }
    candidatePort++;
  }
};

const ensureWorkspaceState = async (resolved) => {
  return await withLock(async () => {
    const state = await loadState();
    const name = resolved.workspace.name;

    if (!state.workspaces[name]) {
      const sshPort = await findAvailableSshPort(state);
      state.workspaces[name] = {
        sshPort,
        forwards: [],
      };
    }

    const workspaceState = state.workspaces[name];

    workspaceState.forwards = [...resolved.workspace.forwards];

    await saveState(state);

    return {
      sshPort: workspaceState.sshPort,
      forwards: workspaceState.forwards,
    };
  });
};

const removeWorkspaceState = async (workspaceName) => {
  await withLock(async () => {
    const state = await loadState();
    if (state.workspaces[workspaceName]) {
      delete state.workspaces[workspaceName];
      await saveState(state);
    }
  });

  // Remove the workspace state directory (outside lock since it's a separate operation)
  const stateDir = path.join(os.homedir(), ".workspaces", "state", workspaceName);
  if (await fsExtra.pathExists(stateDir)) {
    await fsExtra.remove(stateDir);
  }
};

const listWorkspaceNames = async () => {
  const state = await loadState();
  return Object.keys(state.workspaces || {});
};

module.exports = {
  ensureWorkspaceState,
  removeWorkspaceState,
  listWorkspaceNames,
};
