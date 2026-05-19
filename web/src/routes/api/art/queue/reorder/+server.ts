import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { callBotApi } from "$lib/server/botApi";
import { hasMinTier } from "$lib/server/roles";

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) error(401, "Not authenticated");
  if (!hasMinTier(locals.user.tier, "sm")) error(403, "Insufficient permissions");

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    error(400, "Invalid request body");
  }

  const { targetUserId, newPosition } = body;
  if (!targetUserId || newPosition === undefined) error(400, "Missing required fields");

  const result = await callBotApi("/api/art/queue/reorder", {
    userId: locals.user.id,
    tier: locals.user.tier,
    targetUserId,
    newPosition,
  });

  if (!result.success) {
    return json(result, { status: result.error?.includes("not") ? 404 : 400 });
  }
  return json(result);
};
