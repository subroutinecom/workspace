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
bootstrap:
  scripts:
    - userscripts  # Directory: runs all executable files alphabetically
    # Or specify individual scripts:
    # - userscripts/setup.sh
    # - custom/my-script.sh
```

User config is automatically created on first run with `userscripts` directory reference. Paths are relative to `~/.workspaces/`. Directories auto-expand to run all executable files. Configuration is merged with project config - user bootstrap scripts run **after** project scripts.

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

## Key Features

**Docker-in-Docker**: Full Docker available inside container. Shared BuildKit daemon across workspaces for efficient layer caching.

**SSH Access**: Real SSH with agent forwarding, not `docker exec`. Works with VS Code Remote, SSH tunneling, etc.

**Persistence**: Named volumes survive container restart. Home directory, Docker storage, and caches all persistent.

**Bootstrap Automation**: Run setup scripts on initialization. Project-specific scripts + global user scripts.

**Port Forwarding**: SSH tunnels for accessing services. Declarative in config, automatic setup.

**Mount Points**:

- `/workspace/source` - Project directory (read-only)
- `/host/home` - Your home directory (read-only)
- `/workspace/userconfig` - User config directory (`~/.workspaces/`)
- Custom mounts from config

## User Scripts

Add executable scripts to `~/.workspaces/userscripts/` - they run automatically in all workspaces:

```yaml
# ~/.workspaces/config.yml (auto-created on first run)
bootstrap:
  scripts:
    - userscripts  # Runs all executable files in directory
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
