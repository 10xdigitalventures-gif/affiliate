// PM2 process manager config for the 10x Affiliate platform.
// Runs the API (NestJS), the dashboard/app (Next.js) and the marketing site.
//
// Usage (repo root on the server):
//   npm --prefix backend run build && npm --prefix web run build && npm --prefix marketing run build
//   pm2 start deploy/ecosystem.config.js
//   pm2 save && pm2 startup     # persist across reboots
//
// Real secrets live in backend/.env (loaded at runtime), not here.
const path = require('path')
const ROOT = path.resolve(__dirname, '..')

module.exports = {
  apps: [
    {
      // Keep the same process name already used on the Windows host.
      name: 'affiliate-backend',
      cwd: path.join(ROOT, 'backend'),
      script: 'dist/main.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production', API_PORT: '4100' },
      error_file: path.join(ROOT, 'logs/api-error.log'),
      out_file: path.join(ROOT, 'logs/api-out.log'),
      time: true,
    },
    {
      name: 'affiliate-web',
      cwd: path.join(ROOT, 'web'),
      script: '.next/standalone/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3100' },
      error_file: path.join(ROOT, 'logs/web-error.log'),
      out_file: path.join(ROOT, 'logs/web-out.log'),
      time: true,
    },
    {
      name: 'affiliate-marketing',
      cwd: path.join(ROOT, 'marketing'),
      script: '.next/standalone/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '384M',
      env: { NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3002' },
      error_file: path.join(ROOT, 'logs/marketing-error.log'),
      out_file: path.join(ROOT, 'logs/marketing-out.log'),
      time: true,
    },
  ],
}
