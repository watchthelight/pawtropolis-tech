import { json, error, type RequestHandler } from "@sveltejs/kit";
import { upsertSubscription } from "$lib/server/push/push-db";

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) {
    error(401, "Not authenticated");
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    error(400, "Invalid request body");
  }

  const sub = body.subscription as
    | { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    | undefined;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    error(400, "Invalid push subscription: endpoint, keys.p256dh, and keys.auth required");
  }

  if (!sub.endpoint.startsWith("https://")) {
    error(400, "Push endpoint must be HTTPS");
  }

  const prefs = body.preferences as
    | { review?: boolean; modmail?: boolean; flag?: boolean; audit?: boolean }
    | undefined;

  upsertSubscription(
    locals.user.id,
    locals.user.tier,
    sub.endpoint,
    sub.keys.p256dh,
    sub.keys.auth,
    prefs
  );

  return json({ success: true });
};
