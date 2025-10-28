const path = require("path");
const os = require("os");
const fsExtra = require("fs-extra");

const STATE_FILE = path.join(os.homedir(), ".workspaces", "state", "state.json");
const DEFAULT_STATE = {
  nextSshPort: 4200,
  workspaces: {},
};

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

const ensureWorkspaceState = async (resolved) => {
  const state = await loadState();
  const name = resolved.workspace.name;

  if (!state.workspaces[name]) {
    state.workspaces[name] = {
      sshPort: state.nextSshPort,
      forwards: [],
    };
    state.nextSshPort += 1;
  }

  const workspaceState = state.workspaces[name];

  // Update forwards to match config (simple port numbers)
  workspaceState.forwards = [...resolved.workspace.forwards];

  await saveState(state);

  return {
    sshPort: workspaceState.sshPort,
    forwards: workspaceState.forwards,
  };
};

const removeWorkspaceState = async (workspaceName) => {
  const state = await loadState();
  if (state.workspaces[workspaceName]) {
    delete state.workspaces[workspaceName];
    await saveState(state);
  }

  // Remove the workspace state directory
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
