# Dockside React Router Demo

A tiny React Router 7 + Express blog that runs entirely inside a dev-purpose Docker container.
Source changes are bind-mounted into the container so the frontend hot reloads via Vite and the
backend restarts through PM2 watching the `server/` directory.

## Prerequisites

- Node 20+ if you want to run it locally without Docker.
- Docker + Docker Compose v2 for the intended workflow.

## Running with Docker

```bash
cd packages
docker compose up --build
```

What happens:

- The container installs dependencies during the image build.
- Your working tree mounts into `/usr/src/app`.
- PM2 launches two processes from `pm2/ecosystem.config.cjs`:
  - `client`: Vite dev server on port `5173` with HMR for the React Router UI.
  - `api`: Express API on port `5172`, watched by PM2 so touching files in `server/` restarts it.

Visit [http://localhost:5173](http://localhost:5173) for the UI. API endpoints (e.g.
`http://localhost:5173/api/posts`) remain accessible directly.

To stop the stack, press `Ctrl+C` and run `docker compose down` if you want to remove the container.

## Local (non-Docker) usage

```bash
cd packages/app
npm install
npm run dev
```

The `dev` script runs the PM2 ecosystem so the API and Vite dev server behave the same as in Docker.

## Project layout

```
src/            React Router SPA (loaders fetch from the API)
server/         Express API that exposes blog post data
pm2/            Ecosystem file with a server-only watch list
Dockerfile      Dev-focused image that runs `pm2-runtime`
../docker-compose.yml  Helper compose file with bind mounts and port mapping
```

Feel free to extend the API or add new routes—the PM2 watcher only tracks `server/**` so frontend
edits are handled exclusively by Vite.
