#!/usr/bin/env node
/**
 * Simple migration runner for remote deployment.
 * Doesn't require dotenvx - uses dotenv directly.
 */

require('dotenv').config();
if (require('fs').existsSync('.env.build')) {
  require('dotenv').config({ path: '.env.build' });
}

const { spawnSync } = require('child_process');

// Run the TypeScript migration script with tsx
const result = spawnSync('npx', ['tsx', 'scripts/migrate.ts'], {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

process.exit(result.status || 0);
