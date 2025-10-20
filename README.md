# Workspace CLI

This repository contains a simple orchestration CLI for running container based developer environment with basic support for:

- Docker-in-docker
- ssh-agent forwarding
- VSCode support

NOTE: This is a demo project - it has been created as a fork of a tool we use internally for workspace management. It is made to be a simple and mostly dependency-less implementation of development environments.

## Install

```bash
# inside this folder
npm install -g .
```

The global install exposes a `workspace` command. (If you prefer, you can also run `node src/index.js ...` directly.)

## Use it in a repo

```bash
cd /path/to/your/project
workspace start app      # start a workspace instance named "app"
workspace shell app      # SSH into the running workspace
workspace proxy app      # open SSH port forwarding for the configured services
workspace destroy app    # remove the container and its volumes
```

The CLI keeps state under `~/.workspaces/` so every project gets its own SSH key, runtime metadata, and automatically assigned local ports.

## Configuration

See `packages/.workspace.yml` for a working example configuration.

The configuration is simple: specify your Git remote/branch, port forwards, and optional bootstrap scripts. The CLI handles:

- creating a Docker image from the workspace template
- assigning unique SSH ports and local forward ports (tracked in `~/.workspaces/state.json`)
- generating SSH keys and injecting them into the container
- running initialization scripts to clone your repo and execute bootstrap scripts

## Handy commands

- `workspace build <name>` – rebuild the workspace image from the template
- `workspace status <name>` – show container status plus assigned ports
- `workspace proxy <name>` – print the SSH command without executing it
- `workspace stop <name>` / `workspace destroy <name>` – stop the container or remove it entirely
