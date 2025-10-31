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

`.workspace.yml`:

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

**Bootstrap scripts** run as `workspace` user with passwordless sudo. Project scripts run first, then global user scripts from `~/.workspaces/userscripts/`.

**Mounts** format: `source:target[:mode]`. Relative paths resolve from config directory. Tilde expands to home. Note that by default workspace will volume mount your host $HOME in read-only mode at `/host/home`

**Forwards** is used when you run `workspace proxy <name>`. It creates SSH tunnel for all ports.

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

## State Structure

```
~/.workspaces/
├── userscripts/           # Global bootstrap scripts (all workspaces)
└── state/
    ├── state.json         # SSH port allocation
    └── <name>/
        ├── ssh/           # ED25519 key pair
        └── runtime.json   # Resolved config + SSH port
```

Each workspace gets:

- Unique SSH port (auto-assigned starting at 4200)
- ED25519 SSH key pair
- 3 persistent volumes: `{name}-home`, `{name}-docker`, `{name}-cache`

## Key Features

**Docker-in-Docker**: Full Docker available inside container. Shared BuildKit daemon across workspaces for efficient layer caching.

**SSH Access**: Real SSH with agent forwarding, not `docker exec`. Works with VS Code Remote, SSH tunneling, etc.

**Persistence**: Named volumes survive container restart. Home directory, Docker storage, and caches all persistent.

**Bootstrap Automation**: Run setup scripts on initialization. Project-specific scripts + global user scripts.

**Port Forwarding**: SSH tunnels for accessing services. Declarative in config, automatic setup.

**Mount Points**:

- `/workspace/source` - Project directory (read-only)
- `/host/home` - Your home directory (read-only)
- `/workspace/userscripts` - Global scripts
- Custom mounts from config

## User Scripts

Add personal scripts to `~/.workspaces/userscripts/` - they run in all workspaces after project scripts.

```bash
# ~/.workspaces/userscripts/01-shell.sh
#!/bin/bash
cp /host/home/.zshrc ~/.zshrc
cp -r /host/home/.config/nvim ~/.config/
```

Scripts run alphabetically. See [examples/userscripts/](examples/userscripts/).

## Testing

```bash
npm test
```

## Prerequisites

- Docker Desktop or Engine
- SSH client + ssh-keygen
- Node.js 18+

Run `workspace doctor` to verify.
