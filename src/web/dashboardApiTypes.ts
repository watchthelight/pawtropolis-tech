/**
 * Pawtropolis Tech -- src/web/dashboardApiTypes.ts
 * WHAT: Shared response/body types for the dashboard mutation API + its route
 *       modules. Extracted from dashboardApi.ts (#00008) so route groups in
 *       src/web/routes/ can share them without importing the server module.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

export type ApiSuccess = { success: true; data: Record<string, unknown> };
export type ApiError = { success: false; error: string };
export type ReviewBody = {
  userId: string;
  tier: string;
  appId: string;
  reason?: string;
};
