#!/bin/bash

# Workspace initialization script.
# Designed to run inside the workspace container as the workspace user.

set -euo pipefail

log() {
  printf "[workspace:init] %s\n" "$*"
}

QUICK=false
if [[ "${1:-}" == "--quick" || "${1:-}" == "-q" ]]; then
  QUICK=true
  shift || true
  log "Running in quick mode."
fi

WORKSPACE_HOME="${WORKSPACE_HOME:-/home/workspace}"
CODE_DIR="${CODE_DIR:-${WORKSPACE_HOME}/code}"
HOST_HOME="${HOST_HOME:-/host/home}"
HOST_SOURCE="${WORKSPACE_HOST_SOURCE:-}"
RUNTIME_CONFIG="${WORKSPACE_RUNTIME_CONFIG:-/workspace/config/runtime.json}"
REPO_URL="${WORKSPACE_REPO_URL:-${GIT_REPO:-}}"
REPO_BRANCH="${WORKSPACE_REPO_BRANCH:-${BRANCH:-main}}"

mkdir -p "${WORKSPACE_HOME}" "${CODE_DIR}" "${WORKSPACE_HOME}/.ssh"

# Prefer forwarded SSH agent if available.
if [[ -S /ssh-agent && ! -S "${SSH_AUTH_SOCK:-}" ]]; then
  export SSH_AUTH_SOCK=/ssh-agent
else
  # No SSH agent - copy host SSH keys if available
  if [[ -d /host/.ssh ]]; then
    log "Copying host SSH keys (no SSH agent detected)."
    # Copy SSH keys but NOT authorized_keys (that was set up by add-ssh-key.sh)
    for file in /host/.ssh/id_* /host/.ssh/known_hosts /host/.ssh/config; do
      if [[ -f "$file" ]]; then
        sudo cp "$file" "${WORKSPACE_HOME}/.ssh/" 2>/dev/null || true
      fi
    done
    sudo chown -R workspace:workspace "${WORKSPACE_HOME}/.ssh"
    sudo chmod 700 "${WORKSPACE_HOME}/.ssh"
    sudo chmod 600 "${WORKSPACE_HOME}/.ssh/id_"* 2>/dev/null || true
    sudo chmod 644 "${WORKSPACE_HOME}/.ssh/"*.pub 2>/dev/null || true
    sudo chmod 644 "${WORKSPACE_HOME}/.ssh/known_hosts" 2>/dev/null || true
    sudo chmod 644 "${WORKSPACE_HOME}/.ssh/config" 2>/dev/null || true
  fi
fi

copy_git_config() {
  if [[ -f "${HOST_HOME}/.gitconfig" ]]; then
    log "Copying host gitconfig."
    cp "${HOST_HOME}/.gitconfig" "${WORKSPACE_HOME}/.gitconfig"
  fi

  git config --global --add safe.directory "${CODE_DIR}" >/dev/null 2>&1 || true
}

ensure_known_host() {
  local remote="$1"
  if [[ -z "${remote}" ]]; then
    return
  fi
  local host
  host="$(echo "${remote}" | sed -n 's/.*@\([^:]*\).*/\1/p')"
  if [[ -z "${host}" ]]; then
    host="$(echo "${remote}" | sed -n 's#ssh://\([^/]*\)/.*#\1#p')"
  fi
  if [[ -n "${host}" ]]; then
    mkdir -p "${WORKSPACE_HOME}/.ssh"
    chown workspace:workspace "${WORKSPACE_HOME}/.ssh"
    chmod 700 "${WORKSPACE_HOME}/.ssh"
    touch "${WORKSPACE_HOME}/.ssh/known_hosts"
    chown workspace:workspace "${WORKSPACE_HOME}/.ssh/known_hosts"
    chmod 644 "${WORKSPACE_HOME}/.ssh/known_hosts"
    if ! ssh-keygen -F "${host}" >/dev/null 2>&1; then
      log "Adding ${host} to known_hosts."
      ssh-keyscan -H "${host}" >> "${WORKSPACE_HOME}/.ssh/known_hosts" 2>/dev/null || true
    fi
  fi
}

clone_repository() {
  if [[ -d "${CODE_DIR}/.git" ]]; then
    log "Repository already present at ${CODE_DIR}."
    return
  fi

  if [[ -z "${REPO_URL}" ]]; then
    log "No repository URL configured. Skipping clone."
    mkdir -p "${CODE_DIR}"
    return
  fi

  rm -rf "${CODE_DIR}"
  mkdir -p "${CODE_DIR}"

  ensure_known_host "${REPO_URL}"
  log "Cloning ${REPO_URL}..."
  if ! git clone "${REPO_URL}" "${CODE_DIR}"; then
    log "Failed to clone repository. Ensure your SSH agent is forwarded or use HTTPS URL."
    return 1
  fi
}

