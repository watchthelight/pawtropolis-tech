/**
 * Pawtropolis Tech -- src/web/routes/config.ts
 * WHAT: /api/config/* dashboard route(s).
 * WHY: Extracted from dashboardApi.ts (#00008) into a route module.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { db } from "../../db/db.js";
import { logger } from "../../lib/logger.js";
import { getConfig } from "../../lib/config.js";
import { hasMinTier } from "../dashboardAuth.js";
import type { ApiSuccess, ApiError } from "../dashboardApiTypes.js";
import { notifyDashboard } from "../notifyDashboard.js";
import { CONFIG_FIELD_RULES, validateConfigUpdate, normalizeConfigValue, hasMinTier as hasMinTierValidation } from "../../lib/configValidation.js";
import type { DashboardRouteContext } from "./context.js";

const GUILD_ID = process.env.GUILD_ID!;

export function registerConfigRoutes(server: FastifyInstance, ctx: DashboardRouteContext): void {
  const { cacheModerator } = ctx;

  server.post<{ Body: Record<string, unknown> }>("/api/config/update", async (request, reply) => {
    const { userId, tier, fields } = request.body ?? {};
    if (!userId || !tier || !fields || typeof fields !== "object" || Object.keys(fields as object).length === 0)
      return reply.code(400).send({ success: false, error: "Missing required fields (userId, tier, fields)" } satisfies ApiError);

    // Floor check: admin+ minimum
    if (!hasMinTier(tier as string, "admin"))
      return reply.code(403).send({ success: false, error: "Insufficient permissions (admin+ required)" } satisfies ApiError);

    const fieldEntries = fields as Record<string, unknown>;
    const fieldKeys = Object.keys(fieldEntries);

    // Per-field tier check
    for (const key of fieldKeys) {
      const rule = CONFIG_FIELD_RULES[key];
      if (!rule) {
        return reply.code(400).send({ success: false, error: `Unknown config field: ${key}` } satisfies ApiError);
      }
      if (!hasMinTierValidation(tier as string, rule.minTier)) {
        return reply.code(403).send({
          success: false,
          error: `Insufficient permissions for field '${rule.label}' (requires ${rule.minTier}+)`,
        } satisfies ApiError);
      }
    }

    // Validate all field values
    const validation = validateConfigUpdate(fieldEntries);
    if (!validation.valid) {
      const firstError = Object.values(validation.errors)[0]!;
      return reply.code(400).send({ success: false, error: firstError } satisfies ApiError);
    }

    // Read current values for audit trail
    const currentConfig = getConfig(GUILD_ID) as Record<string, unknown> | undefined;

    // Normalize values before writing
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fieldEntries)) {
      normalized[key] = normalizeConfigValue(key, value);
    }

    // Write to database
    try {
      const { upsertConfig } = await import("../../lib/config.js");
      upsertConfig(GUILD_ID, normalized);
    } catch (err) {
      logger.error({ err, fields: fieldKeys }, "[dashboardApi] Config update failed");
      return reply.code(500).send({ success: false, error: "Failed to update config" } satisfies ApiError);
    }

    // Audit trail
    try {
      const insertAudit = db.prepare(`
        INSERT INTO config_audit_log (guild_id, user_id, field_key, old_value, new_value, source)
        VALUES (?, ?, ?, ?, ?, 'dashboard')
      `);
      const auditTx = db.transaction(() => {
        for (const key of fieldKeys) {
          const oldVal = currentConfig?.[key] ?? null;
          const newVal = normalized[key] ?? null;
          insertAudit.run(GUILD_ID, userId, key, oldVal == null ? null : String(oldVal), newVal == null ? null : String(newVal));
        }
      });
      auditTx();
    } catch (err) {
      // Audit failure is non-fatal — log and continue
      logger.warn({ err }, "[dashboardApi] Config audit log write failed (non-fatal)");
    }

    logger.info(
      { evt: "config_updated_dashboard", userId, fields: fieldKeys },
      `[dashboardApi] Config updated via dashboard: ${fieldKeys.join(", ")}`
    );

    await cacheModerator(userId as string);
    notifyDashboard("config:updated", { fields: fieldKeys, updatedBy: userId });

    return { success: true, data: { updatedFields: fieldKeys } } satisfies ApiSuccess;
  });
}
