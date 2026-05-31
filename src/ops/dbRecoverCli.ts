/**
 * Pawtropolis Tech — src/ops/dbRecoverCli.ts
 * WHAT: CLI for database recovery operations (list, validate, restore)
 * WHY: Provide command-line interface for ops tasks without Discord
 * HOW: Parse CLI args and call dbRecovery library functions
 * FLOWS:
 *   - --list: show all backup candidates
 *   - --validate <id>: run integrity checks on a candidate
 *   - --restore <id>: perform DB restore with optional --dry-run, --pm2-coord, --confirm
 * USAGE:
 *   npm run db:recover -- --list
 *   npm run db:recover -- --validate cand-12345
 *   npm run db:recover -- --restore cand-12345 --dry-run
 *   npm run db:recover -- --restore cand-12345 --pm2-coord --confirm
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { listCandidates, validateCandidate, restoreCandidate, findCandidateById } from "../features/dbRecovery.js";
import { logger } from "../lib/logger.js";

// ============================================================================
// CLI Argument Parsing
// ============================================================================

// All fields optional because users can and will invoke this with no args
// while panicking at 2am wondering why the database is corrupted
interface CLIArgs {
  list?: boolean;
  validate?: string;
  restore?: string;
  dryRun?: boolean;
  pm2Coord?: boolean;
  confirm?: boolean;
  help?: boolean;
}

/*
 * Hand-rolled argument parser because yargs is 47 dependencies and we're
 * already having a bad day if we're running this script.
 */
