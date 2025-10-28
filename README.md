# Workspace CLI

Self-contained CLI for Docker-in-Docker development environments.

## Features

- **Docker-in-Docker** - Full Docker CE with compose, buildx
- **SSH Access** - Auto-generated keys, agent forwarding, port tunnels
- **Neovim + LazyVim** - v0.11.4 pre-configured
- **Development Tools** - Node.js, Python, Git, GitHub CLI, ripgrep, fd-find
- **Persistent Volumes** - Home, Docker data, cache
- **Bootstrap Scripts** - Custom setup on initialization
- **Minimal Dependencies** - commander, fs-extra, yaml

## Install

```bash
npm install -g .
```

## Quick Start

```bash
workspace init myproject
# Edit packages/myproject/.workspace.yml
workspace start myproject
workspace shell myproject
workspace proxy myproject  # Port forwarding
```

## Configuration

`.workspace.yml` in your workspace directory:

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
  - "8000-8010"  # Port range
```

Bootstrap scripts execute as `workspace` user with passwordless sudo.

## User Scripts

Add personal bootstrap scripts to `~/.workspaces/userscripts/` - they run in all workspaces.

```bash
mkdir -p ~/.workspaces/userscripts
cat > ~/.workspaces/userscripts/01-shell.sh << 'EOF'
#!/bin/bash
cp /host/home/.zshrc ~/.zshrc
EOF
chmod +x ~/.workspaces/userscripts/01-shell.sh
```

Scripts run alphabetically. Use prefixes for ordering.

**See [examples/userscripts/](examples/userscripts/) for ready-to-use examples**

## Commands

```bash
workspace init <name>              # Create workspace config
workspace start <name>             # Start workspace (builds if needed)
workspace shell <name>             # Interactive shell
workspace shell <name> -c "cmd"    # Execute command
workspace proxy <name>             # SSH port forwarding
workspace stop <name>              # Stop workspace
workspace destroy <name>           # Remove workspace and volumes
workspace list                     # List workspaces
workspace status <name>            # Show status
workspace logs <name>              # View logs
workspace build                    # Build shared workspace image
workspace config <name>            # Show resolved config
workspace doctor                   # Check prerequisites
```

## What's Inside

**Base:** Ubuntu 24.04 LTS

**Development:** Docker CE, Neovim v0.11.4 + LazyVim, Node.js, Python, Git

**Tools:** ripgrep, fd-find, GitHub CLI (gh), curl, wget, jq, rsync

**User:** `workspace` with passwordless sudo and Docker access

## State Management

State lives in `~/.workspaces/`:
- `userscripts/` - User bootstrap scripts (run in all workspaces)
- `state/state.json` - Port assignments
- `state/<name>/ssh/` - SSH keys per workspace
- `state/<name>/runtime.json` - Runtime config

SSH ports auto-increment from 4200. Each workspace gets unique SSH port, ED25519 key pair, and persistent volumes.

## Testing

```bash
npm test         # All tests (Node.js built-in runner)
npm run test:e2e # E2E only
```

## Prerequisites

Docker, SSH client, ssh-keygen, Node.js 18+. Run `workspace doctor` to check.

## Notes

- Runs as **privileged containers** (required for Docker-in-Docker)
- LazyVim plugins auto-install on first nvim launch
- SSH agent forwarding works if `SSH_AUTH_SOCK` available
- Git config copied from host `~/.gitconfig`
- Repository cloning optional

## Architecture

```
workspace/                 # Container template
├── Dockerfile            # Ubuntu 24.04 + Docker + Neovim
└── scripts/              # Initialization scripts

src/                      # CLI
├── index.js              # Commands
├── config.js             # Config loading
├── docker.js             # Docker ops
├── state.js              # State management
└── utils.js              # Utilities

test/                     # E2E tests
packages/                 # Workspaces
└── <name>/
    ├── .workspace.yml
    └── scripts/
```
