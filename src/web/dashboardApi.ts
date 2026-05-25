/**
 * Pawtropolis Tech -- src/web/dashboardApi.ts
 * WHAT: Fastify server on port 3003 for dashboard mutation requests.
 * WHY: Dashboard UI proxies review actions (claim, approve, reject, kick, unclaim)
 *      through this API. Bot independently verifies tier and executes mutations.
 * AUTH: X-Dashboard-Secret header validated on every request.
 */

import Fastify, { type FastifyInstance } from "fastify";
import type { Client } from "discord.js";
import { logger } from "../lib/logger.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { createRouteContext } from "./routes/context.js";
import { registerReviewRoutes } from "./routes/review.js";
import { registerArtRoutes } from "./routes/art.js";
import { registerScanRoutes } from "./routes/scan.js";
import { registerLevelStatsRoutes } from "./routes/levelStats.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerModmailRoutes } from "./routes/modmail.js";
import { registerQotdRoutes } from "./routes/qotd.js";
import { registerFlagRoutes } from "./routes/flag.js";

// ===== Types =====

import type { ApiError } from "./dashboardApiTypes.js";

// ===== Server =====

let server: FastifyInstance | null = null;

const DASHBOARD_API_PORT = parseInt(process.env.DASHBOARD_API_PORT ?? "3003", 10);
const DASHBOARD_API_SECRET = process.env.DASHBOARD_API_SECRET;

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

  // ===== Routes =====

  registerReviewRoutes(server, ctx);

  // ===== Modmail / QOTD / Flag routes =====
  registerModmailRoutes(server, ctx);
  registerQotdRoutes(server, ctx);
  registerFlagRoutes(server, ctx);

  registerAuditRoutes(server, client);

  registerArtRoutes(server, ctx);

  // ===== Scan / stats / config / health routes =====
  registerScanRoutes(server, ctx);
  registerLevelStatsRoutes(server, ctx);
  registerConfigRoutes(server, ctx);
  registerHealthRoutes(server, ctx);

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
