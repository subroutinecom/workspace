#!/bin/bash

# Workspace initialization script.
# Designed to run inside the workspace container as the workspace user.

set -euo pipefail

log() {
  printf "[workspace:init] %s\n" "$*"
}

status() {
  printf "%s\n" "$*"
}

QUICK=false
if [[ "${1:-}" == "--quick" || "${1:-}" == "-q" ]]; then
  QUICK=true
  shift || true
  log "Running in quick mode."
fi

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

  status "Cloning repository..."

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
}

configure_shell_helpers() {
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

  if ! grep -q ".npm-global/bin" "${WORKSPACE_HOME}/.bashrc" 2>/dev/null; then
    {
      echo ""
      echo "# npm global packages"
      echo "export PATH=\"\$HOME/.npm-global/bin:\$PATH\""
    } >> "${WORKSPACE_HOME}/.bashrc"
  fi

  if [[ -f "${WORKSPACE_HOME}/.zshrc" ]] && ! grep -q ".npm-global/bin" "${WORKSPACE_HOME}/.zshrc" 2>/dev/null; then
    {
      echo ""
      echo "# npm global packages"
      echo "export PATH=\"\$HOME/.npm-global/bin:\$PATH\""
    } >> "${WORKSPACE_HOME}/.zshrc"
  fi
}

install_lazyvim() {
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
  log "Installing latest development tools..."
  status "Installing development tools..."

  # Install Claude Code
  if ! command -v claude &> /dev/null; then
    log "Installing Claude Code..."
    if curl -fsSL https://claude.ai/install.sh | bash; then
      log "✓ Claude Code installed successfully."
    else
      log "WARNING: Failed to install Claude Code."
    fi
  else
    log "Claude Code already installed, updating..."
    if curl -fsSL https://claude.ai/install.sh | bash; then
      log "✓ Claude Code updated successfully."
    else
      log "WARNING: Failed to update Claude Code."
    fi
  fi

  # Install opencode with correct architecture
  if ! command -v opencode &> /dev/null; then
    log "Installing opencode..."
    ARCH=$(dpkg --print-architecture)
    if [ "$ARCH" = "amd64" ]; then OPENCODE_ARCH="x64"; else OPENCODE_ARCH="arm64"; fi
    if curl -fsSL "https://github.com/sst/opencode/releases/latest/download/opencode-linux-${OPENCODE_ARCH}.zip" -o /tmp/opencode.zip \
      && unzip -q /tmp/opencode.zip -d /tmp/opencode \
      && sudo mv /tmp/opencode/opencode /usr/local/bin/opencode \
      && sudo chmod +x /usr/local/bin/opencode \
      && rm -rf /tmp/opencode.zip /tmp/opencode; then
      log "✓ opencode installed successfully."
    else
      log "WARNING: Failed to install opencode."
    fi
  else
    log "opencode already installed, updating..."
    ARCH=$(dpkg --print-architecture)
    if [ "$ARCH" = "amd64" ]; then OPENCODE_ARCH="x64"; else OPENCODE_ARCH="arm64"; fi
    if curl -fsSL "https://github.com/sst/opencode/releases/latest/download/opencode-linux-${OPENCODE_ARCH}.zip" -o /tmp/opencode.zip \
      && unzip -q /tmp/opencode.zip -d /tmp/opencode \
      && sudo mv /tmp/opencode/opencode /usr/local/bin/opencode \
      && sudo chmod +x /usr/local/bin/opencode \
      && rm -rf /tmp/opencode.zip /tmp/opencode; then
      log "✓ opencode updated successfully."
    else
      log "WARNING: Failed to update opencode."
    fi
  fi

  # Install codex
  if ! command -v codex &> /dev/null; then
    log "Installing codex..."
    if npm install -g @openai/codex 2>/dev/null; then
      log "✓ codex installed successfully."
    else
      log "WARNING: Failed to install codex."
    fi
  else
    log "codex already installed, updating..."
    if npm install -g @openai/codex 2>/dev/null; then
      log "✓ codex updated successfully."
    else
      log "WARNING: Failed to update codex."
    fi
  fi
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
    status "Running bootstrap scripts..."
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
      status "Running user scripts..."
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
install_dev_tools
run_bootstrap_scripts

touch "${WORKSPACE_HOME}/.workspace-initialized"
log "Workspace initialization complete."
