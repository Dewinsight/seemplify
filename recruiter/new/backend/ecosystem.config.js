module.exports = {
  apps: [
    {
      name: 'smarthr-backend',
      script: './server.js',
      instances: 1,
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 5001
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 5001
      },
      error_file: './logs/err.log',
      out_file: './logs/out.log',
      log_file: './logs/combined.log',
      time: true,
      cron_restart: '0 0 * * *', // Restart daily at midnight
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 3000,
      // Logging
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
