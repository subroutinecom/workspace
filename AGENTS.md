# Agent Instructions

## Project Overview

Workspace CLI creates isolated Docker-in-Docker development environments with SSH access, persistent volumes, and port forwarding. It's a pure Node.js CLI with minimal dependencies.

## Key Patterns

**Pure Node.js**: No build system, runs directly. ES modules with `#!/usr/bin/env node` shebang.

**Docker Wrapper**: All Docker operations via spawned CLI commands, not Docker SDK. See `src/docker.js` for pattern.

**State Management**: `~/.workspaces/state/state.json` with file locking via `proper-lockfile`. Port allocation starts at 4200.

**Configuration**: YAML-based (`.workspace.yml`)

**Error Handling**: Swallow "already exists" errors (networks, volumes). Return `false`/`null` for not-found. Throw on actual failures.

**Container Lifecycle**: Reuse containers when possible. Full init on first start, quick mode on restart (checks `~/.workspace-initialized` marker).

## Code Style

- **Minimal dependencies**: Only add if absolutely necessary
- **No abstractions**: Prefer explicit over clever
- **Spawn over SDK**: Use `spawn` for Docker/git commands
- **File locking**: Use `withLock()` from `src/state.js` for state mutations
- **Early returns**: Fail fast with clear error messages
- **Comments**: Avoid adding any comments in code.

## Testing

Run tests after implementing each feature - don't stop until tests are passing.

Run tests with `npm test` (Vitest). Tests use real Docker containers and verify actual behavior.

When adding features:

1. Add E2E test in `test/e2e/` that creates real workspace
2. Test bootstrap script execution, mounts, configuration
3. Clean up containers and volumes after test

## Common Tasks

If you modify Dockerfile, or initialization scripts, you must `workspace build` before testing.

**Changing config schema**:

1. Update schema in `src/config.js` (`resolveConfig()`)
2. Update `buildDefaultConfig()` for `workspace init`
3. Update README.md configuration section
4. Maintain backward compatibility where possible

**State modifications**:

1. Always use `withLock()` from `src/state.js`
2. Read state, modify, write back atomically
3. Never access `state.json` directly without lock

## Security

- Bootstrap scripts run as `workspace` user with passwordless sudo (by design)
- Containers run privileged (required for Docker-in-Docker)

## Debugging

**Container issues**: `workspace logs <name> -f`

**SSH connectivity**: Check `~/.workspaces/state/<name>/ssh/` for keys, `runtime.json` for port

**Docker issues**: `docker ps -a`, `docker logs <container>`, `docker exec <container> docker info`

**State issues**: Check `~/.workspaces/state/state.json` and `.lock` file

**Init failures**: Run `workspace shell <name> -c "cat ~/.workspace-initialized"` to check marker

## Don't

- Don't add build steps (no TypeScript, no bundling)
- Don't add databases or external services for state
- Don't break backward compatibility with existing `.workspace.yml` files
- Don't add features that require root on host
- Don't use `docker exec` for user interaction (use SSH via `workspace shell`)
- Don't add any new commands unless explicitly permitted by the developer.

## Do

- Keep commands fast (lazy initialization, container reuse)
- Provide clear error messages with actionable fixes
- Support both "from project dir" and "by name" command patterns
- Test with real Docker, not mocks
- Document new config options in README.md
- Follow existing naming: `workspace-<name>` for containers and other resources. Any internal resources must be prefixed with `workspace-internal-`
