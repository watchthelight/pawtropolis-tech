// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/startup/schema.ts
 * WHAT: All schema-self-heal calls that run once at ClientReady.
 * WHY: These calls are idempotent column-add helpers that bring legacy
 *      databases up to current expectations. They previously lived
 *      inline in src/index.ts (~50 lines). Extracted to make the
 *      list auditable and testable.
 *
 * Order matters here. The list mirrors the pre-extraction order in
 * src/index.ts to keep startup behavior identical. New ensure*
 * functions should be appended (not interleaved) to make blame easy.
 */

import { runStartupTask } from "./runStartupTask.js";

/**
 * runSchemaSelfHeal
 * Runs every ensure* function exposed by db/ensure.ts, statusStore, and
 * lib/config. Returns true if every step ran without throwing; returns
 * false if any threw (errors are logged inside the task wrapper).
 */
export async function runSchemaSelfHeal(): Promise<boolean> {
  return runStartupTask("schema_self_heal", async () => {
    const {
      ensureAvatarScanSchema,
      ensureApplicationPermaRejectColumn,
      ensureOpenModmailTable,
      ensureReviewActionFreeText,
      ensureApplicationStatusIndex,
      ensureActionLogSchema,
      ensureActionLogFreeText,
      ensureManualFlagColumns,
      ensureSearchIndexes,
      ensurePanicModeColumn,
      ensureApplicationStaleAlertColumns,
      ensureArtistRotationConfigColumns,
      ensureTestIdeaTable,
    } = await import("../db/ensure.js");
    const { ensureBotStatusSchema } = await import("../features/statusStore.js");
    const {
      ensureUnverifiedChannelColumn,
      ensureWelcomeTemplateColumn,
      ensureWelcomeChannelsColumns,
      ensureModRolesColumns,
      ensureDadModeColumns,
      ensureSkullModeColumns,
      ensureListopenPublicOutputColumn,
    } = await import("../lib/config.js");

    ensureAvatarScanSchema();
    ensureApplicationPermaRejectColumn();
    ensureOpenModmailTable();
    ensureReviewActionFreeText();
    ensureApplicationStatusIndex();
    ensureActionLogSchema();
    ensureActionLogFreeText();
    ensureManualFlagColumns();
    ensureSearchIndexes();
    ensurePanicModeColumn();
    ensureApplicationStaleAlertColumns();
    ensureArtistRotationConfigColumns();
    ensureTestIdeaTable();
    ensureBotStatusSchema();

    // Config column migrations (moved from getConfig/upsertConfig for performance)
    ensureUnverifiedChannelColumn();
    ensureWelcomeTemplateColumn();
    ensureWelcomeChannelsColumns();
    ensureModRolesColumns();
    ensureDadModeColumns();
    ensureSkullModeColumns();
    ensureListopenPublicOutputColumn();
  });
}
