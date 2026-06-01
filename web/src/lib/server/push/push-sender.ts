/**
 * Push notification sender — subscribes to eventBus alongside fan-out.ts.
 *
 * When pushable events arrive, sends Web Push notifications to qualifying
 * subscriptions based on tier + per-user preference filters.
 *
 * Import this module for its side-effect (eventBus.subscribe).
 */

// @ts-expect-error — web-push has no type declarations
import webpush from "web-push";
import { eventBus } from "$lib/server/events/bus";
import { getMinTierForEvent } from "$lib/types/events";
import { hasMinTier } from "$lib/server/roles";
import type { DashboardTier } from "$lib/server/roles";
import type { SSEEvent, RoleChangedPayload } from "$lib/types/events";
import {
  getSubscriptionsForDomain,
  removeSubscription,
  removeAllSubscriptions,
  updateLastUsed,
  updateTier,
  deleteStaleSubscriptions,
  STALE_TIER_TTL_SECONDS,
} from "./push-db";
import { getVapidPublicKey, getVapidPrivateKey, getVapidSubject } from "./vapid";

// ---------------------------------------------------------------------------
// VAPID setup (lazy — only runs when first push is sent)
// ---------------------------------------------------------------------------

let vapidConfigured = false;

function ensureVapid(): boolean {
  if (vapidConfigured) return true;
  try {
    webpush.setVapidDetails(getVapidSubject(), getVapidPublicKey(), getVapidPrivateKey());
    vapidConfigured = true;
    return true;
  } catch (err) {
    console.warn(
      "[Push] VAPID not configured — push notifications disabled:",
      (err as Error).message
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pushable event configuration
// ---------------------------------------------------------------------------

interface PushEventConfig {
  domain: string;
  title: (payload: Record<string, unknown>) => string;
  body: (payload: Record<string, unknown>) => string;
  url: (payload: Record<string, unknown>) => string;
  actions?: Array<{ action: string; title: string }>;
}

const PUSH_EVENTS: Record<string, PushEventConfig> = {
  "review:submitted": {
    domain: "review",
    title: () => "New Application",
    body: (p) => `${p.applicantName || "Someone"} submitted an application`,
    url: (p) => `/dashboard/reviews/${p.appId}`,
    actions: [{ action: "claim", title: "Claim" }],
  },
  "modmail:thread_opened": {
    domain: "modmail",
    title: () => "New Modmail Thread",
    body: () => "A new modmail thread was opened",
    url: () => "/dashboard/reviews",
  },
  "audit:scan_completed": {
    domain: "audit",
    title: () => "Audit Scan Complete",
    body: (p) => `${p.auditType} scan: ${p.flaggedCount} flagged of ${p.scannedCount}`,
    url: () => "/dashboard/audit/scans",
  },
};

// ---------------------------------------------------------------------------
// Push broadcast
// ---------------------------------------------------------------------------

// Lowest tier any pushable event is gated to. Per EVENT_TIER_VISIBILITY the
// least privileged pushable domains are review: and modmail:, both gated at
// "gk" (gatekeeper), so gk is the floor. A subscriber resolving below this can
// never receive a tier-restricted payload, so on demotion past it we drop the
// rows outright rather than keep a cache that will only ever be rejected.
// NOTE: if a pushable event gated below gk is added to PUSH_EVENTS, lower this.
const LOWEST_PUSHABLE_TIER: DashboardTier = "gk";

export function pushBroadcast(event: SSEEvent): void {
  // role:changed is the authoritative tier-refresh signal. Re-stamp the cached
  // tier (and its freshness) so the send-time guard trusts it again. If the
  // user dropped below every pushable threshold, proactively delete their
  // subscriptions so a demoted or departed member stops receiving payloads
  // immediately rather than waiting for the next send-time prune.
  if (event.type === "role:changed") {
    const payload = event.payload as RoleChangedPayload;
    if (payload?.userId && payload.newTier) {
      try {
        if (hasMinTier(payload.newTier, LOWEST_PUSHABLE_TIER)) {
          updateTier(payload.userId, payload.newTier);
        } else {
          removeAllSubscriptions(payload.userId);
        }
      } catch {
        /* non-critical */
      }
    }
    return;
  }

  const config = PUSH_EVENTS[event.type];
  if (!config) return;
  if (!ensureVapid()) return;

  const minTier = getMinTierForEvent(event.type);
  const payload = event.payload as Record<string, unknown>;

  // Build notification payload once
  const notification = JSON.stringify({
    title: config.title(payload),
    body: config.body(payload),
    data: {
      url: config.url(payload),
      appId: payload.appId,
    },
    actions: config.actions,
  });

  // Get subscriptions with this domain enabled
  const subscriptions = getSubscriptionsForDomain(config.domain);

  const nowSeconds = Math.floor(Date.now() / 1000);

  for (const sub of subscriptions) {
    // The stored tier is a cache. The web process cannot re-resolve a user's
    // current tier at send time (no OAuth token here), so a tier that has not
    // been refreshed within the TTL is not trusted: skip it and prune the row.
    // Re-subscription (or a login / session refresh) re-resolves tier from the
    // authoritative Discord source and re-stamps freshness.
    if (nowSeconds - sub.tier_updated_at > STALE_TIER_TTL_SECONDS) {
      console.log(`[Push] Pruning stale-tier subscription: ${sub.endpoint.slice(0, 60)}...`);
      try {
        removeSubscription(sub.endpoint);
      } catch {
        /* non-critical */
      }
      continue;
    }

    // Tier check against the (fresh) cached tier.
    if (!hasMinTier(sub.tier as DashboardTier, minTier)) continue;

    const pushSub = {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
    };

    webpush.sendNotification(pushSub, notification).then(
      () => {
        try {
          updateLastUsed(sub.endpoint);
        } catch {
          /* non-critical */
        }
      },
      (err: Error & { statusCode?: number }) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired or unsubscribed
          console.log(`[Push] Removing stale subscription: ${sub.endpoint.slice(0, 60)}...`);
          try {
            removeSubscription(sub.endpoint);
          } catch {
            /* non-critical */
          }
        } else {
          console.warn(`[Push] Send failed (${err.statusCode || "unknown"}):`, err.message);
        }
      }
    );
  }
}

// ---------------------------------------------------------------------------
// Subscribe to event bus (side-effect on import)
// ---------------------------------------------------------------------------

eventBus.subscribe(pushBroadcast);

// Periodic stale subscription cleanup (every 24h)
setInterval(
  () => {
    try {
      const deleted = deleteStaleSubscriptions();
      if (deleted > 0) console.log(`[Push] Cleaned up ${deleted} stale subscriptions`);
    } catch {
      /* non-critical */
    }
  },
  24 * 60 * 60 * 1000
);

console.log("[Push] Push notification sender initialized");
