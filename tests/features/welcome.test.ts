/**
 * Pawtropolis Tech — tests/features/welcome.test.ts
 * WHAT: Tests for welcome delivery: rich embed -> DM, and a grouped, debounced
 *       one-line "Please welcome @a, and @b!" shout-out -> general channel.
 * WHY: Locks in the requested behavior (embed in DMs only, grouped ping line in
 *      chat, no embed clogging the channel) so a refactor can't regress it.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  postWelcomeCard,
  flushWelcomeAnnounce,
  formatWelcomeAnnounce,
} from "../../src/features/welcome.js";

function makeChannel() {
  return {
    id: "chan-1",
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    send: vi.fn().mockResolvedValue({ id: "channel-msg" }),
  };
}

function makeGuild(id: string, channel: any) {
  return {
    id,
    name: "Pawtropolis",
    iconURL: () => "https://cdn/icon.png",
    members: { me: {} },
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
  } as any;
}

function makeUser(id: string, send: any) {
  return {
    id,
    displayName: "Newbie",
    displayAvatarURL: () => "https://cdn/avatar.png",
    user: { tag: `${id}#0001`, username: id },
    send,
  } as any;
}

describe("formatWelcomeAnnounce", () => {
  it("formats one, two, and three+ users with commas and 'and'", () => {
    expect(formatWelcomeAnnounce(["<@a>"], null)).toBe("Please welcome <@a>!");
    expect(formatWelcomeAnnounce(["<@a>", "<@b>"], null)).toBe("Please welcome <@a>, and <@b>!");
    expect(formatWelcomeAnnounce(["<@a>", "<@b>", "<@c>"], null)).toBe(
      "Please welcome <@a>, <@b>, and <@c>!"
    );
  });

  it("prepends the welcome ping role when configured", () => {
    expect(formatWelcomeAnnounce(["<@a>"], "role-1")).toBe("<@&role-1> Please welcome <@a>!");
  });
});

describe("postWelcomeCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("DMs the rich embed and does not post an embed to the channel", async () => {
    const channel = makeChannel();
    const guild = makeGuild("guild-dm", channel);
    const dmSend = vi.fn().mockResolvedValue({ id: "dm-msg" });
    const user = makeUser("user-1", dmSend);
    const config = { general_channel_id: "chan-1", welcome_ping_role_id: "role-1" } as any;

    await postWelcomeCard({ guild, user, config, memberCount: 100 });

    // Embed went to the user's DM, with the banner attachment.
    expect(dmSend).toHaveBeenCalledTimes(1);
    const dmArg = dmSend.mock.calls[0][0];
    expect(dmArg.embeds).toHaveLength(1);
    expect(dmArg.embeds[0].title).toBe("Welcome to Pawtropolis 🐾");
    expect(dmArg.files[0].name).toBe("banner.webp");

    // Nothing posted to the channel yet (it's debounced/grouped).
    expect(channel.send).not.toHaveBeenCalled();

    // Force the grouped flush: one non-embed line with the ping.
    await flushWelcomeAnnounce("guild-dm");
    expect(channel.send).toHaveBeenCalledTimes(1);
    const chanArg = channel.send.mock.calls[0][0];
    expect(chanArg.embeds).toBeUndefined();
    expect(chanArg.content).toBe("<@&role-1> Please welcome <@user-1>!");
    expect(chanArg.allowedMentions.roles).toContain("role-1");
    expect(chanArg.allowedMentions.users).toEqual(["user-1"]);
  });

  it("groups multiple approvals into one channel line", async () => {
    const channel = makeChannel();
    const guild = makeGuild("guild-group", channel);
    const config = { general_channel_id: "chan-1" } as any; // no role ping

    await postWelcomeCard({
      guild,
      user: makeUser("alice", vi.fn().mockResolvedValue({ id: "d1" })),
      config,
      memberCount: 10,
    });
    await postWelcomeCard({
      guild,
      user: makeUser("bob", vi.fn().mockResolvedValue({ id: "d2" })),
      config,
      memberCount: 11,
    });

    expect(channel.send).not.toHaveBeenCalled();

    await flushWelcomeAnnounce("guild-group");
    expect(channel.send).toHaveBeenCalledTimes(1);
    const chanArg = channel.send.mock.calls[0][0];
    expect(chanArg.content).toBe("Please welcome <@alice>, and <@bob>!");
    expect(chanArg.allowedMentions.roles).toEqual([]);
    expect(chanArg.allowedMentions.users).toEqual(["alice", "bob"]);
  });

  it("still buffers the channel line when the user's DMs are closed", async () => {
    const channel = makeChannel();
    const guild = makeGuild("guild-dmoff", channel);
    const dmSend = vi.fn().mockRejectedValue(Object.assign(new Error("Cannot send"), { code: 50007 }));
    const user = makeUser("user-x", dmSend);
    const config = { general_channel_id: "chan-1" } as any;

    await expect(postWelcomeCard({ guild, user, config, memberCount: 5 })).resolves.toBeUndefined();

    await flushWelcomeAnnounce("guild-dmoff");
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.send.mock.calls[0][0].content).toBe("Please welcome <@user-x>!");
  });
});
