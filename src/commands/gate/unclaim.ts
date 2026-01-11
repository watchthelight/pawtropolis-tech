/**
 * Pawtropolis Tech -- src/commands/gate/unclaim.ts
 * WHAT: /unclaim command for releasing application claims.
 * WHY: Allows moderators to release claims on applications.
 *      Administrators+ can unclaim any application to resolve stalemates.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  requireGatekeeper,
  findAppByShortCode,
  findPendingAppByUserId,
  ensureReviewMessage,
  getClaim,
  clearClaim,
  CLAIMED_MESSAGE,
  type CommandContext,
  ensureDeferred,
  replyOrEdit,
  withStep,
  withSql,
  logger,
  type ApplicationRow,
  hasRoleOrAbove,
  ROLE_IDS,
  shouldBypass,
  type GuildMember,
} from "./shared.js";

/*
 * Three ways to specify the target: short code, @mention, or raw user ID.
 * All optional, but exactly one must be provided. We do the validation
 * ourselves in execute because Discord's slash command system doesn't
 * support "one of these three is required" constraints natively.
 */
export const unclaimData = new SlashCommandBuilder()
  .setName("unclaim")
  .setDescription("Release a claim on an application")
  .addStringOption((option) =>
    option.setName("app").setDescription("Application short code (e.g., A1B2C3)").setRequired(false)
  )
  .addUserOption((option) =>
    option.setName("user").setDescription("User whose app to unclaim (@mention or select)").setRequired(false)
  )
  .addStringOption((option) =>
    option.setName("uid").setDescription("Discord User ID (if user not in server)").setRequired(false)
  )
  .setDMPermission(false);

export async function executeUnclaim(ctx: CommandContext<ChatInputCommandInteraction>) {
  /**
   * executeUnclaim
   * WHAT: Releases a claim on an application.
   * WHO: The claimer can release their own claim. Administrators+ can unclaim anyone's.
   * WHY: Prevents stalemates; enforced via claimGuard.
   */
  const { interaction } = ctx;
  if (!interaction.guildId || !interaction.guild) {
    await replyOrEdit(interaction, { content: "Guild only." });
    return;
  }
  if (!requireGatekeeper(
    interaction,
    "unclaim",
    "Releases a claim on an application so others can review it."
  )) return;

  // Defer early. Even though this command is fast, we might hit Discord API
  // latency on the review card refresh, and the 3-second SLA is unforgiving.
  await withStep(ctx, "defer", async () => {
    await ensureDeferred(interaction);
  });

  const codeRaw = interaction.options.getString("app", false);
  const userOption = interaction.options.getUser("user", false);
  const uidRaw = interaction.options.getString("uid", false);

  // Count how many identifier options were provided
  // GOTCHA: filter(Boolean) counts truthy values, so empty strings would be excluded.
  // Thankfully Discord returns null for unset options, not empty strings.
  const providedCount = [codeRaw, userOption, uidRaw].filter(Boolean).length;
  if (providedCount === 0) {
    await replyOrEdit(interaction, {
      content: "Please provide one of: `app` (short code), `user` (@mention), or `uid` (user ID).",
    });
    return;
  }
  if (providedCount > 1) {
    await replyOrEdit(interaction, {
      content: "Please provide only one option: `app`, `user`, or `uid`.",
    });
    return;
  }

  const lookupResult = await withStep(ctx, "lookup_app", async () => {
    // Yes, this could be a switch or early-return chain. The if-else ladder
    // is ugly but explicit, and matches the other gate commands. Consistency > elegance.
    let app: ApplicationRow | null = null;
    if (codeRaw) {
      const code = codeRaw.trim().toUpperCase();
      app = withSql(ctx, "SELECT application by short_code", () =>
        findAppByShortCode(interaction.guildId!, code)
      );
      if (!app) {
        return { found: false as const, error: `No application with code ${code}.` };
      }
    } else if (userOption) {
      app = withSql(ctx, "SELECT application by user_id", () =>
        findPendingAppByUserId(interaction.guildId!, userOption.id)
      );
      if (!app) {
        return { found: false as const, error: `No pending application found for ${userOption}.` };
      }
    } else if (uidRaw) {
      const uid = uidRaw.trim();
      // Discord snowflakes are 18-19 digits currently, but the spec allows for growth.
      // 5 is a floor to catch obvious typos; 20 gives us headroom until 2090 or so.
      if (!/^[0-9]{5,20}$/.test(uid)) {
        return { found: false as const, error: "Invalid user ID. Must be 5-20 digits." };
      }
      app = withSql(ctx, "SELECT application by user_id", () =>
        findPendingAppByUserId(interaction.guildId!, uid)
      );
      if (!app) {
        return { found: false as const, error: `No pending application found for user ID ${uid}.` };
      }
    }
    // Defensive check. If we get here with null, the if-else above has a hole.
    // TypeScript can't prove exhaustiveness here because of the early returns.
    if (!app) {
      return { found: false as const, error: "Could not find application." };
    }
    return { found: true as const, app };
  });

  if (!lookupResult.found) {
    await replyOrEdit(interaction, { content: lookupResult.error });
    return;
  }
  const app = lookupResult.app;

  const claimResult = await withStep(ctx, "claim_fetch", async () => {
    const claim = withSql(ctx, "SELECT review_claim", () => getClaim(app.id));
    if (!claim) {
      return { hasClaim: false as const };
    }

    // claim ≠ forever. use /unclaim like an adult
    // The claimer can always release their own claim.
    // Administrators+ can unclaim anyone's application to resolve stalemates
    // without needing direct DB access.
    const isOwnClaim = claim.reviewer_id === interaction.user.id;
    const member = interaction.member as GuildMember | null;
    const isAdminPlus = shouldBypass(interaction.user.id, member) ||
      hasRoleOrAbove(member, ROLE_IDS.ADMINISTRATOR);

    return { hasClaim: true as const, claim, canUnclaim: isOwnClaim || isAdminPlus };
  });

  if (!claimResult.hasClaim) {
    await replyOrEdit(interaction, { content: "This application is not currently claimed." });
    return;
  }

  if (!claimResult.canUnclaim) {
    await replyOrEdit(interaction, { content: CLAIMED_MESSAGE(claimResult.claim.reviewer_id) });
    return;
  }

  await withStep(ctx, "clear_claim", async () => {
    withSql(ctx, "DELETE review_claim", () => clearClaim(app.id));
  });

  await withStep(ctx, "refresh_review", async () => {
    // Refresh the review card so other mods see it's available again.
    // If Discord's having a bad day, we still report success -- the claim
    // is cleared, and the card will catch up eventually.
    try {
      await ensureReviewMessage(interaction.client, app.id);
    } catch (err) {
      logger.warn({ err, appId: app.id }, "Failed to refresh review card after /unclaim");
    }
  });

  await withStep(ctx, "reply", async () => {
    await replyOrEdit(interaction, { content: "Claim removed." });
  });
}
