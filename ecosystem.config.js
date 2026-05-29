/**
 * PM2 Ecosystem Configuration — MiniMe VPS Deployment
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup   # auto-restart on reboot
 *   pm2 logs                  # view logs
 *   pm2 monit                 # live dashboard
 */

module.exports = {
  apps: [
    {
      name: 'minime-web',
      cwd: './apps/web',
      script: 'node_modules/.bin/next',
      args: 'start',
      instances: 1,          // Increase to 'max' for multi-core
      exec_mode: 'fork',     // Use 'cluster' if instances > 1
      watch: false,
      max_memory_restart: '512M',
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: './logs/web-error.log',
      out_file: './logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
    // Uncomment if you use the separate bot app (apps/bot)
    // {
    //   name: 'minime-bot',
    //   cwd: './apps/bot',
    //   script: 'index.js',
    //   instances: 1,
    //   watch: false,
    //   max_memory_restart: '256M',
    //   env_production: {
    //     NODE_ENV: 'production',
    //     PORT: 3001,
    //   },
    //   error_file: './logs/bot-error.log',
    //   out_file: './logs/bot-out.log',
    //   log_date_format: 'YYYY-MM-DD HH:mm:ss',
    // },
  ],
};
