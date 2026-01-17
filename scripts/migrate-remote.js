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

// Run the TypeScript migration script with tsx
const result = spawnSync('npx', ['tsx', 'scripts/migrate.ts'], {
  stdio: 'inherit',
  shell: true,
  env: process.env
});

process.exit(result.status || 0);
