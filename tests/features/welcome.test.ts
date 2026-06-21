/**
 * Pawtropolis Tech — tests/features/welcome.test.ts
 * WHAT: Tests for the welcome delivery split: rich embed -> DM, one-sentence
 *       non-embed line -> general channel (with the welcome ping).
 * WHY: Locks in the requested behavior (embed in DMs, short pinged shout-out in
 *      main chat) so a future refactor can't silently move the embed back into
 *      the channel.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { postWelcomeCard } from "../../src/features/welcome.js";

function makeGuild(channel: any) {
  return {
    id: "guild-1",
    name: "Pawtropolis",
    iconURL: () => "https://cdn/icon.png",
    members: { me: {} },
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
  } as any;
}

function makeChannel() {
  return {
    id: "chan-1",
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    send: vi.fn().mockResolvedValue({ id: "channel-msg" }),
  };
}

function makeUser(send: any) {
  return {
    id: "user-1",
    displayName: "Newbie",
    displayAvatarURL: () => "https://cdn/avatar.png",
    user: { tag: "newbie#0001", username: "newbie" },
    send,
  } as any;
}

const config = { general_channel_id: "chan-1", welcome_ping_role_id: "role-1" } as any;

describe("postWelcomeCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("DMs the rich embed and posts a one-sentence non-embed line to the channel", async () => {
    const channel = makeChannel();
    const guild = makeGuild(channel);
    const dmSend = vi.fn().mockResolvedValue({ id: "dm-msg" });
    const user = makeUser(dmSend);

    const result = await postWelcomeCard({ guild, user, config, memberCount: 100 });

    // Embed went to the user's DM, with the banner attachment.
    expect(dmSend).toHaveBeenCalledTimes(1);
    const dmArg = dmSend.mock.calls[0][0];
    expect(dmArg.embeds).toHaveLength(1);
    expect(dmArg.embeds[0].title).toBe("Welcome to Pawtropolis 🐾");
    expect(dmArg.files[0].name).toBe("banner.webp");

    // Channel got a one-sentence, non-embed line with both pings.
    expect(channel.send).toHaveBeenCalledTimes(1);
    const chanArg = channel.send.mock.calls[0][0];
    expect(chanArg.embeds).toBeUndefined();
    expect(chanArg.content).toContain("<@user-1>");
    expect(chanArg.content).toContain("<@&role-1>");
    expect(chanArg.content).toContain("Welcome to **Pawtropolis**");
    expect(chanArg.allowedMentions.roles).toContain("role-1");

    // Returns the channel message (callers rely on message.id).
    expect(result).toEqual({ id: "channel-msg" });
  });

  it("still posts the channel line when the user's DMs are closed", async () => {
    const channel = makeChannel();
    const guild = makeGuild(channel);
    const dmSend = vi.fn().mockRejectedValue(Object.assign(new Error("Cannot send"), { code: 50007 }));
    const user = makeUser(dmSend);

    await expect(postWelcomeCard({ guild, user, config, memberCount: 5 })).resolves.toEqual({
      id: "channel-msg",
    });
    expect(channel.send).toHaveBeenCalledTimes(1);
  });

  it("omits the role ping when no welcome ping role is configured", async () => {
    const channel = makeChannel();
    const guild = makeGuild(channel);
    const user = makeUser(vi.fn().mockResolvedValue({ id: "dm-msg" }));

    await postWelcomeCard({
      guild,
      user,
      config: { general_channel_id: "chan-1" } as any,
      memberCount: 1,
    });

    const chanArg = channel.send.mock.calls[0][0];
    expect(chanArg.content).not.toContain("<@&");
    expect(chanArg.allowedMentions.roles).toEqual([]);
  });
});
