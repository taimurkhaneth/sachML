// pm2 keeps both programs running, restarts them if they crash,
// and starts them again after a server reboot (after `pm2 save` + `pm2 startup`).
//
//   pm2 start ecosystem.config.js
//   pm2 logs sach-bot        <- shows the QR code the first time
//   pm2 status

module.exports = {
  apps: [
    {
      name: 'sach-api',
      cwd: __dirname,
      script: 'api/app.py',
      interpreter: __dirname + '/api/.venv/bin/python',
      autorestart: true,
      restart_delay: 3000,
      max_memory_restart: '1200M',
      env: { PYTHONUNBUFFERED: '1' },
    },
    {
      name: 'sach-bot',
      cwd: __dirname + '/bot',
      script: 'index.js',
      autorestart: true,
      restart_delay: 5000,                 // wait 5s before restarting after a disconnect
      exp_backoff_restart_delay: 2000,     // wait longer if it keeps failing
      max_memory_restart: '900M',          // the hidden Chrome can grow; restart before it hurts the server
      cron_restart: '30 4 * * *',          // fresh start every night at 04:30 (login is kept)
      kill_timeout: 15000,                 // give WhatsApp time to close cleanly
    },
  ],
};
