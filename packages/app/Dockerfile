FROM node:20-bookworm

ENV PNPM_HOME="/usr/local/bin"
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /usr/src/app

# Install dependencies separately so they can be cached even when source files change.
COPY package.json package-lock.json* .npmrc* ./
RUN npm install --include=dev

# PM2 expects the ecosystem file to exist even before the bind mount is ready.
COPY pm2 ./pm2

CMD ["npm", "run", "dev"]
