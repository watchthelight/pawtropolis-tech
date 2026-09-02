/**
 * Pawtropolis Tech — src/features/dbRecovery.ts
 * WHAT: Core database recovery library for listing, validating, and restoring backups
 * WHY: Enable safe, auditable database recovery with integrity checks and PM2 coordination
 * HOW: Scan backup directory, run SQLite PRAGMA checks, orchestrate safe restore flow
 * FLOWS:
 *   1. listCandidates() - discover backup files in DB_BACKUPS_DIR and return metadata
 *   2. validateCandidate() - run integrity/FK checks on a backup candidate
 *   3. restoreCandidate() - safely restore a backup with pre-restore backup and PM2 coordination
 * DOCS:
 *   - SQLite PRAGMA: https://www.sqlite.org/pragma.html
 *   - better-sqlite3: https://github.com/WiseLibs/better-sqlite3
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { env } from "../lib/env.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";

/**
 * scheduleDetachedPm2Restart
 * WHAT: Spawn an independent, detached process that waits briefly then runs
 *       `pm2 restart <processName>`.
 * WHY: The bot IS the PM2-managed process. Calling `pm2 stop`/`pm2 restart` and
 *      awaiting it from inside itself tears down this event loop mid-restore, so
 *      the file replacement/verify/reply never finish (#00068). A detached +
 *      unref'd child survives our own restart, and the short delay lets the
 *      success reply flush to Discord before we go down.
 * SAFETY: processName must already be validated (validateProcessName) before this
 *         is called; delaySec is a numeric literal. No untrusted input reaches sh.
 */
function scheduleDetachedPm2Restart(processName: string, delaySec = 2): void {
  const child = spawn("sh", ["-c", `sleep ${delaySec}; pm2 restart ${processName}`], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  logger.info({ processName, delaySec }, "[dbRecovery] Scheduled detached pm2 restart");
}

// ============================================================================
// Security: Path Traversal Protection
// ============================================================================

/**
 * Regex for validating safe backup filenames.
 * Only allows alphanumeric, underscore, hyphen, and dot characters.
 * Must end with .db extension.
 */
const SAFE_FILENAME_REGEX = /^[a-zA-Z0-9_\-.]+\.db$/;

/**
 * Regex for validating PM2 process names.
 * Only allows alphanumeric, underscore, and hyphen characters.
 * This prevents shell injection attacks when the name is used in exec() calls.
 */
const SAFE_PROCESS_NAME_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate and sanitize PM2 process name to prevent shell injection.
 * @param name - Process name from environment variable
 * @returns The validated process name
 * @throws Error if name is undefined or contains unsafe characters
 */
function validateProcessName(name: string | undefined): string {
  if (!name) {
    throw new Error("PM2_PROCESS_NAME not configured in environment");
  }
  if (!SAFE_PROCESS_NAME_REGEX.test(name)) {
    logger.error(
      { processName: name },
      "[dbRecovery] Invalid PM2_PROCESS_NAME format - potential injection attempt"
    );
    throw new Error("Invalid PM2_PROCESS_NAME format - only alphanumeric, underscore, and hyphen allowed");
  }
  return name;
}

/**
 * Safely join a base directory with a filename, preventing path traversal attacks.
 * Validates that the resolved path is actually within the base directory.
 *
 * @param baseDir - The base directory (must be absolute)
 * @param filename - The filename to join
 * @returns The resolved absolute path
 * @throws Error if path traversal is detected or filename is invalid
 */
function safeJoinPath(baseDir: string, filename: string): string {
  // First, validate filename format
  if (!SAFE_FILENAME_REGEX.test(filename)) {
    logger.error(
      { filename, baseDir },
      "[dbRecovery] Invalid backup filename rejected - potential path traversal"
    );
    throw new Error("Invalid backup filename");
  }

  // Join and resolve the path
  const filePath = path.join(baseDir, filename);
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(baseDir);

  // Verify the resolved path is within the base directory
  // Using startsWith with path.sep ensures we don't match partial directory names
  // e.g., /backups wouldn't match /backups-other/file.db
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    logger.error(
      { filename, resolvedPath, resolvedBase },
      "[dbRecovery] Path traversal attempt detected"
    );
    throw new Error("Path traversal attempt detected");
  }

  return resolvedPath;
}

