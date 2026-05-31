#!/usr/bin/env node
/**
 * Simple migration runner for remote deployment.
 * Doesn't require dotenvx - uses dotenv directly.
 */

import 'dotenv/config.js';
import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';

// Load build env if present
if (existsSync('.env.build')) {
  dotenv.config({ path: '.env.build' });
}

// Run the TypeScript migration script with tsx.
const result = spawnSync('npx', ['tsx', 'scripts/migrate.ts', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
// A signal kill (OOM, SIGTERM) leaves status=null and signal set. `null || 0`
// would falsely report success, so fail closed: null status or any signal -> 1.
process.exit(result.signal ? 1 : (result.status ?? 1));
