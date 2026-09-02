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
      // 15s grace before SIGKILL. Lets in-flight interactions, db migrations,
      // and bulk fetches drain on restart instead of being truncated.
      kill_timeout: 15000,
      env: {
        NODE_ENV: 'production',
        // `full` scanned every page of the multi-GB file at every boot, minutes with the
        // bot offline. The off-process scheduler runs the periodic check instead.
        DB_HEALTHCHECK_MODE: 'quick'
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
      // 10s grace for in-flight HTTP requests to drain on restart.
      kill_timeout: 10000,
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
      script: 'scripts/backfill/run.ts',
      cwd: '/home/ubuntu/pawtropolis-tech',
      interpreter: 'node',
      interpreter_args: '--env-file=.env --import=tsx',
      exec_mode: 'fork',
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
