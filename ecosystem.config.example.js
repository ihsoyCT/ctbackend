// Copy to ecosystem.config.js (gitignored), fill in API_KEY, then:
//   pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [{
    name: 'ctarchive-analytics',
    script: 'server.js',
    cwd: __dirname,
    max_memory_restart: '300M',
    env: {
      PORT: 3031,
      API_KEY: 'change-me',
      LOG_DIR: '/var/log/ihsoyct-ref',
      RETENTION_DAYS: 90,
      MAX_DB_MB: 2048,
      MIN_FREE_MB: 1024,
      STATS_REFRESH_MIN: 10,
    },
  }],
};