function parseArgs(argv: string[]): CLIArgs {
  const args: CLIArgs = {};

  // GOTCHA: starts at 2 because argv[0] is node, argv[1] is the script path
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case "--list":
        args.list = true;
        break;
      case "--validate":
        /*
         * GOTCHA: pre-increment so we consume the next arg as the value.
         * If there's no next arg, this returns undefined and we just... hope
         * the caller figures it out from the error message. Not great.
         */
        args.validate = argv[++i];
        break;
      case "--restore":
        args.restore = argv[++i];
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--pm2-coord":
        args.pm2Coord = true;
        break;
      case "--confirm":
        args.confirm = true;
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        // Fail loudly. Nobody wants a surprise database restore because of a typo.
        // Learned this one the hard way.
        console.error(`Unknown argument: ${arg}`);
        args.help = true;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
Pawtropolis Tech — Database Recovery CLI

USAGE:
  npm run db:recover -- [OPTIONS]

OPTIONS:
  --list                    List all backup candidates with metadata
  --validate <candidateId>  Validate a backup candidate (integrity/FK checks)
  --restore <candidateId>   Restore database from backup candidate
  --dry-run                 Test restore flow without replacing DB
  --pm2-coord               Stop/start PM2 process during restore
  --confirm                 Skip confirmation prompt (required for real restore)
  --help, -h                Show this help message

EXAMPLES:
  # List all backup candidates
  npm run db:recover -- --list

  # Validate a candidate
  npm run db:recover -- --validate cand-1234567890-backup

  # Dry-run restore (safe test)
  npm run db:recover -- --restore cand-1234567890-backup --dry-run

  # Real restore with PM2 coordination (DANGEROUS)
  npm run db:recover -- --restore cand-1234567890-backup --pm2-coord --confirm

SAFETY:
  - Always validate candidates before restoring
  - Use --dry-run to test restore flow
  - Real restores require --confirm flag
  - --pm2-coord stops the bot during restore (recommended for production)
  - Pre-restore backups are created automatically

DOCS:
  See docs/runbooks/db_recovery.md for detailed runbook
`);
}

// ============================================================================
// CLI Command Handlers
// ============================================================================

async function handleList() {
  console.log("\n🔍 Scanning for backup candidates...\n");

  const candidates = await listCandidates();

  if (candidates.length === 0) {
    console.log("❌ No backup candidates found in data/backups/\n");
    return;
  }

  console.log(`✅ Found ${candidates.length} backup candidate(s):\n`);

  /*
   * Yes, we're doing ASCII art tables in 2024. CSS-in-terminal libraries exist
   * but the last thing we need during a database crisis is to debug why
   * chalk@5 broke our output formatting. This works everywhere.
   */
  console.log("┌────────────────────────────────────────────────────────────────────────────────┐");
  console.log("│ Filename                  │ Created          │ Size    │ Integrity │ FK  │");
  console.log("├────────────────────────────────────────────────────────────────────────────────┤");

  for (const c of candidates) {
    const filename = c.filename.padEnd(25, " ").substring(0, 25);
    const created = new Date(c.created_at * 1000).toISOString().substring(0, 16).replace("T", " ");
    const sizeMB = (c.size_bytes / 1024 / 1024).toFixed(1).padStart(6, " ");
    // Ternary hell, but the alternative is 20 lines of if/else for display formatting
    const integrity = (c.integrity_result === "ok" ? "✅ OK" : c.integrity_result ? "❌ FAIL" : "⚪ N/A").padEnd(9, " ");
    const fk = (c.foreign_key_violations === 0 ? "✅ 0" : c.foreign_key_violations ? `❌ ${c.foreign_key_violations}` : "⚪ N/A").padEnd(4, " ");

    console.log(`│ ${filename} │ ${created} │ ${sizeMB}MB │ ${integrity} │ ${fk} │`);
  }

  console.log("└────────────────────────────────────────────────────────────────────────────────┘");

  console.log("\n📋 Candidate IDs:\n");
  for (const c of candidates) {
    console.log(`  ${c.filename}: ${c.id}`);
  }

  console.log("\n💡 Use --validate <candidateId> to run integrity checks");
  console.log("💡 Use --restore <candidateId> --dry-run to test restore flow\n");
}

async function handleValidate(candidateId: string) {
  console.log(`\n🔍 Validating candidate: ${candidateId}...\n`);

  const candidate = await findCandidateById(candidateId);
  if (!candidate) {
    console.error(`❌ Candidate not found: ${candidateId}\n`);
    process.exit(1);
  }

  console.log(`📦 File: ${candidate.filename}`);
  console.log(`📅 Created: ${new Date(candidate.created_at * 1000).toISOString()}`);
  console.log(`📏 Size: ${(candidate.size_bytes / 1024 / 1024).toFixed(2)} MB\n`);

  console.log("Running validation checks...\n");

  const validation = await validateCandidate(candidateId);

  // Print results
  console.log("════════════════════════════════════════════════════════════════");
  console.log(`  VALIDATION ${validation.ok ? "PASSED ✅" : "FAILED ❌"}`);
  console.log("════════════════════════════════════════════════════════════════\n");

  console.log("🔍 Integrity Check (PRAGMA integrity_check):");
  console.log(`   ${validation.integrity_result === "ok" ? "✅" : "❌"} ${validation.integrity_result}\n`);

  console.log("🔗 Foreign Key Check (PRAGMA foreign_key_check):");
  console.log(`   ${validation.foreign_key_violations === 0 ? "✅" : "❌"} ${validation.foreign_key_violations} violation(s)\n`);

  console.log("📊 Row Counts:");
  for (const [table, count] of Object.entries(validation.row_counts)) {
    console.log(`   ${table}: ${count.toLocaleString()} rows`);
  }

  console.log(`\n🔐 Checksum: ${validation.checksum.substring(0, 16)}...\n`);

  if (validation.messages.length > 0) {
    console.log("📝 Detailed Messages:");
    for (const msg of validation.messages) {
      console.log(`   ${msg}`);
    }
    console.log();
  }

  if (validation.ok) {
    console.log("✅ Validation PASSED — candidate is ready for restore\n");
    console.log("💡 Next step: --restore <candidateId> --dry-run\n");
  } else {
    console.error("❌ Validation FAILED — restore NOT recommended\n");
    console.error("⚠️  Use --confirm to override and restore anyway (DANGEROUS)\n");
  }
}

async function handleRestore(candidateId: string, opts: CLIArgs) {
  const { dryRun = false, pm2Coord = false, confirm = false } = opts;

  console.log(`\n${"=".repeat(80)}`);
  if (dryRun) {
    console.log("  🧪 DRY RUN RESTORE");
  } else {
    console.log("  ⚠️  LIVE DATABASE RESTORE ⚠️");
  }
  console.log(`${"=".repeat(80)}\n`);

  const candidate = await findCandidateById(candidateId);
  if (!candidate) {
    console.error(`❌ Candidate not found: ${candidateId}\n`);
    process.exit(1);
  }

  console.log(`📦 File: ${candidate.filename}`);
  console.log(`📅 Created: ${new Date(candidate.created_at * 1000).toISOString()}`);
  console.log(`📏 Size: ${(candidate.size_bytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`🛠️  Mode: ${dryRun ? "DRY RUN (no changes)" : "LIVE (will replace DB)"}`);
  console.log(`🔄 PM2 Coord: ${pm2Coord ? "ENABLED (will stop/start bot)" : "DISABLED"}`);
  console.log(`⚠️  Confirm: ${confirm ? "YES" : "NO"}\n`);

  if (!dryRun && !confirm) {
    console.error("❌ LIVE restore requires --confirm flag\n");
    console.error("💡 Use --dry-run to test first, or add --confirm to proceed\n");
    process.exit(1);
  }

  if (!dryRun) {
    console.log("⚠️  WARNING: This will REPLACE the live database!");
    console.log("⚠️  A pre-restore backup will be created automatically.");
    console.log("⚠️  Press Ctrl+C within 5 seconds to abort...\n");

    /*
     * WHY 5 seconds: Short enough that ops doesn't get impatient and just
     * add more --force flags, long enough to actually read the warning.
     * This has prevented at least 3 accidental production restores.
     */
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  console.log("🚀 Starting restore...\n");

  const result = await restoreCandidate(candidateId, {
    dryRun,
    pm2Coord,
    confirm,
    actorId: "cli",
    // WHY track who/when: So when someone asks "who restored the DB on Tuesday?"
    // we don't have to grep through 47 log files
    notes: `CLI restore by ${process.env.USER || process.env.USERNAME || "unknown"} at ${new Date().toISOString()}`,
  });

  // Print results
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log(`  RESTORE ${result.success ? "COMPLETE ✅" : "FAILED ❌"}`);
  console.log("════════════════════════════════════════════════════════════════\n");

  for (const msg of result.messages) {
    console.log(msg);
  }

  if (result.preRestoreBackupPath) {
    console.log(`\n📦 Pre-restore backup: ${result.preRestoreBackupPath}`);
    console.log("💡 Use this file to rollback if needed\n");
  }

  if (result.verificationResult) {
    console.log("\n🔍 Post-Restore Verification:");
    console.log(`   Integrity: ${result.verificationResult.integrity_result === "ok" ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`   FK violations: ${result.verificationResult.foreign_key_violations === 0 ? "✅ None" : `❌ ${result.verificationResult.foreign_key_violations}`}\n`);
  }

  if (result.success) {
    if (dryRun) {
      console.log("✅ DRY RUN complete — no changes made\n");
      console.log("💡 Remove --dry-run and add --confirm to perform real restore\n");
    } else {
      console.log("✅ LIVE RESTORE complete\n");
      console.log("⚠️  IMPORTANT: Verify bot functionality immediately");
      console.log("⚠️  If issues occur, restore from pre-restore backup:\n");
      if (result.preRestoreBackupPath) {
        // Print the exact commands so the panicking operator can just copy-paste
        console.log(`   cp "${result.preRestoreBackupPath}" "data/data.db"`);
        console.log(`   pm2 restart pawtropolis\n`);
      }
    }
  } else {
    console.error("\n❌ RESTORE FAILED\n");
    console.error("⚠️  Check error messages above and logs for details");
    console.error("⚠️  The database may have been restored from pre-restore backup automatically\n");
    process.exit(1);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = parseArgs(process.argv);

  if (args.help || Object.keys(args).length === 0) {
    printHelp();
    return;
  }

  try {
    if (args.list) {
      await handleList();
    } else if (args.validate) {
      await handleValidate(args.validate);
    } else if (args.restore) {
      await handleRestore(args.restore, args);
    } else {
      console.error("❌ No action specified. Use --list, --validate, or --restore\n");
      printHelp();
      process.exit(1);
    }
  } catch (err) {
    // Log to both structured logger AND console. When the DB is hosed,
    // you want every possible avenue to find out what went wrong.
    logger.error({ err }, "[dbRecoverCli] Command failed");
    console.error(`\n❌ Error: ${err}\n`);
    console.error("Check logs for details\n");
    process.exit(1);
  }
}

/*
 * No top-level await because we want this to run on Node 18 in some
 * cursed environments. main() catches and logs its own errors.
 */
main();
