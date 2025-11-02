#!/bin/bash

# Workspace initialization script.
# Designed to run inside the workspace container as the workspace user.

set -euo pipefail

log() {
  printf "%s\n" "$*"
}

WORKSPACE_HOME="${WORKSPACE_HOME:-/home/workspace}"
HOST_HOME="${HOST_HOME:-/host/home}"
RUNTIME_CONFIG="${WORKSPACE_RUNTIME_CONFIG:-/workspace/config/runtime.json}"
REPO_URL="${WORKSPACE_REPO_URL:-${GIT_REPO:-}}"
REPO_BRANCH="${WORKSPACE_REPO_BRANCH:-${BRANCH:-main}}"

# SSH setup is handled by add-ssh-key.sh (runs as root in entrypoint)
# Just need to export SSH_AUTH_SOCK if agent is available
if [[ -S /ssh-agent ]]; then
  export SSH_AUTH_SOCK=/ssh-agent
fi

copy_git_config() {
  if sudo test -f "${HOST_HOME}/.gitconfig" 2>/dev/null; then
    log "Copying host gitconfig."
    sudo cp "${HOST_HOME}/.gitconfig" "${WORKSPACE_HOME}/.gitconfig"
    sudo chown workspace:workspace "${WORKSPACE_HOME}/.gitconfig"
  fi
}

get_selected_ssh_key() {
  if [[ -f "${RUNTIME_CONFIG}" ]]; then
    python3 - "$RUNTIME_CONFIG" <<'PY'
import json, sys, pathlib
try:
    cfg_path = pathlib.Path(sys.argv[1])
    data = json.loads(cfg_path.read_text())
    selected = data.get("ssh", {}).get("selectedKey")
    if selected:
        print(selected)
except Exception:
    pass
PY
  fi
}

configure_git_ssh_key() {
  local repo_dir="$1"
  local selected_key
  selected_key=$(get_selected_ssh_key)

  if [[ -n "${selected_key}" && -f "${WORKSPACE_HOME}/.ssh/${selected_key}" ]]; then
    if [[ -d "${repo_dir}/.git" ]]; then
      log "Configuring git to use SSH key: ${selected_key}"
      cd "${repo_dir}"
      git config --local core.sshCommand "ssh -i ~/.ssh/${selected_key} -F ~/.ssh/config"
      cd "${WORKSPACE_HOME}"
    fi
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
      ssh-keyscan -H "${host}" >>"${WORKSPACE_HOME}/.ssh/known_hosts" 2>/dev/null || true
    fi
  fi
}

