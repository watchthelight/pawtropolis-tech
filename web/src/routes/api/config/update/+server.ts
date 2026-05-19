import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { callBotApi } from "$lib/server/botApi";
import { hasMinTier } from "$lib/server/roles";
import { CONFIG_FIELD_RULES, validateConfigUpdate } from "$lib/shared/configValidation";

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) error(401, "Not authenticated");
  if (!hasMinTier(locals.user.tier, "admin")) error(403, "Insufficient permissions");

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    error(400, "Invalid request body");
  }

  const fields = body.fields as Record<string, unknown> | undefined;
  if (!fields || typeof fields !== "object" || Object.keys(fields).length === 0) {
    error(400, "fields object is required and must be non-empty");
  }

  // Per-field tier check
  for (const key of Object.keys(fields)) {
    const rule = CONFIG_FIELD_RULES[key];
    if (!rule) error(400, `Unknown config field: ${key}`);
    if (!hasMinTier(locals.user.tier, rule.minTier)) {
      error(403, `Insufficient permissions for field '${rule.label}'`);
    }
  }

  // Validate values
  const validation = validateConfigUpdate(fields);
  if (!validation.valid) {
    const firstError = Object.values(validation.errors)[0];
    error(400, firstError);
  }

  const result = await callBotApi("/api/config/update", {
    userId: locals.user.id,
    tier: locals.user.tier,
    fields,
  });

  if (!result.success) {
    const errMsg = result.error.toLowerCase();
    let status = 400;
    if (errMsg.includes("permission") || errMsg.includes("insufficient")) status = 403;
    else if (errMsg.includes("unreachable") || errMsg.includes("timed out")) status = 502;
    return json(result, { status });
  }

  return json(result);
};
