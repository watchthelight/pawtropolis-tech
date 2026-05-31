/**
 * Webhook receiver for bot → dashboard event notifications.
 *
 * The bot POSTs events here after successful DB writes.
 * Events are published to the in-memory bus, which fans out to SSE clients.
 *
 * Authentication: X-Internal-Secret header must match INTERNAL_SECRET env var.
 */

import crypto from "node:crypto";
import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { eventBus } from "$lib/server/events/bus";
import { invalidatePrefix } from "$lib/server/cache";
import type { SSEEvent } from "$lib/types/events";

const MAX_PAYLOAD_BYTES = 64 * 1024; // 64 KB max webhook payload

/** Cached secret — read once from env on first use */
let cachedSecret: string | undefined;
function getInternalSecret(): string {
  if (!cachedSecret) {
    const secret = process.env.INTERNAL_SECRET;
    if (!secret) throw new Error("INTERNAL_SECRET environment variable is required");
    cachedSecret = secret;
  }
  return cachedSecret;
}

/**
 * Timing-safe secret comparison via HMAC.
 * Both values are HMAC'd with a fixed key so output length is always equal,
 * eliminating the length-leak that a raw timingSafeEqual guard would introduce.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const key = "sse-internal-auth";
  const a = crypto.createHmac("sha256", key).update(provided).digest();
  const b = crypto.createHmac("sha256", key).update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export const POST: RequestHandler = async ({ request }) => {
  // Reject oversized payloads before reading body
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_PAYLOAD_BYTES) {
    return json({ success: false, error: "Bad request" }, { status: 413 });
  }

  // Validate internal secret
  const providedSecret = request.headers.get("x-internal-secret");
  if (!providedSecret || !secretsMatch(providedSecret, getInternalSecret())) {
    return json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: "Bad request" }, { status: 400 });
  }

  // Validate event shape
  const event = body as SSEEvent;
  if (
    !event ||
    typeof event.type !== "string" ||
    !event.type.includes(":") ||
    typeof event.timestamp !== "number" ||
    !Number.isFinite(event.timestamp) ||
    !("payload" in event)
  ) {
    return json({ success: false, error: "Bad request" }, { status: 400 });
  }

  // Publish to bus — fan-out handles distribution to SSE clients
  eventBus.publish(event);

  // Bust the server-side TTL cache for pages whose counters this mutation
  // moves, so the SSE-triggered reload reads fresh data instead of the stale
  // pre-mutation L1 object. Keys embed the guild id; the small L1 map makes a
  // coarse prefix drop cheap.
  const guildId = process.env.GUILD_ID;
  if (guildId) {
    if (
      event.type.startsWith("review:") ||
      event.type.startsWith("modmail:") ||
      event.type.startsWith("flag:")
    ) {
      invalidatePrefix(`pulse:guild:${guildId}`);
      invalidatePrefix(`pulse:snapshot:${guildId}`);
      invalidatePrefix("stats:");
    } else if (event.type.startsWith("stats:")) {
      invalidatePrefix("stats:");
    }
  }

  return json({ success: true });
};
