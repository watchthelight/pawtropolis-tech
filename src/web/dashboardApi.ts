/**
 * Pawtropolis Tech -- src/web/dashboardApi.ts
 * WHAT: Fastify server on port 3003 for dashboard mutation requests.
 * WHY: Dashboard UI proxies review actions (claim, approve, reject, kick, unclaim)
 *      through this API. Bot independently verifies tier and executes mutations.
 * AUTH: X-Dashboard-Secret header validated on every request.
 */

import Fastify, { type FastifyInstance } from "fastify";
import type { Client } from "discord.js";
import { db } from "../db/db.js";
import { logger } from "../lib/logger.js";
import { getConfig } from "../lib/config.js";
import { getRoleTiers } from "../features/roleAutomation.js";
import { loadApplication } from "../features/review/queries.js";

// ===== Tier Check =====
// Tier ordering and the hasMinTier comparator live in src/web/dashboardAuth.ts
// so they can be unit-tested without spinning up Fastify. See
// docs/reference/dashboard-api-security.md for the auth model.

import { hasMinTier } from "./dashboardAuth.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { createRouteContext } from "./routes/context.js";
import { registerReviewRoutes } from "./routes/review.js";
import { registerArtRoutes } from "./routes/art.js";
import { registerModmailRoutes } from "./routes/modmail.js";
import { registerQotdRoutes } from "./routes/qotd.js";
import { registerFlagRoutes } from "./routes/flag.js";

// ===== Types =====

import type { ApiSuccess, ApiError, ReviewBody } from "./dashboardApiTypes.js";

// ===== SSE Notifier =====

import { notifyDashboard } from "./notifyDashboard.js";
import { CONFIG_FIELD_RULES, validateConfigUpdate, normalizeConfigValue, hasMinTier as hasMinTierValidation } from "../lib/configValidation.js";

// ===== Server =====

let server: FastifyInstance | null = null;

const DASHBOARD_API_PORT = parseInt(process.env.DASHBOARD_API_PORT ?? "3003", 10);
const DASHBOARD_API_SECRET = process.env.DASHBOARD_API_SECRET;
const GUILD_ID = process.env.GUILD_ID!;

