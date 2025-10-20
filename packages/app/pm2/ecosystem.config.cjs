module.exports = {
  apps: [
    {
      name: "api",
      cwd: process.env.PWD ?? ".",
      script: "./node_modules/.bin/tsx",
      args: "server/index.ts",
      watch: ["server"],
      ignore_watch: ["node_modules", "dist", "src"],
      env: {
        NODE_ENV: "development",
        SERVER_PORT: process.env.SERVER_PORT ?? 5172,
      },
      restart_delay: 1000,
    },
    {
      name: "client",
      cwd: process.env.PWD ?? ".",
      script: "./node_modules/.bin/vite",
      args: "--host 0.0.0.0 --port 5173",
      watch: false,
      env: {
        NODE_ENV: "development",
        PORT: process.env.PORT ?? 5173,
      },
    },
  ],
};
