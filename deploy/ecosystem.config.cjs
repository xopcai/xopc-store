/** PM2 — run from repo root after `pnpm build` in apps/server */
module.exports = {
  apps: [
    {
      name: "xopc-store-api",
      cwd: __dirname + "/../apps/server",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
}
