/**
 * Maps an incoming SSE event type to the server-side cache prefixes its
 * mutation invalidates. Kept pure (no env, no cache access) so the routing
 * table is unit-testable; the webhook handler resolves GUILD_ID and drives
 * invalidatePrefix() with the result.
 */

export function cachePrefixesForEvent(eventType: string, guildId: string): string[] {
  if (
    eventType.startsWith("review:") ||
    eventType.startsWith("modmail:") ||
    eventType.startsWith("flag:")
  ) {
    return [
      `pulse:guild:${guildId}`,
      `pulse:snapshot:${guildId}`,
      "stats:",
      "reviews:queue",
    ];
  }
  if (eventType.startsWith("stats:")) {
    return ["stats:"];
  }
  return [];
}
