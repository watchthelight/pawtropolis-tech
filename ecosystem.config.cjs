module.exports = {
  apps: [
    {
      name: 'pawtropolis',
      script: 'dist/index.js',
      cwd: '/home/ubuntu/pawtropolis-tech',
      exec_mode: 'fork',
      node_args: '--env-file=.env --env-file=.env.build',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        DB_HEALTHCHECK_MODE: 'full'
      }
    },
    {
      name: 'pawtropolis-web',
      script: 'web/build/index.js',
      cwd: '/home/ubuntu/pawtropolis-tech',
      node_args: '--env-file=.env',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
        ORIGIN: 'https://pawtropolis.tech',
        PROTOCOL_HEADER: 'X-Forwarded-Proto',
        HOST_HEADER: 'X-Forwarded-Host',
        ADDRESS_HEADER: 'X-Forwarded-For',
        XFF_DEPTH: '2'
      }
    },
    {
      // One-shot resumable backfill of every message in primary guild.
      // autorestart:false — exits cleanly when done; resume cursor in DB means
      // a manual `pm2 restart pawtropolis-backfill` picks up where it left off.
      name: 'pawtropolis-backfill',
      script: 'node_modules/.bin/tsx',
      args: 'scripts/backfill/run.ts',
      cwd: '/home/ubuntu/pawtropolis-tech',
      interpreter: 'none',
      node_args: '--env-file=.env',
      instances: 1,
      autorestart: false,
      max_restarts: 3,
      restart_delay: 30000,
      kill_timeout: 30000,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