// ============================================================================
// Types
// ============================================================================

export interface BackupCandidate {
  id: string; // unique identifier (e.g., "cand-<timestamp>-<shortname>")
  path: string; // absolute path to backup file
  filename: string; // basename only
  created_at: number; // epoch seconds (file mtime)
  size_bytes: number; // file size
  integrity_result?: string; // "ok" or error message from PRAGMA integrity_check
  foreign_key_violations?: number; // count from PRAGMA foreign_key_check
  row_count?: number; // sum of row counts from sampled tables
  checksum?: string; // SHA256 hash
  verified_at?: number; // last validation timestamp (epoch seconds)
  notes?: string; // human notes
}

export interface ValidationResult {
  ok: boolean; // true if all checks pass
  messages: string[]; // human-readable messages (errors, warnings)
  integrity_result: string; // PRAGMA integrity_check output
  foreign_key_violations: number; // count of FK violations
  row_counts: Record<string, number>; // table -> row count
  size_bytes: number;
  checksum: string;
}

export interface RestoreOptions {
  dryRun?: boolean; // if true, stop before file replacement
  pm2Coord?: boolean; // if true, stop/start PM2 process
  confirm?: boolean; // if true, skip confirmation prompt (CLI only)
  actorId?: string; // Discord user ID or "cli" for audit log
  notes?: string; // human notes for pre-restore backup
}

export interface RestoreResult {
  success: boolean;
  preRestoreBackupPath?: string; // path to pre-restore backup
  messages: string[]; // human-readable messages
  verificationResult?: ValidationResult; // post-restore validation
}

// ============================================================================
// Candidate Discovery
// ============================================================================

/**
 * List all backup candidates in DB_BACKUPS_DIR
 * Scans directory for .db files and computes basic metadata
 * Does NOT run integrity checks (use validateCandidate for that)
 *
 * @returns Array of backup candidates sorted by created_at DESC (newest first)
 */
export async function listCandidates(): Promise<BackupCandidate[]> {
  // Discover all .db files in the backup directory and return metadata.
  // This is intentionally lightweight - we don't run integrity checks here because
  // that's expensive and the caller should use validateCandidate() when they need it.
  const backupsDir = path.resolve(env.DB_BACKUPS_DIR);
  logger.info(`[dbRecovery] Scanning for backup candidates in ${backupsDir}`);

  try {
    // Create directory if it doesn't exist (common on first run)
    await fs.mkdir(backupsDir, { recursive: true });
    const files = await fs.readdir(backupsDir);
    const dbFiles = files.filter((f) => f.endsWith(".db"));

    logger.info(`[dbRecovery] Found ${dbFiles.length} .db files`);

    const candidates: BackupCandidate[] = [];

    for (const filename of dbFiles) {
      // Security: Validate filename even though it comes from fs.readdir (defense in depth)
      // Skip files with suspicious names rather than throw
      if (!SAFE_FILENAME_REGEX.test(filename)) {
        logger.warn({ filename }, "[dbRecovery] Skipping file with invalid filename");
        continue;
      }
      const filePath = safeJoinPath(backupsDir, filename);
      try {
        const stats = await fs.stat(filePath);

        // Generate unique ID from timestamp + short filename
        // The ID needs to be stable across calls so we can reference candidates by ID.
        // Using mtime means if a file is modified, it gets a new ID - this is intentional
        // because a modified backup should be re-validated before restore.
        const shortName = filename.replace(/\.db$/, "").replace(/[^a-zA-Z0-9\-]/g, "-");
        const id = `cand-${stats.mtimeMs.toFixed(0)}-${shortName}`.substring(0, 64);

        // Check if metadata exists in db_backups table
        const existingMeta = db
          .prepare(`SELECT * FROM db_backups WHERE path = ?`)
          .get(filePath) as any;

        candidates.push({
          id,
          path: filePath,
          filename,
          created_at: Math.floor(stats.mtimeMs / 1000),
          size_bytes: stats.size,
          integrity_result: existingMeta?.integrity_result,
          // db_backups does not persist a foreign-key-violation count; do not alias
          // it to row_count (that mislabels the total row count as FK violations).
          foreign_key_violations: undefined,
          row_count: existingMeta?.row_count,
          checksum: existingMeta?.checksum,
          verified_at: existingMeta?.verified_at,
          notes: existingMeta?.notes,
        });
      } catch (err) {
        logger.warn({ err, filename }, `[dbRecovery] Failed to stat backup file`);
      }
    }

    // Sort by created_at DESC (newest first)
    candidates.sort((a, b) => b.created_at - a.created_at);

    logger.info(`[dbRecovery] Returning ${candidates.length} candidates`);
    return candidates;
  } catch (err) {
    logger.error({ err }, `[dbRecovery] Failed to list candidates`);
    throw new Error(`Failed to scan backup directory: ${err}`);
  }
}

