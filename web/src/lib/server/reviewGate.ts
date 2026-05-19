/**
 * Pure permission gate for review-action API endpoints.
 *
 * Rule (from web/src/lib/server/roles.ts: comment on isGatekeeper):
 *   Review actions (claim/approve/reject/kick/wrong_password/stale_modmail/vote_out)
 *   require the actual GATEKEEPER role. Higher tier (Junior Mod, Mod, ...) without
 *   the role can VIEW review pages but must not ACT on them.
 *   permreject requires admin tier.
 *   unclaim requires GK role OR admin tier (admin override).
 *   owner tier (bot owner / server dev) bypasses everything.
 */

import { ROLE_IDS, type DashboardTier, hasMinTier, isGatekeeper } from "./roles";

export type ReviewAction =
  | "claim"
  | "unclaim"
  | "approve"
  | "reject"
  | "wrong_password"
  | "stale_modmail"
  | "kick"
  | "permreject"
  | "vote_out";

export function canPerformReviewAction(
  tier: DashboardTier,
  roles: string[],
  action: ReviewAction
): boolean {
  if (tier === "owner") return true;

  if (action === "permreject") {
    return hasMinTier(tier, "admin");
  }

  if (action === "unclaim") {
    return isGatekeeper(roles) || hasMinTier(tier, "admin");
  }

  return isGatekeeper(roles);
}

export const ROLE_GATEKEEPER = ROLE_IDS.GATEKEEPER;
