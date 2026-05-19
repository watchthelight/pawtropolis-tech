import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { callBotApi } from "$lib/server/botApi";
import { hasMinTier } from "$lib/server/roles";

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) error(401, "Not authenticated");
  if (!hasMinTier(locals.user.tier, "sa")) error(403, "Insufficient permissions");

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    error(400, "Invalid request body");
  }

  const { issueKey } = body;
  if (!issueKey) error(400, "issueKey is required");

  const result = await callBotApi("/api/audit/unacknowledge", {
    userId: locals.user.id,
    tier: locals.user.tier,
    issueKey,
  });

  if (!result.success) {
    const status = result.error?.includes("not acknowledged") ? 404 : 400;
    return json(result, { status });
  }
  return json(result);
};
