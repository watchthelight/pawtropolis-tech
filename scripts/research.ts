/**
 * Pawtropolis Tech -- scripts/research.ts
 * WHAT: Entry of the chat research job. Built to dist/scripts/research.js and
 *       started by cron; `--help` lists the flags.
 * WHY: The work is in src/features/research/. This file only loads .env, calls
 *      it and turns a failure into one line of JSON and exit code 1, so that
 *      the log of the cron line has one line per run whatever happens.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import "dotenv/config";
import { main } from "../src/features/research/cli.js";

try {
  process.exitCode = await main(process.argv.slice(2), process.env);
} catch (err) {
  const error = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), error })}\n`);
  process.exitCode = 1;
}
