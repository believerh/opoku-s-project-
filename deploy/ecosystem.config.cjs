// PM2 alternative to systemd:  pm2 start deploy/ecosystem.config.cjs && pm2 save && pm2 startup
module.exports = {
  apps: [{
    name: 'okomfo-anokye',
    script: 'server.js',
    cwd: __dirname + '/..',
    instances: 1,
    autorestart: true,
    max_memory_restart: '400M',
    env: { NODE_ENV: 'production' }
  }]
};
