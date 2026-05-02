// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/startup/web.ts
 * WHAT: Boots and stops the bot's two HTTP services.
 * WHY: src/index.ts had two web-server boot blocks during ClientReady
 *      and one teardown call inside gracefulShutdown. Extracted so the
 *      pair stays auditable in one file.
 *
 * Services:
 *   - Status endpoint (Shields.io badge JSON)
 *   - Dashboard API (Fastify, port 3003 by default)
 */

import type { Client } from "discord.js";
import { logger } from "../lib/logger.js";
import { runStartupTask } from "./runStartupTask.js";

/**
 * startWebServers: boot both HTTP services. Both are optional, so each
 * uses the warn-level wrapper. Logs port info on success to keep the
 * existing operator-friendly startup output.
 */
export async function startWebServers(client: Client): Promise<void> {
  await runStartupTask(
    "web_status_endpoint",
    async () => {
      const { startStatusServer, getStatusPort } = await import(
        "../web/statusEndpoint.js"
      );
      startStatusServer(client);
      logger.info(
        { port: getStatusPort() },
        "[startup] Status endpoint started",
      );
    },
    { level: "warn" },
  );

  await runStartupTask(
    "web_dashboard_api",
    async () => {
      const { startDashboardApi, getDashboardApiPort } = await import(
        "../web/dashboardApi.js"
      );
      await startDashboardApi(client);
      logger.info(
        { port: getDashboardApiPort() },
        "[startup] Dashboard API started",
      );
    },
    { level: "warn" },
  );

  await runStartupTask(
    "web_badge_endpoint",
    async () => {
      const { startBadgeServer, getBadgePort } = await import(
        "../web/badgeEndpoint.js"
      );
      const srv = startBadgeServer();
      if (srv) {
        logger.info(
          { port: getBadgePort() },
          "[startup] Badge endpoint started",
        );
      }
    },
    { level: "warn" },
  );
}

/**
 * stopWebServers: shut down the dashboard API. The status endpoint is a
 * minimal Node http server that closes when the process exits, so it
 * does not need an explicit stop. Errors propagate up so the outer
 * gracefulShutdown can log them.
 */
export async function stopWebServers(): Promise<void> {
  const { stopDashboardApi } = await import("../web/dashboardApi.js");
  await stopDashboardApi();
  const { stopBadgeServer } = await import("../web/badgeEndpoint.js");
  await stopBadgeServer();
}
