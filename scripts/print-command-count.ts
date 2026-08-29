// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Prints how many slash commands the local builders produce.
 * Used by scripts/generate-badge-metrics.js. Unlike print-commands.ts this
 * reads the local spec instead of the live guild registry, so it works in CI
 * where there is no real Discord token.
 */
import { buildSpec } from "./commands.js";

console.log(`COMMAND_COUNT=${buildSpec().length}`);
// The command builders open the SQLite handle on import, which keeps the loop
// alive. Nothing else is pending, so leave now.
process.exit(0);
