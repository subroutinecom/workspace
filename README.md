# Workspace CLI

Self-contained CLI for Docker-in-Docker development environments with SSH access, Neovim, and LazyVim.

## Features

- **Docker-in-Docker** - Full Docker CE with compose, buildx
- **SSH Access** - Auto-generated keys, agent forwarding
- **Port Forwarding** - SSH tunnels for development servers
- **Neovim + LazyVim** - v0.11.4 with LazyVim pre-configured
- **Development Tools** - Node.js, Python, Git, GitHub CLI (gh), opencode, ripgrep, fd-find
- **Persistent Volumes** - Home directory, Docker data, cache
- **Bootstrap Scripts** - Run custom setup scripts on initialization
- **Minimal Dependencies** - Three npm packages (commander, fs-extra, yaml)

## Install

```bash
npm install -g .
```

The global install exposes a `workspace` command.

## Quick Start

```bash
# Create workspace config
workspace init myproject

# Edit packages/myproject/.workspace.yml with your settings

# Start workspace
workspace start myproject

# Shell into workspace
workspace shell myproject

# Forward ports (if configured)
workspace proxy myproject
```

## Configuration

Create `.workspace.yml` in your workspace directory:

```yaml
repo:
  remote: git@github.com:user/repo.git  # Optional
  branch: main

bootstrap:
  scripts:
    - scripts/install-deps.sh           # Optional

forwards:
  - 3000                                # Single port
  - 5173
  - "8000-8010"                         # Port range
```

Bootstrap scripts run from the directory containing `.workspace.yml` and execute as the `workspace` user with passwordless sudo.

## User Scripts

Add personal bootstrap scripts to `~/.workspaces/userscripts/` - they automatically run after project scripts in all workspaces.

```bash
mkdir -p ~/.workspaces/userscripts
cat > ~/.workspaces/userscripts/setup-shell.sh << 'EOF'
#!/bin/bash
# Install oh-my-zsh, copy dotfiles, etc.
cp /host/home/.zshrc ~/.zshrc
EOF
chmod +x ~/.workspaces/userscripts/setup-shell.sh
```

Scripts run alphabetically. Use prefixes to control order: `01-shell.sh`, `02-tools.sh`. Never committed to git.

## Commands

```bash
workspace init <name>           # Create new workspace config
workspace start <name>          # Build and start workspace
workspace shell <name>          # Open shell in workspace
workspace exec <name> <cmd>     # Execute command in workspace
workspace proxy <name>          # Start SSH port forwarding
workspace stop <name>           # Stop workspace
workspace destroy <name>        # Remove workspace and volumes
workspace list                  # List all workspaces
workspace status <name>         # Show workspace status
workspace logs <name>           # View workspace logs
workspace build <name>          # Rebuild workspace image
workspace config <name>         # Show resolved workspace config
workspace doctor                # Check prerequisites
workspace help [command]        # Show help
```

## What's Inside

**Base:** Ubuntu 24.04 LTS (Noble)

**Development:**
- Docker CE 28.x with Docker Compose
- Neovim v0.11.4 + LazyVim
- Node.js + npm + yarn
- Python 3 + pip
- Git

**Tools:**
- ripgrep, fd-find (for LazyVim/Telescope)
- GitHub CLI (gh)
- opencode (AI coding agent)
- curl, wget, jq, rsync
- vim, nano, unzip, zip

**User:**
- Username: `workspace`
- Passwordless sudo
- Docker group membership

## State Management

Workspace state lives in `~/.workspaces/`:
- `~/.workspaces/userscripts/` - User bootstrap scripts (optional, runs in all workspaces)
- `~/.workspaces/state/` - Workspace state data
  - `state.json` - Port assignments
  - `<name>/ssh/` - SSH keys per workspace
  - `<name>/runtime.json` - Runtime config per workspace

SSH ports auto-increment from 4200. Each workspace gets:
- Unique SSH port
- SSH key pair (ED25519)
- Persistent Docker volumes

## Testing

```bash
npm test              # Run all tests
npm run test:e2e      # Run E2E tests only
npm run test:watch    # Watch mode
```

Tests use Node.js built-in test runner (zero test dependencies).

## Prerequisites

- Docker
- SSH client
- ssh-keygen
- Node.js 18+

Run `workspace doctor` to check.

## Notes

- Workspaces run as **privileged containers** (required for Docker-in-Docker)
- LazyVim plugins auto-install on first `nvim` launch
- SSH agent forwarding works if `SSH_AUTH_SOCK` is available
- Git config copied from host `~/.gitconfig` on initialization
- Repository cloning is optional - workspaces work without it

## Architecture

```
workspace/                    # Container template
├── Dockerfile               # Ubuntu Noble + Docker + Neovim
└── scripts/
    ├── entrypoint.sh        # Start Docker daemon + SSH
    ├── init-workspace.sh    # Clone repo, install LazyVim, run bootstrap
    └── ...

src/                         # CLI implementation
├── index.js                 # Command definitions
├── config.js                # Config loading & resolution
├── docker.js                # Docker operations
├── state.js                 # State management
└── utils.js                 # Shell helpers

test/                        # E2E test suite
├── e2e/
│   ├── bootstrap.test.js    # Bootstrap script tests
│   └── environment.test.js  # Binary validation tests
└── helpers/
    └── workspace-utils.js   # Test utilities

packages/                    # Example workspaces
└── <name>/
    ├── .workspace.yml       # Workspace config
    └── scripts/             # Bootstrap scripts
```

## License

Forked from internal workspace management tool. Demo/educational purposes.
