/**
 * Pawtropolis Tech -- src/web/routes/health.ts
 * WHAT: /api/dashboard/health dashboard route(s).
 * WHY: Extracted from dashboardApi.ts (#00008) into a route module.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { FastifyInstance } from "fastify";
import { logger } from "../../lib/logger.js";
import { hasMinTier } from "../dashboardAuth.js";
import type { ApiSuccess, ApiError } from "../dashboardApiTypes.js";
import type { DashboardRouteContext } from "./context.js";

const GUILD_ID = process.env.GUILD_ID!;

export function registerHealthRoutes(server: FastifyInstance, _ctx: DashboardRouteContext): void {
  server.post("/api/dashboard/health", async (request, reply) => {
    const body = request.body as { userId?: string; tier?: string } | null;
    if (!body?.userId || !body?.tier) {
      return reply.code(400).send({ success: false, error: "Missing userId or tier" } satisfies ApiError);
    }
    if (!hasMinTier(body.tier, "owner")) {
      return reply.code(403).send({ success: false, error: "Insufficient permissions" } satisfies ApiError);
    }

    try {
      const { getSummary } = await import("../../features/opsHealth.js");
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
}