clone_repository() {
  if [[ -z "${REPO_URL}" ]]; then
    log "No repository URL configured. Skipping clone."
    return
  fi

  if [[ -f "${WORKSPACE_HOME}/.workspace-initialized" ]]; then
    log "Workspace already initialized. Skipping repository clone."
    return
  fi

  # Read clone args from runtime config if available
  local clone_args=()
  if [[ -f "${RUNTIME_CONFIG}" ]]; then
    mapfile -t clone_args < <(
      python3 - "$RUNTIME_CONFIG" <<'PY'
import json, sys, pathlib
cfg_path = pathlib.Path(sys.argv[1])
try:
    data = json.loads(cfg_path.read_text())
    repo_config = data.get("workspace", {}).get("repo", {})
    clone_args = repo_config.get("cloneArgs", [])
    if isinstance(clone_args, list):
        for arg in clone_args:
            if isinstance(arg, str) and arg.strip():
                print(arg.strip())
except Exception:
    pass
PY
    )
  fi

  local selected_key
  selected_key=$(get_selected_ssh_key)

  if [[ -n "${selected_key}" ]]; then
    if [[ -f "${WORKSPACE_HOME}/.ssh/${selected_key}" ]]; then
      log "Selected SSH key from config: ${selected_key}"
      export GIT_SSH_COMMAND="ssh -i ~/.ssh/${selected_key} -F ~/.ssh/config"
      log "GIT_SSH_COMMAND set to: ${GIT_SSH_COMMAND}"
    else
      log "WARNING: Selected SSH key not found: ${WORKSPACE_HOME}/.ssh/${selected_key}"
    fi
  else
    log "No SSH key selected in runtime config, will use SSH agent or default keys"
    if [[ -n "${SSH_AUTH_SOCK:-}" && -S "${SSH_AUTH_SOCK}" ]]; then
      log "SSH agent available at: ${SSH_AUTH_SOCK}"
    else
      log "WARNING: No SSH agent available"
    fi
  fi

  ensure_known_host "${REPO_URL}"

  local clone_cmd=(git clone)
  if [[ ${#clone_args[@]} -gt 0 ]]; then
    log "Cloning ${REPO_URL} with args: ${clone_args[*]}..."
    clone_cmd+=("${clone_args[@]}")
  else
    log "Cloning ${REPO_URL}..."
  fi
  clone_cmd+=("${REPO_URL}")

  cd "${WORKSPACE_HOME}"
  # First try with branch flag if clone args don't already specify a branch
  local has_branch_arg=false
  for arg in "${clone_args[@]}"; do
    if [[ "$arg" == "--branch" || "$arg" == "-b" || "$arg" == --branch=* ]]; then
      has_branch_arg=true
      break
    fi
  done

  if [[ "$has_branch_arg" == false ]]; then
    if ! "${clone_cmd[@]}" --branch "${REPO_BRANCH}" 2>/dev/null && ! "${clone_cmd[@]}" 2>/dev/null; then
      log "Failed to clone repository. Ensure your SSH agent is forwarded or use HTTPS URL."
      return 1
    fi
  else
    if ! "${clone_cmd[@]}" 2>/dev/null; then
      log "Failed to clone repository. Ensure your SSH agent is forwarded or use HTTPS URL."
      return 1
    fi
  fi

  local repo_name
  repo_name=$(basename "${REPO_URL}" .git)
  local repo_path="${WORKSPACE_HOME}/${repo_name}"

  if [[ -d "${repo_path}" ]]; then
    configure_git_ssh_key "${repo_path}"
  fi
}

configure_shell_helpers() {
  if ! grep -q "GIT_SSH_COMMAND" "${WORKSPACE_HOME}/.bashrc" 2>/dev/null; then
    {
      echo ""
      echo "# Workspace Git configuration"
      echo "export GIT_SSH_COMMAND=\"ssh -F ~/.ssh/config\""
    } >>"${WORKSPACE_HOME}/.bashrc"
  fi

  if [[ -f "${WORKSPACE_HOME}/.zshrc" ]] && ! grep -q "GIT_SSH_COMMAND" "${WORKSPACE_HOME}/.zshrc" 2>/dev/null; then
    {
      echo ""
      echo "# Workspace Git configuration"
      echo "export GIT_SSH_COMMAND=\"ssh -F ~/.ssh/config\""
    } >>"${WORKSPACE_HOME}/.zshrc"
  fi

  if ! grep -q ".npm-global/bin" "${WORKSPACE_HOME}/.bashrc" 2>/dev/null; then
    {
      echo ""
      echo "# npm global packages"
      echo "export PATH=\"\$HOME/.npm-global/bin:\$PATH\""
    } >>"${WORKSPACE_HOME}/.bashrc"
  fi

  if [[ -f "${WORKSPACE_HOME}/.zshrc" ]] && ! grep -q ".npm-global/bin" "${WORKSPACE_HOME}/.zshrc" 2>/dev/null; then
    {
      echo ""
      echo "# npm global packages"
      echo "export PATH=\"\$HOME/.npm-global/bin:\$PATH\""
    } >>"${WORKSPACE_HOME}/.zshrc"
  fi
}

install_lazyvim() {
  if [[ -f "${WORKSPACE_HOME}/.workspace-initialized" ]]; then
    return
  fi

  local nvim_config_dir="${WORKSPACE_HOME}/.config/nvim"
  local host_nvim_config="${HOST_HOME}/.config/nvim"

  # Check if user already has a Neovim configuration in the workspace
  if [[ -f "${nvim_config_dir}/init.lua" ]] || [[ -f "${nvim_config_dir}/init.vim" ]]; then
    log "Existing Neovim configuration detected, skipping setup."
    # Ensure proper ownership even for pre-existing configs (e.g., from volume mounts)
    chown -R workspace:workspace "${WORKSPACE_HOME}/.config" 2>/dev/null || true
    return
  fi

  # Try to copy host's neovim config if it exists (use sudo since /host/home has restricted permissions)
  if sudo test -d "${host_nvim_config}" 2>/dev/null; then
    log "Found host Neovim configuration, copying to workspace..."
    mkdir -p "$(dirname "${nvim_config_dir}")"

    if sudo cp -r "${host_nvim_config}" "${nvim_config_dir}" 2>/dev/null; then
      sudo chown -R workspace:workspace "${nvim_config_dir}"
      log "Host Neovim configuration copied successfully."
      return
    else
      log "Warning: Failed to copy host Neovim config. Will install LazyVim instead."
      sudo rm -rf "${nvim_config_dir}" 2>/dev/null || true
    fi
  fi

  # If config directory exists but has no init file, proceed with LazyVim install
  if [[ -d "${nvim_config_dir}" ]]; then
    log "Neovim config directory exists without init file. Installing LazyVim..."
  else
    log "Installing LazyVim as fallback..."
  fi

  local git_error
  if git_error=$(git clone https://github.com/LazyVim/starter "${nvim_config_dir}" 2>&1); then
    # Remove .git folder to make it user's own config
    rm -rf "${nvim_config_dir}/.git"

    chown -R workspace:workspace "${WORKSPACE_HOME}/.config"

    log "✓ LazyVim installed successfully."
    log "  Plugins will install on first 'nvim' launch."
  else
    log "ERROR: Failed to install LazyVim!"
    log "  Git error: ${git_error}"
    log "  You will need to install a Neovim configuration manually."
  fi
}

install_dev_tools() {
  if [[ -f "${WORKSPACE_HOME}/.workspace-initialized" ]]; then
    return
  fi

  log "Installing codex..."
  if ! command -v codex &>/dev/null; then
    if npm install -g @openai/codex 2>/dev/null; then
      log "✓ codex installed successfully."
    else
      log "WARNING: Failed to install codex."
    fi
  else
    if npm update -g @openai/codex 2>/dev/null; then
      log "✓ codex updated successfully."
    else
      log "WARNING: Failed to update codex."
    fi
  fi
}

run_bootstrap_scripts() {
  if [[ -f "${WORKSPACE_HOME}/.workspace-initialized" ]]; then
    return
  fi

  if [[ ! -f "${RUNTIME_CONFIG}" ]]; then
    return
  fi

  mapfile -t script_entries < <(
    python3 - "$RUNTIME_CONFIG" <<'PY'
import json, sys, pathlib
cfg_path = pathlib.Path(sys.argv[1])
try:
    data = json.loads(cfg_path.read_text())
    bootstrap = data.get("bootstrap") or {}
    for script in bootstrap.get("scripts") or []:
        if isinstance(script, dict):
            path = script.get("path", "")
            source = script.get("source", "project")
            if path.strip():
                print(f"{source}:{path.strip()}")
        elif isinstance(script, str) and script.strip():
            print(f"project:{script.strip()}")
except Exception:
    sys.exit(0)
PY
  )

  if [[ ${#script_entries[@]} -gt 0 ]]; then
    log "Running bootstrap scripts..."
    for entry in "${script_entries[@]}"; do
      local source="${entry%%:*}"
      local script="${entry#*:}"

      if [[ "${source}" == "user" ]]; then
        local script_path="/workspace/userconfig/${script}"
      else
        local script_path="/workspace/source/${script}"
      fi

      if [[ -d "${script_path}" ]]; then
        mapfile -t dir_scripts < <(find "${script_path}" -maxdepth 1 -type f -executable | sort)
        if [[ ${#dir_scripts[@]} -gt 0 ]]; then
          for dir_script in "${dir_scripts[@]}"; do
            local script_name=$(basename "${dir_script}")
            log "→ ${script}/${script_name}"
            if ! (cd "${WORKSPACE_HOME}" && "${dir_script}"); then
              log "ERROR: Bootstrap script failed: ${script}/${script_name}"
              return 1
            fi
          done
        fi
      elif [[ -f "${script_path}" ]]; then
        if [[ ! -x "${script_path}" ]]; then
          log "ERROR: Bootstrap script is not executable: ${script_path}"
          if [[ "${source}" == "user" ]]; then
            log "Hint: Run 'chmod +x ~/.workspaces/${script}' on your host machine"
          else
            log "Hint: Run 'chmod +x ${script}' on your host machine"
          fi
          return 1
        fi

        log "→ ${script}"
        if ! (cd "${WORKSPACE_HOME}" && "${script_path}"); then
          log "ERROR: Bootstrap script failed: ${script}"
          return 1
        fi
      else
        log "ERROR: Bootstrap script not found: ${script_path}"
        if [[ "${source}" == "user" ]]; then
          log "Scripts should be in ~/.workspaces/ or subdirectories"
        else
          log "Scripts should be in the directory with .workspace.yml"
        fi
        return 1
      fi
    done
  fi
}

copy_git_config
clone_repository
configure_shell_helpers
install_lazyvim
install_dev_tools
run_bootstrap_scripts

touch "${WORKSPACE_HOME}/.workspace-initialized"
log "Workspace initialization complete."
