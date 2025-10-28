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
HOST_HOME="${HOST_HOME:-/host/home}"
HOST_SOURCE="${WORKSPACE_HOST_SOURCE:-}"
RUNTIME_CONFIG="${WORKSPACE_RUNTIME_CONFIG:-/workspace/config/runtime.json}"
REPO_URL="${WORKSPACE_REPO_URL:-${GIT_REPO:-}}"
REPO_BRANCH="${WORKSPACE_REPO_BRANCH:-${BRANCH:-main}}"

# SSH setup is handled by add-ssh-key.sh (runs as root in entrypoint)
# Just need to export SSH_AUTH_SOCK if agent is available
if [[ -S /ssh-agent ]]; then
  export SSH_AUTH_SOCK=/ssh-agent
fi

copy_git_config() {
  if [[ -f "${HOST_HOME}/.gitconfig" ]]; then
    log "Copying host gitconfig."
    cp "${HOST_HOME}/.gitconfig" "${WORKSPACE_HOME}/.gitconfig"
  fi
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
  if [[ -z "${REPO_URL}" ]]; then
    log "No repository URL configured. Skipping clone."
    return
  fi

  ensure_known_host "${REPO_URL}"
  log "Cloning ${REPO_URL}..."

  cd "${WORKSPACE_HOME}"
  if ! git clone "${REPO_URL}" --branch "${REPO_BRANCH}" 2>/dev/null && ! git clone "${REPO_URL}"; then
    log "Failed to clone repository. Ensure your SSH agent is forwarded or use HTTPS URL."
    return 1
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

install_lazyvim() {
  local nvim_config_dir="${WORKSPACE_HOME}/.config/nvim"

  # Check if user already has a Neovim configuration
  if [[ -f "${nvim_config_dir}/init.lua" ]] || [[ -f "${nvim_config_dir}/init.vim" ]]; then
    log "Existing Neovim configuration detected, skipping LazyVim installation."
    # Ensure proper ownership even for pre-existing configs (e.g., from volume mounts)
    chown -R workspace:workspace "${WORKSPACE_HOME}/.config" 2>/dev/null || true
    return
  fi

  # If config directory exists but has no init file, proceed with LazyVim install
  if [[ -d "${nvim_config_dir}" ]]; then
    log "Neovim config directory exists without init file. Installing LazyVim..."
  else
    log "No Neovim configuration found. Installing LazyVim..."
  fi

  # Clone LazyVim starter
  if git clone https://github.com/LazyVim/starter "${nvim_config_dir}" 2>/dev/null; then
    # Remove .git folder to make it user's own config
    rm -rf "${nvim_config_dir}/.git"

    # Ensure proper ownership
    chown -R workspace:workspace "${WORKSPACE_HOME}/.config"

    log "LazyVim installed. Plugins will install on first 'nvim' launch."
  else
    log "Warning: Failed to install LazyVim. You can install it manually later."
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
    bash -lc "${cmd}"
  done
}

run_bootstrap_scripts() {
  if [[ ! -f "${RUNTIME_CONFIG}" ]]; then
    return
  fi

  # Bootstrap scripts come from /workspace/source (mounted from host workspace directory)
  local script_dir="${WORKSPACE_SOURCE_DIR:-/workspace/source}"

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

  if [[ ${#scripts[@]} -gt 0 ]]; then
    log "Running project bootstrap scripts..."
    for script in "${scripts[@]}"; do
      local script_path="${script_dir}/${script}"

      if [[ ! -f "${script_path}" ]]; then
        log "ERROR: Bootstrap script not found: ${script_path}"
        log "Scripts should be in the directory with .workspace.yml"
        return 1
      fi

      if [[ ! -x "${script_path}" ]]; then
        log "ERROR: Bootstrap script is not executable: ${script_path}"
        log "Hint: Run 'chmod +x ${script}' on your host machine"
        return 1
      fi

      log "→ ${script}"
      if ! (cd "${WORKSPACE_HOME}" && "${script_path}"); then
        log "ERROR: Bootstrap script failed: ${script}"
        return 1
      fi
    done
  fi

  # Run user scripts from ~/.workspaces/userscripts/ (if directory exists and is mounted)
  if [[ -d "/workspace/userscripts" ]]; then
    # Find all executable files, sorted alphabetically
    mapfile -t userscripts < <(find /workspace/userscripts -maxdepth 1 -type f -executable | sort)

    if [[ ${#userscripts[@]} -gt 0 ]]; then
      log "Running user bootstrap scripts..."
      for script_path in "${userscripts[@]}"; do
        local script_name=$(basename "${script_path}")
        log "→ ${script_name}"
        if ! (cd "${WORKSPACE_HOME}" && "${script_path}"); then
          log "ERROR: User script failed: ${script_name}"
          return 1
        fi
      done
    fi
  fi
}

copy_git_config
clone_repository
configure_shell_helpers
install_lazyvim
run_post_init_commands
run_bootstrap_scripts

touch "${WORKSPACE_HOME}/.workspace-initialized"
log "Workspace initialization complete."