checkout_branch() {
  if [[ ! -d "${CODE_DIR}/.git" ]]; then
    return
  fi
  cd "${CODE_DIR}"
  git fetch --all --quiet || true
  if git show-ref --verify --quiet "refs/heads/${REPO_BRANCH}"; then
    git checkout "${REPO_BRANCH}"
  else
    git checkout -b "${REPO_BRANCH}" || git checkout "${REPO_BRANCH}" || true
  fi
}

configure_shell_helpers() {
  # Configure Git SSH command for agent forwarding
  if ! grep -q "GIT_SSH_COMMAND" "${WORKSPACE_HOME}/.bashrc" 2>/dev/null; then
    {
      echo ""
      echo "# Workspace Git configuration"
      echo "export GIT_SSH_COMMAND=\"ssh -F ~/.ssh/config\""
    } >> "${WORKSPACE_HOME}/.bashrc"
  fi

  if [[ -f "${WORKSPACE_HOME}/.zshrc" ]] && ! grep -q "GIT_SSH_COMMAND" "${WORKSPACE_HOME}/.zshrc" 2>/dev/null; then
    {
      echo ""
      echo "# Workspace Git configuration"
      echo "export GIT_SSH_COMMAND=\"ssh -F ~/.ssh/config\""
    } >> "${WORKSPACE_HOME}/.zshrc"
  fi
}

run_post_init_commands() {
  if [[ ! -f "${RUNTIME_CONFIG}" ]]; then
    return
  fi
  mapfile -t commands < <(
    python3 - "$RUNTIME_CONFIG" <<'PY'
import json, sys, pathlib
cfg_path = pathlib.Path(sys.argv[1])
try:
    data = json.loads(cfg_path.read_text())
except Exception:
    sys.exit(0)
for cmd in data.get("postInitCommands") or []:
    if isinstance(cmd, str) and cmd.strip():
        print(cmd.strip())
PY
  )

  if [[ ${#commands[@]} -eq 0 ]]; then
    return
  fi

  log "Running post-init commands..."
  for cmd in "${commands[@]}"; do
    log "→ ${cmd}"
    (cd "${CODE_DIR}" && bash -lc "${cmd}")
  done
}

run_bootstrap_scripts() {
  if [[ ! -f "${RUNTIME_CONFIG}" ]]; then
    return
  fi

  # Read bootstrap configuration from runtime.json
  local config_dir_relative
  config_dir_relative=$(python3 - "$RUNTIME_CONFIG" <<'PY'
import json, sys, pathlib
cfg_path = pathlib.Path(sys.argv[1])
try:
    data = json.loads(cfg_path.read_text())
    bootstrap = data.get("bootstrap") or {}
    print(bootstrap.get("configDirRelative", ""))
except Exception:
    pass
PY
  )

  mapfile -t scripts < <(
    python3 - "$RUNTIME_CONFIG" <<'PY'
import json, sys, pathlib
cfg_path = pathlib.Path(sys.argv[1])
try:
    data = json.loads(cfg_path.read_text())
    bootstrap = data.get("bootstrap") or {}
    for script in bootstrap.get("scripts") or []:
        if isinstance(script, str) and script.strip():
            print(script.strip())
except Exception:
    sys.exit(0)
PY
  )

  if [[ ${#scripts[@]} -eq 0 ]]; then
    return
  fi

  # Determine the config directory inside the container
  local config_dir="${CODE_DIR}"
  if [[ -n "${config_dir_relative}" ]]; then
    config_dir="${CODE_DIR}/${config_dir_relative}"
  fi

  log "Running bootstrap scripts..."
  for script in "${scripts[@]}"; do
    # Resolve script path relative to config directory
    local script_path="${config_dir}/${script}"

    if [[ ! -f "${script_path}" ]]; then
      log "ERROR: Bootstrap script not found: ${script_path}"
      return 1
    fi

    if [[ ! -x "${script_path}" ]]; then
      log "ERROR: Bootstrap script is not executable: ${script_path}"
      log "Hint: Run 'chmod +x ${script}' in your repository"
      return 1
    fi

    log "→ ${script}"
    if ! (cd "${config_dir}" && "${script_path}"); then
      log "ERROR: Bootstrap script failed: ${script}"
      return 1
    fi
  done
}

copy_git_config

clone_repository
checkout_branch
configure_shell_helpers
run_post_init_commands
run_bootstrap_scripts

touch "${WORKSPACE_HOME}/.workspace-initialized"

log "Workspace initialization complete."
log "Code directory : ${CODE_DIR}"
if [[ -d "${CODE_DIR}/.git" ]]; then
  cd "${CODE_DIR}"
  log "Active branch : $(git branch --show-current 2>/dev/null || echo "${REPO_BRANCH}")"
fi
