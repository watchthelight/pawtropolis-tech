module.exports = {
  apps: [
    {
      name: 'pawtropolis',
      script: 'dist/index.js',
      cwd: '/home/ubuntu/pawtropolis-tech',
      node_args: '--env-file=.env --env-file=.env.build',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production'
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
    }
  ]
};
