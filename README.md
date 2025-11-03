# Workspace CLI

Containerized development environments with Docker-in-Docker, SSH access, and persistent storage.

## Install

```bash
npm install -g @subroutinecom/workspace
```

## Quick Start

```bash
# Initialize in your project
cd myproject
workspace init

# Edit .workspace.yml, then start
workspace start
workspace shell        # SSH into container
workspace proxy        # Port forwarding (separate terminal)
```

## Configuration

### Project Configuration

`.workspace.yml` in your project:

```yaml
repo:
  remote: git@github.com:user/repo.git
  branch: main

bootstrap:
  scripts:
    - scripts/install-deps.sh

forwards:
  - 3000
  - 5173
  - "8000-8010"

mounts:
  - ./local:/home/workspace/otherLocalData
  - ~/data:/data:ro
```

### User Configuration

`~/.workspaces/config.yml` for user-specific settings across all workspaces:

```yaml
mountAgentsCredentials: true

ssh:
  # Default SSH key (optional - uses heuristic if not specified)
  defaultKey: ~/.ssh/id_ed25519

  # Per-repository key overrides (supports wildcards)
  repos:
    "git@github.com:user/private-repo.git": ~/.ssh/id_github_personal
    "git@github.com:company/*": ~/.ssh/id_github_work

bootstrap:
  scripts:
    - userscripts # Directory: runs all executable files alphabetically
```

User config is automatically created on first run with `userscripts` directory reference. Paths are relative to `~/.workspaces/`. Directories auto-expand to run all executable files. Configuration is merged with project config - user bootstrap scripts run **after** project scripts.

When `mountAgentsCredentials` is enabled (default), Workspace mounts the following credential files into every container when they exist on the host: `~/.codex/auth.json`, `~/.local/share/opencode/auth.json`, and `~/.claude/.credentials.json`. Set it to `false` to opt out.

**SSH Configuration:**

- All SSH keys from `~/.ssh/` are copied to containers
- Specify `defaultKey` to set which key is used by default for git operations
- Per-repository overrides support exact matches and wildcard patterns
- If no `defaultKey` is specified, the CLI uses SSH agent keys or falls back to `id_ed25519`, `id_ecdsa`, or `id_rsa`
- The selected key is automatically configured in git and SSH config inside containers

**Bootstrap scripts** run as `workspace` user with passwordless sudo.

**Mounts** format: `source:target[:mode]`. Relative paths resolve from config directory. Tilde expands to home. By default workspace mounts your host $HOME at `/host/home` (read-only).

**Forwards** creates SSH tunnels when running `workspace proxy <name>`.

## Commands

```bash
# Lifecycle
workspace start [name]             # Start workspace (auto-builds image)
workspace stop [name]              # Stop workspace
workspace destroy [name...] [-f]   # Remove container + volumes
workspace status [name]            # Show state (CPU, memory, ports)

# Development
workspace shell [name] [-c "cmd"]  # SSH into container
workspace proxy [name]             # Port forwarding tunnel
workspace logs [name] [-f]         # Container logs

# Discovery
workspace list                     # Find all .workspace.yml files
workspace config [name]            # Show resolved configuration
workspace doctor                   # Check prerequisites

# Image/BuildKit
workspace build [--no-cache]       # Build base image
workspace buildkit [--status]      # Manage shared BuildKit
```

Commands run from project directory use that workspace. Or specify name from anywhere.

## What's Inside

- **OS**: Ubuntu 24.04 LTS
- **Docker**: CE + Compose + BuildKit
- **Languages**: Node.js 22, Python 3
- **Editor**: Neovim v0.11.4 + LazyVim
- **Tools**: Git, GitHub CLI, ripgrep, fd-find, jq, curl, wget, rsync
- **User**: `workspace` with passwordless sudo

## User Scripts

Add executable scripts to `~/.workspaces/userscripts/` - they run automatically in all workspaces:

```yaml
# ~/.workspaces/config.yml (auto-created on first run)
bootstrap:
  scripts:
    - userscripts # Runs all executable files in directory
```

Example script:

```bash
# ~/.workspaces/userscripts/setup-shell.sh
#!/bin/bash
echo "Setting up shell configuration..."
cp /host/home/.zshrc ~/.zshrc
```

Make scripts executable: `chmod +x ~/.workspaces/userscripts/setup-shell.sh`

**Directory expansion**: Point at a directory to run all executable files alphabetically. Or specify individual scripts for precise control.

User scripts execute after project bootstrap scripts in the order listed.

## Testing

```bash
npm test
```

## Prerequisites

- Docker Desktop or Engine
- SSH client + ssh-keygen
- Node.js 18+

Run `workspace doctor` to verify.