export async function startDashboardApi(client: Client): Promise<void> {
  if (!DASHBOARD_API_SECRET) {
    logger.warn("[dashboardApi] DASHBOARD_API_SECRET not set — dashboard API disabled");
    return;
  }

  server = Fastify({ logger: false });

  // Auth hook — validate X-Dashboard-Secret on every request
  server.addHook("onRequest", async (request, reply) => {
    const secret = request.headers["x-dashboard-secret"];
    if (secret !== DASHBOARD_API_SECRET) {
      return reply.code(401).send({ success: false, error: "Unauthorized" } satisfies ApiError);
    }
  });

  // CSRF defense: validate Origin header on state-changing methods. The
  // secret alone is enough for server-to-server calls (no browser Origin),
  // but a logged-in dashboard user could be tricked into POSTing from a
  // malicious origin that still carries the cookie. Block by allowlist.
  //
  // Allowlist source: DASHBOARD_ALLOWED_ORIGINS (comma-separated env var).
  // Defaults to https://pawtropolis.tech for production safety.
  const allowedOrigins = (process.env.DASHBOARD_ALLOWED_ORIGINS ?? "https://pawtropolis.tech")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  const stateChanging = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  server.addHook("onRequest", async (request, reply) => {
    if (!stateChanging.has(request.method.toUpperCase())) return;
    const origin = request.headers.origin;
    if (origin === undefined) return; // server-to-server (no browser context), secret already authenticated
    if (!allowedOrigins.includes(origin)) {
      logger.warn({ origin, method: request.method, url: request.url }, "[dashboardApi] blocked cross-origin state change");
      return reply.code(403).send({ success: false, error: "Origin not allowed" } satisfies ApiError);
    }
  });

  // Error handler — no stack traces
  server.setErrorHandler(async (error, _request, reply) => {
    logger.error({ err: error }, "[dashboardApi] Unhandled error");
    reply.code(500).send({ success: false, error: "Internal server error" } satisfies ApiError);
  });

  const ctx = createRouteContext(client);
  const { getGuild, cacheModerator } = ctx;

  // ===== Routes =====

  registerReviewRoutes(server, ctx);

  // ===== Modmail / QOTD / Flag routes =====
  registerModmailRoutes(server, ctx);
  registerQotdRoutes(server, ctx);
  registerFlagRoutes(server, ctx);

  registerAuditRoutes(server, client);

  registerArtRoutes(server, ctx);

  // ===== Image Scan Routes =====

  // POST /api/scan/:appId/nsfw — On-demand NSFW scan of avatar + banner via Google Vision
  server.post<{ Params: { appId: string }; Body: ReviewBody }>("/api/scan/:appId/nsfw", async (request, reply) => {
    const { userId, tier } = request.body ?? {};
    const { appId } = request.params;
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const app = loadApplication(appId);
    if (!app) return reply.code(404).send({ success: false, error: "Application not found" } satisfies ApiError);

    try {
      // Fetch fresh user data from Discord (not cache — URLs may be stale)
      const user = await client.users.fetch(app.user_id, { force: true });
      const avatarUrl = user.displayAvatarURL({ extension: "png", forceStatic: true, size: 1024 });
      const bannerUrl = user.bannerURL({ size: 512 }) ?? null;

      // Scan avatar NSFW
      const { scanAvatar, upsertFullScan } = await import("../features/avatarScan.js");
      const avatarResult = await scanAvatar(avatarUrl);

      // Scan banner NSFW (if exists)
      let bannerResult: { finalPct: number; nsfwScore: number | null; reason: string; evidence: { hard: any[]; soft: any[]; safe: any[] } } | null = null;
      if (bannerUrl) {
        const { detectNsfwVision, calculateVisionScore } = await import("../features/googleVision.js");
        const visionResult = await detectNsfwVision(bannerUrl);
        if (visionResult) {
          const score = calculateVisionScore(visionResult);
          let reason = "none";
          if (visionResult.adultScore >= 0.8) reason = "hard_evidence";
          else if (visionResult.adultScore >= 0.5 || visionResult.racyScore >= 0.8) reason = "soft_evidence";
          else if (visionResult.racyScore >= 0.5) reason = "suggestive";
          bannerResult = {
            finalPct: Math.round(score * 100),
            nsfwScore: score,
            reason,
            evidence: {
              hard: visionResult.adultScore >= 0.5 ? [{ tag: `adult:${visionResult.raw.adult}`, p: visionResult.adultScore }] : [],
              soft: visionResult.racyScore >= 0.5 ? [{ tag: `racy:${visionResult.raw.racy}`, p: visionResult.racyScore }] : [],
              safe: [],
            },
          };
        }
      }

      // Upsert all results
      upsertFullScan(appId, {
        avatarUrl,
        nsfwScore: avatarResult.nsfwScore,
        finalPct: avatarResult.finalPct,
        reason: avatarResult.reason,
        evidence: avatarResult.evidence,
        bannerUrl,
        bannerNsfwScore: bannerResult?.nsfwScore ?? null,
        bannerFinalPct: bannerResult?.finalPct ?? 0,
        bannerReason: (bannerResult?.reason as any) ?? null,
        bannerEvidence: bannerResult?.evidence ?? null,
        avatarAiScore: null, // Don't overwrite AI scores
        bannerAiScore: null,
      });

      notifyDashboard("scan:complete", { appId });

      return {
        success: true,
        data: {
          avatarNsfwPct: avatarResult.finalPct,
          bannerNsfwPct: bannerResult?.finalPct ?? 0,
          hasBanner: !!bannerUrl,
        },
      } satisfies ApiSuccess;
    } catch (err) {
      logger.error({ err, appId }, "[dashboardApi] NSFW scan failed");
      return reply.code(500).send({ success: false, error: "NSFW scan failed" } satisfies ApiError);
    }
  });

  // POST /api/scan/:appId/ai — On-demand AI-generated detection of avatar + banner
  server.post<{ Params: { appId: string }; Body: ReviewBody }>("/api/scan/:appId/ai", async (request, reply) => {
    const { userId, tier } = request.body ?? {};
    const { appId } = request.params;
    if (!userId || !tier || !appId) return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" } satisfies ApiError);
    if (!hasMinTier(tier, "gk")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    const app = loadApplication(appId);
    if (!app) return reply.code(404).send({ success: false, error: "Application not found" } satisfies ApiError);

    try {
      const user = await client.users.fetch(app.user_id, { force: true });
      const avatarUrl = user.displayAvatarURL({ extension: "png", forceStatic: true, size: 1024 });
      const bannerUrl = user.bannerURL({ size: 512 }) ?? null;

      const { detectAIForImage } = await import("../features/aiDetection/index.js");

      // Scan avatar AI
      const avatarAi = await detectAIForImage(avatarUrl, "avatar", GUILD_ID);

      // Scan banner AI (if exists)
      let bannerAi: Awaited<ReturnType<typeof detectAIForImage>> | null = null;
      if (bannerUrl) {
        bannerAi = await detectAIForImage(bannerUrl, "banner", GUILD_ID);
      }

      // Store scores
      const { updateAiScores } = await import("../features/avatarScan.js");

      // Ensure avatar_scan row exists (may not if NSFW scan hasn't run yet)
      const existing = db.prepare("SELECT 1 FROM avatar_scan WHERE application_id = ?").get(appId);
      if (!existing) {
        db.prepare("INSERT OR IGNORE INTO avatar_scan (application_id, final_pct, reason) VALUES (?, 0, 'none')").run(appId);
      }

      updateAiScores(appId, avatarAi.averageScore, bannerAi?.averageScore ?? null);

      notifyDashboard("scan:complete", { appId });

      return {
        success: true,
        data: {
          avatarAiPct: avatarAi.averageScore !== null ? Math.round(avatarAi.averageScore * 100) : null,
          bannerAiPct: bannerAi?.averageScore !== null ? Math.round((bannerAi?.averageScore ?? 0) * 100) : null,
          hasBanner: !!bannerUrl,
          avatarServices: avatarAi.services,
          bannerServices: bannerAi?.services ?? [],
        },
      } satisfies ApiSuccess;
    } catch (err) {
      logger.error({ err, appId }, "[dashboardApi] AI scan failed");
      return reply.code(500).send({ success: false, error: "AI scan failed" } satisfies ApiError);
    }
  });

  // ===== Level Role Stats =====

  // In-memory cache for level role stats (avoid fetching all members on every page load)
  let levelRoleStatsCache: { data: Record<string, unknown>; fetchedAt: number } | null = null;
  const LEVEL_ROLE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // POST /api/level-role-stats — level role distribution for the pulse page
  server.post<{ Body: { userId: string; tier: string } }>("/api/level-role-stats", async (request, reply) => {
    const { userId, tier } = request.body ?? {};
    if (!userId || !tier) return reply.code(400).send({ success: false, error: "Missing userId, tier" } satisfies ApiError);
    if (!hasMinTier(tier, "mod")) return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);

    // Return cached data if fresh
    if (levelRoleStatsCache && Date.now() - levelRoleStatsCache.fetchedAt < LEVEL_ROLE_CACHE_TTL_MS) {
      return { success: true, data: levelRoleStatsCache.data } satisfies ApiSuccess;
    }

    const guild = getGuild();
    if (!guild) return reply.code(503).send({ success: false, error: "Guild not available" } satisfies ApiError);

    try {
      const tiers = getRoleTiers(GUILD_ID, "level");
      // Deduplicate by role_id (DB may have multiple entries for the same Discord role)
      const seen = new Set<string>();
      const uniqueTiers = tiers.filter((t) => {
        if (seen.has(t.role_id)) return false;
        seen.add(t.role_id);
        return true;
      });
      if (uniqueTiers.length === 0) {
        return { success: true, data: { roles: [], totalMembers: guild.memberCount } } satisfies ApiSuccess;
      }

      // Fetch all members via gateway for accurate counts
      const members = await guild.members.fetch();
      const totalMembers = members.size;

      const roles = uniqueTiers
        .map((t) => {
          const role = guild.roles.cache.get(t.role_id);
          const count = members.filter((m) => m.roles.cache.has(t.role_id)).size;
          return {
            tierName: t.tier_name,
            roleId: t.role_id,
            roleName: role?.name ?? t.tier_name,
            color: role?.hexColor && role.hexColor !== "#000000" ? role.hexColor : null,
            threshold: t.threshold,
            count,
          };
        })
        .sort((a, b) => b.threshold - a.threshold); // highest level first

      const data = { roles, totalMembers };
      levelRoleStatsCache = { data, fetchedAt: Date.now() };
      return { success: true, data } satisfies ApiSuccess;
    } catch (err) {
      logger.warn({ err }, "[dashboardApi] Failed to fetch level role stats");
      return reply.code(500).send({ success: false, error: "Failed to fetch level role stats" } satisfies ApiError);
    }
  });

  // ===== Config Update =====

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
      const firstError = Object.values(validation.errors)[0];
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
      const { upsertConfig } = await import("../lib/config.js");
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

  // ===== System Health =====

  server.post("/api/dashboard/health", async (request, reply) => {
    const body = request.body as { userId?: string; tier?: string } | null;
    if (!body?.userId || !body?.tier) {
      return reply.code(400).send({ success: false, error: "Missing userId or tier" } satisfies ApiError);
    }
    if (!hasMinTier(body.tier, "owner")) {
      return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);
    }

    try {
      const { getSummary } = await import("../features/opsHealth.js");
      const summary = await getSummary(GUILD_ID);

      // Process memory. heapTotal grows lazily so heapUsed/heapTotal hovers
      // near 100% even when there's gigabytes of headroom — report against the
      // V8 heap_size_limit instead so the % is actually meaningful.
      const mem = process.memoryUsage();
      const v8 = await import("node:v8");
      const heapStats = v8.getHeapStatistics();
      const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
      const heapLimitMB = Math.round(heapStats.heap_size_limit / 1024 / 1024);
      const rssMB = Math.round(mem.rss / 1024 / 1024);

      // Disk space (Linux)
      let disk = { usedGB: 0, totalGB: 0, percentUsed: 0 };
      try {
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);
        const { stdout: dfOutput } = await execFileAsync("df", ["-B1", "/"], { timeout: 3000 });
        const lines = dfOutput.trim().split("\n");
        if (lines.length >= 2) {
          const parts = lines[1].split(/\s+/);
          const totalBytes = parseInt(parts[1], 10);
          const usedBytes = parseInt(parts[2], 10);
          disk = {
            totalGB: Math.round(totalBytes / 1024 / 1024 / 1024 * 10) / 10,
            usedGB: Math.round(usedBytes / 1024 / 1024 / 1024 * 10) / 10,
            percentUsed: Math.round((usedBytes / totalBytes) * 100),
          };
        }
      } catch {
        // Disk info unavailable (Windows dev, non-Linux, etc.)
      }

      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const uptimeFormatted = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

      // Host metrics — gives the dashboard a real ops view, not just a bot view.
      const os = await import("node:os");
      const loadavg = os.loadavg();
      const totalMemBytes = os.totalmem();
      const freeMemBytes = os.freemem();
      const cpuCount = os.cpus().length;
      const hostUptimeS = os.uptime();

      // Cost: EC2 instance + EBS gp3. Tweak via env so resize doesn't need a
      // code edit. Defaults reflect t3.large + 64GB gp3 in us-east-1.
      const HOURLY_USD = parseFloat(process.env.EC2_HOURLY_USD ?? "0.0832");
      const STORAGE_USD_PER_MO = parseFloat(process.env.EC2_STORAGE_USD_PER_MO ?? "5.12");
      const monthlyUsd = HOURLY_USD * 24 * 30.4 + STORAGE_USD_PER_MO;
      const instanceType = process.env.EC2_INSTANCE_TYPE ?? "t3.large";
      const storageGB = parseInt(process.env.EC2_STORAGE_GB ?? "64", 10);

      return {
        success: true,
        data: {
          uptime: Math.round(uptime),
          uptimeFormatted,
          wsPingMs: summary.wsPingMs,
          memory: { heapUsedMB, heapTotalMB, heapLimitMB, rssMB },
          disk,
          activeAlertCount: summary.activeAlerts.length,
          pm2: summary.pm2,
          dbIntegrity: summary.db,
          host: {
            loadavg,
            cpuCount,
            totalMemMB: Math.round(totalMemBytes / 1024 / 1024),
            freeMemMB: Math.round(freeMemBytes / 1024 / 1024),
            usedMemPct: Math.round(((totalMemBytes - freeMemBytes) / totalMemBytes) * 100),
            uptimeS: Math.round(hostUptimeS),
          },
          cost: {
            hourlyUsd: HOURLY_USD,
            dailyUsd: +(HOURLY_USD * 24).toFixed(2),
            monthlyUsd: +monthlyUsd.toFixed(2),
            note: `EC2 ${instanceType} us-east-1 + ${storageGB}GB gp3 (storage flat rate)`,
          },
        },
      } satisfies ApiSuccess;
    } catch (err) {
      logger.warn({ err }, "[dashboardApi] Failed to fetch health summary");
      return reply.code(500).send({ success: false, error: "Failed to fetch health data" } satisfies ApiError);
    }
  });

  // Start server
  await server.listen({ port: DASHBOARD_API_PORT, host: "0.0.0.0" });
  logger.info({ port: DASHBOARD_API_PORT }, "[dashboardApi] Dashboard API started");
}

export async function stopDashboardApi(): Promise<void> {
  if (server) {
    await server.close();
    server = null;
    logger.info("[dashboardApi] Dashboard API stopped");
  }
}

export function getDashboardApiPort(): number {
  return DASHBOARD_API_PORT;
}