/**
 * Find a candidate by ID
 */
export async function findCandidateById(candidateId: string): Promise<BackupCandidate | null> {
  const candidates = await listCandidates();
  return candidates.find((c) => c.id === candidateId) || null;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a backup candidate by running integrity checks
 * Opens the candidate DB in read-only mode and runs:
 *   - PRAGMA integrity_check
 *   - PRAGMA foreign_key_check
 *   - Row count verification (action_log, guilds, users, review_card)
 *   - SHA256 checksum
 *
 * Updates db_backups metadata table with validation results
 *
 * @param candidateId - unique candidate ID (from listCandidates)
 * @returns ValidationResult with all check results
 */
export async function validateCandidate(candidateId: string): Promise<ValidationResult> {
  // Run comprehensive integrity checks on a backup candidate.
  // This can take several seconds for large databases, so don't call it in hot paths.
  // Results are persisted to db_backups table for future reference.
  logger.info(`[dbRecovery] Validating candidate ${candidateId}`);

  const candidate = await findCandidateById(candidateId);
  if (!candidate) {
    throw new Error(`Candidate not found: ${candidateId}`);
  }

  const messages: string[] = [];
  let integrity_result = "unknown";
  let foreign_key_violations = 0;
  const row_counts: Record<string, number> = {};

  // Open candidate DB in read-only mode
  // IMPORTANT: readonly prevents accidental modifications to backup files
  let candidateDb: Database.Database | null = null;
  try {
    candidateDb = new Database(candidate.path, { readonly: true });

    // 1. PRAGMA integrity_check
    logger.info(`[dbRecovery] Running PRAGMA integrity_check on ${candidate.filename}`);
    const integrityRows = candidateDb.pragma("integrity_check") as Array<{ integrity_check: string }>;
    integrity_result = integrityRows.map((r) => r.integrity_check).join("; ");

    if (integrity_result === "ok") {
      messages.push("✅ Integrity check: PASS");
    } else {
      messages.push(`❌ Integrity check: FAIL - ${integrity_result}`);
    }

    // 2. PRAGMA foreign_key_check (requires foreign_keys ON)
    // This catches orphaned foreign keys that integrity_check misses.
    // Common cause: manual deletion of parent rows without cascade.
    // Note: We enable foreign_keys here even though it's read-only because
    // the pragma is needed for foreign_key_check to work properly.
    logger.info(`[dbRecovery] Running PRAGMA foreign_key_check`);
    candidateDb.pragma("foreign_keys = ON");
    const fkRows = candidateDb.pragma("foreign_key_check") as Array<any>;
    foreign_key_violations = fkRows.length;

    if (foreign_key_violations === 0) {
      messages.push("✅ Foreign key check: PASS (no violations)");
    } else {
      messages.push(`❌ Foreign key check: FAIL - ${foreign_key_violations} violation(s)`);
      // Log first 3 violations for debugging
      fkRows.slice(0, 3).forEach((fk) => {
        messages.push(`  - ${fk.table}.${fk.fkid}: references ${fk.parent} (missing)`);
      });
    }

    // 3. Row counts for important tables
    // This serves two purposes:
    // 1. Sanity check - if a backup has 0 rows in core tables, something's wrong
    // 2. Help operators pick the right backup by seeing data volume
    logger.info(`[dbRecovery] Counting rows in important tables`);
    const tablesToCheck = ["action_log", "guilds", "users", "review_card"];
    for (const table of tablesToCheck) {
      try {
        const result = candidateDb.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as {
          count: number;
        };
        row_counts[table] = result.count;
        messages.push(`📊 ${table}: ${result.count.toLocaleString()} rows`);
      } catch (err: any) {
        if (err.message?.includes("no such table")) {
          row_counts[table] = 0;
          messages.push(`⚠️ ${table}: table does not exist`);
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    logger.error({ err, candidateId }, `[dbRecovery] Validation failed`);
    messages.push(`❌ Validation error: ${err}`);
    integrity_result = `error: ${err}`;
  } finally {
    if (candidateDb) {
      candidateDb.close();
    }
  }

  // 4. Compute SHA256 checksum
  logger.info(`[dbRecovery] Computing SHA256 checksum`);
  const checksum = await computeChecksum(candidate.path);
  messages.push(`🔐 Checksum: ${checksum.substring(0, 16)}...`);

  // 5. Determine overall result
  const ok = integrity_result === "ok" && foreign_key_violations === 0;

  // 6. Update db_backups metadata
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO db_backups (path, created_at, size_bytes, integrity_result, row_count, checksum, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       integrity_result = excluded.integrity_result,
       row_count = excluded.row_count,
       checksum = excluded.checksum,
       verified_at = excluded.verified_at`
  ).run(
    candidate.path,
    candidate.created_at,
    candidate.size_bytes,
    integrity_result,
    Object.values(row_counts).reduce((sum, count) => sum + count, 0),
    checksum,
    now
  );

  logger.info(`[dbRecovery] Validation complete: ${ok ? "PASS" : "FAIL"}`);

  return {
    ok,
    messages,
    integrity_result,
    foreign_key_violations,
    row_counts,
    size_bytes: candidate.size_bytes,
    checksum,
  };
}

/**
 * Compute SHA256 checksum of a file
 */
async function computeChecksum(filePath: string): Promise<string> {
  // SHA256 checksum for integrity verification, streamed: backups are multi-GB and
  // reading one whole into memory is more than the production host has.
  return new Promise((resolve, reject) => {
    const hashSum = createHash("sha256");
    createReadStream(filePath)
      .on("data", (chunk) => hashSum.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hashSum.digest("hex")));
  });
}

// ============================================================================
// Restore
// ============================================================================

/**
 * Safely restore a backup candidate
 * Steps:
 *   1. Re-validate candidate (ensure nothing changed since validation)
 *   2. Create pre-restore backup of live DB
 *   3. Stop PM2 process (if pm2Coord enabled)
 *   4. Replace live DB with candidate (atomic rename)
 *   5. Verify restored DB (PRAGMA integrity_check + foreign_key_check)
 *   6. Restart PM2 process (if pm2Coord enabled)
 *   7. Log action to action_log
 *
 * @param candidateId - unique candidate ID
 * @param opts - restore options
 * @returns RestoreResult with success status and messages
 */
export async function restoreCandidate(
  candidateId: string,
  opts: RestoreOptions = {}
): Promise<RestoreResult> {
  const { dryRun = false, pm2Coord = false, confirm = false, notes = "" } = opts;

  // Restore is a multi-step process with built-in safety mechanisms:
  // 1. Re-validate the candidate (ensure nothing changed since last validation)
  // 2. Create a pre-restore backup of the live DB (for rollback)
  // 3. Optionally stop PM2 to release file locks
  // 4. Replace the live DB file
  // 5. Verify the restored DB works
  // 6. Optionally restart PM2
  // If anything fails after step 2, we have the pre-restore backup for recovery.
  logger.info({ candidateId, dryRun, pm2Coord, confirm }, `[dbRecovery] Starting restore`);

  const messages: string[] = [];
  const candidate = await findCandidateById(candidateId);

  if (!candidate) {
    return {
      success: false,
      messages: [`❌ Candidate not found: ${candidateId}`],
    };
  }

  // Step 1: Re-validate candidate
  logger.info(`[dbRecovery] Step 1: Re-validating candidate`);
  messages.push(`🔍 Validating backup candidate: ${candidate.filename}`);

  const validation = await validateCandidate(candidateId);
  if (!validation.ok && !confirm) {
    messages.push(`❌ Validation FAILED - aborting restore`);
    messages.push(...validation.messages);
    return { success: false, messages };
  }

  if (!validation.ok && confirm) {
    messages.push(`⚠️ Validation FAILED but --confirm override set - proceeding anyway`);
  } else {
    messages.push(`✅ Validation PASSED`);
  }

  // Step 2: Create pre-restore backup
  logger.info(`[dbRecovery] Step 2: Creating pre-restore backup`);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").substring(0, 19);
  const liveDbPath = path.resolve(env.DB_PATH);
  const preRestoreBackupPath = `${liveDbPath}.${timestamp}.preRestore.bak`;

  messages.push(`📦 Creating pre-restore backup: ${path.basename(preRestoreBackupPath)}`);

  if (!dryRun) {
    try {
      await fs.copyFile(liveDbPath, preRestoreBackupPath);
      messages.push(`✅ Pre-restore backup created`);

      // Register pre-restore backup in db_backups table
      const backupStats = await fs.stat(preRestoreBackupPath);
      const backupChecksum = await computeChecksum(preRestoreBackupPath);

      db.prepare(
        `INSERT INTO db_backups (path, created_at, size_bytes, integrity_result, checksum, notes)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        preRestoreBackupPath,
        Math.floor(backupStats.mtimeMs / 1000),
        backupStats.size,
        "ok", // assume current live DB is ok
        backupChecksum,
        notes || `Pre-restore backup before restoring ${candidate.filename}`
      );
    } catch (err) {
      messages.push(`❌ Failed to create pre-restore backup: ${err}`);
      return { success: false, messages };
    }
  } else {
    messages.push(`🔍 [DRY RUN] Would create: ${path.basename(preRestoreBackupPath)}`);
  }

  // Step 3: Prepare PM2 coordination (if enabled)
  //
  // We do NOT stop the bot here. The bot IS the PM2-managed process, so stopping
  // it from within itself terminates this event loop mid-restore and the
  // replace/verify/reply below never run (#00068). Instead we replace + verify
  // while running, then schedule a detached `pm2 restart` as the final step.
  // Validate the process name up front so we fail before touching the live DB if
  // it is misconfigured.
  let restartProcessName: string | null = null;
  if (pm2Coord) {
    logger.info(`[dbRecovery] Step 3: Validating PM2 process name (restart deferred to end)`);
    try {
      restartProcessName = validateProcessName(env.PM2_PROCESS_NAME);
    } catch (err) {
      messages.push(`❌ PM2 coordination failed: ${err instanceof Error ? err.message : "Invalid process name"}`);
      return { success: false, messages };
    }
    messages.push(
      dryRun
        ? `🔍 [DRY RUN] Would restart PM2 process at the end: ${restartProcessName}`
        : `🔁 Will restart PM2 process after restore: ${restartProcessName}`
    );
  }

  // Step 4: Replace live DB (if not dry-run)
  if (dryRun) {
    logger.info(`[dbRecovery] Step 4: DRY RUN - skipping DB replacement`);
    messages.push(`🔍 [DRY RUN] Would replace ${path.basename(liveDbPath)} with ${candidate.filename}`);
    messages.push(`✅ DRY RUN complete - no changes made`);
    return {
      success: true,
      preRestoreBackupPath,
      messages,
    };
  }

  logger.info(`[dbRecovery] Step 4: Replacing live DB`);
  messages.push(`🔄 Replacing live database with backup`);

  try {
    // We replace the DB file while still running (see Step 3). The live `db`
    // connection keeps its now-unlinked inode until the scheduled restart swaps
    // the process out, so:
    //   1. Flush + truncate the live WAL so no pending pages are stranded.
    //   2. Copy the candidate to a temp file, then rename() over the live path -
    //      rename is atomic on the same filesystem, so a crash mid-copy can never
    //      leave a half-written live DB.
    //   3. Drop the stale -wal/-shm sidecars so the restarted process opens the
    //      replaced file clean instead of replaying a mismatched WAL.
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch (ckptErr) {
      logger.warn({ err: ckptErr }, "[dbRecovery] pre-replace WAL checkpoint failed (continuing)");
    }

    const incomingTmpPath = `${liveDbPath}.incoming.tmp`;
    await fs.copyFile(candidate.path, incomingTmpPath);
    await fs.rename(incomingTmpPath, liveDbPath);

    // Best-effort: remove sidecars left by the old connection.
    await fs.rm(`${liveDbPath}-wal`, { force: true });
    await fs.rm(`${liveDbPath}-shm`, { force: true });

    messages.push(`Database replaced successfully`);
  } catch (err) {
    messages.push(`❌ Failed to replace database: ${err}`);
    messages.push(`🔄 Attempting rollback to pre-restore backup...`);

    try {
      await fs.copyFile(preRestoreBackupPath, liveDbPath);
      messages.push(`✅ Rollback successful - live DB restored from pre-restore backup`);
    } catch (rollbackErr) {
      messages.push(`❌ Rollback FAILED: ${rollbackErr}`);
      messages.push(`⚠️ MANUAL INTERVENTION REQUIRED: restore from ${preRestoreBackupPath}`);
    }

    return { success: false, messages };
  }

  // Step 5: Verify restored DB
  logger.info(`[dbRecovery] Step 5: Verifying restored database`);
  messages.push(`🔍 Verifying restored database`);

  let verificationResult: ValidationResult | undefined;
  try {
    // Open restored DB and run checks
    const restoredDb = new Database(liveDbPath, { readonly: true });

    const integrityRows = restoredDb.pragma("integrity_check") as Array<{ integrity_check: string }>;
    const integrity_result = integrityRows.map((r) => r.integrity_check).join("; ");

    restoredDb.pragma("foreign_keys = ON");
    const fkRows = restoredDb.pragma("foreign_key_check") as Array<any>;
    const foreign_key_violations = fkRows.length;

    restoredDb.close();

    verificationResult = {
      ok: integrity_result === "ok" && foreign_key_violations === 0,
      messages: [
        `Integrity: ${integrity_result}`,
        `FK violations: ${foreign_key_violations}`,
      ],
      integrity_result,
      foreign_key_violations,
      row_counts: validation.row_counts,
      size_bytes: candidate.size_bytes,
      checksum: validation.checksum,
    };

    if (verificationResult.ok) {
      messages.push(`✅ Post-restore verification PASSED`);
    } else {
      messages.push(`⚠️ Post-restore verification FAILED - see details above`);
    }
  } catch (err) {
    messages.push(`❌ Post-restore verification error: ${err}`);
  }

  // Step 6: Restart PM2 process (if enabled).
  //
  // We are still the live process here, so a synchronous `pm2 restart` would kill
  // this event loop before the caller can send its success reply (the #00068 bug).
  // Instead spawn a detached, unref'd `pm2 restart` that sleeps briefly and then
  // restarts us - it survives our own teardown and lets the reply flush first.
  if (pm2Coord && restartProcessName) {
    logger.info(`[dbRecovery] Step 6: Scheduling detached PM2 restart`);
    try {
      scheduleDetachedPm2Restart(restartProcessName);
      messages.push(`🚀 Restart scheduled: the bot will reload on the new database in a moment`);
    } catch (err: any) {
      messages.push(`⚠️ Could not schedule PM2 restart: ${err.message}`);
      messages.push(`   Restart manually: pm2 restart ${restartProcessName}`);
    }
  }

  // Step 7: Log action (done by caller - requires Guild context)
  logger.info(`[dbRecovery] Restore complete`);
  messages.push(`✅ Database restore complete`);

  return {
    success: true,
    preRestoreBackupPath,
    messages,
    verificationResult,
  };
}
