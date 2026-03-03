/**
 * Pawtropolis Tech -- src/web/notifyDashboard.ts
 * WHAT: Fire-and-forget SSE push to the web dashboard.
 * WHY: Extracted from dashboardApi.ts so modmail routing can also fire events.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { logger } from "../lib/logger.js";

const DASHBOARD_WEB_URL = process.env.DASHBOARD_WEB_URL || "http://localhost:3000";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";

/** Fire-and-forget SSE event to dashboard. Never blocks the caller. */
export function notifyDashboard(type: string, payload: Record<string, unknown>): void {
  if (!INTERNAL_SECRET) return;
  fetch(`${DASHBOARD_WEB_URL}/api/internal/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Secret": INTERNAL_SECRET },
    body: JSON.stringify({ type, payload, timestamp: Date.now() }),
  }).catch((err) => logger.warn({ err, type }, "[notifyDashboard] SSE notify failed"));
}
