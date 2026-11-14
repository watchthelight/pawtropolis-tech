// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/commands/investigate-artist.test.ts
 * WHAT: Tests for the /investigate-artist handler: who may run it, where it
 *       runs, and how every outcome is answered.
 * WHY: The command reads private ticket material, so two things must hold in
 *      every path. Only an ID on the owner list gets past the handler, and
 *      nothing it says is visible to anyone else or posted in the ticket.
 */
import {
  ChannelType,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type Guild,
  type User,
} from "discord.js";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/lib/owner.js", () => ({ isOwner: vi.fn(() => false) }));
vi.mock("../../src/features/tickets/service.js", () => ({ TicketService: { findByChannelId: vi.fn(() => null) } }));
vi.mock("../../src/features/tickets/config.js", () => ({ getTicketsCategoryId: vi.fn(() => "600000000000000001") }));
vi.mock("../../src/features/artistInvestigation/run.js", () => ({ runInvestigation: vi.fn() }));
vi.mock("../../src/features/artistInvestigation/render.js", () => ({ renderReport: vi.fn() }));
vi.mock("../../src/features/artistInvestigation/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/features/artistInvestigation/config.js")>()),
  getSettings: vi.fn(() => ({ name: "test-settings" })),
}));

import { data, execute } from "../../src/commands/investigate-artist.js";
import { db } from "../../src/db/db.js";
import type { InvestigationReport } from "../../src/features/artistInvestigation/render.js";
import { renderReport } from "../../src/features/artistInvestigation/render.js";
import { runInvestigation } from "../../src/features/artistInvestigation/run.js";
import { getTicketsCategoryId } from "../../src/features/tickets/config.js";
import { TicketService } from "../../src/features/tickets/service.js";
import { logger } from "../../src/lib/logger.js";
import { isOwner } from "../../src/lib/owner.js";
import { createTestCommandContext } from "../utils/contextFactory.js";
import { createMockGuild, createMockInteraction, createMockUser } from "../utils/discordMocks.js";

const OWNER_ID = "400000000000000008";
const APPLICANT_ID = "400000000000000001";
const GUILD_ID = "300000000000000001";
const CHANNEL_ID = "500000000000000001";
const TICKETS_CATEGORY = "600000000000000001";
const NOT_A_TICKET = "This only works inside a 2D artist verification ticket channel.";
const REFUSAL = { content: "❌ This command is only available to the bot owner.", flags: MessageFlags.Ephemeral };
const NO_MENTIONS = { parse: [] };
const REPORT = { name: "test-report" } as unknown as InvestigationReport;

function ticketChannel(overrides: Record<string, unknown> = {}) {
  return {
    id: CHANNEL_ID,
    name: "2d-artist-0042",
    parentId: TICKETS_CATEGORY,
    type: ChannelType.GuildText,
    isDMBased: () => false,
    permissionOverwrites: {
      cache: new Map([
        ["300000000000000009", { id: "300000000000000009", type: OverwriteType.Role }],
        [APPLICANT_ID, { id: APPLICANT_ID, type: OverwriteType.Member }],
        ["bot-123", { id: "bot-123", type: OverwriteType.Member }],
      ]),
    },
    send: vi.fn(),
    messages: { fetch: vi.fn() },
    ...overrides,
  };
}

interface SetupOptions {
  userId?: string;
  channel?: ReturnType<typeof ticketChannel> | null;
  guild?: null;
  applicantId?: string;
  extra?: Record<string, unknown>;
}

const mockUser = (id: string) => createMockUser({ id } as Partial<User>);

function setup(options: SetupOptions = {}) {
  const channel = "channel" in options ? options.channel : ticketChannel();
  const interaction = createMockInteraction({
    user: mockUser(options.userId ?? OWNER_ID),
    guild: "guild" in options ? null : createMockGuild({ id: GUILD_ID } as Partial<Guild>),
    channel: channel as unknown as ChatInputCommandInteraction["channel"],
    options: { getUser: { applicant: options.applicantId ? mockUser(options.applicantId) : null } },
    ...options.extra,
  } as unknown as Parameters<typeof createMockInteraction>[0]);
  return { interaction, channel, ctx: createTestCommandContext(interaction) };
}

/** What the handler passed to the run. Fails the test when the run never started. */
function runCall() {
  const call = vi.mocked(runInvestigation).mock.calls[0];
  if (!call) throw new Error("runInvestigation was not called");
  return { input: call[0], deps: call[1] };
}
const order = (fn: unknown) => vi.mocked(fn as () => void).mock.invocationCallOrder[0] ?? Number.NaN;

beforeEach(() => {
  vi.mocked(isOwner).mockReturnValue(true);
  vi.mocked(TicketService.findByChannelId).mockReturnValue(null);
  vi.mocked(getTicketsCategoryId).mockReturnValue(TICKETS_CATEGORY);
  vi.mocked(runInvestigation).mockResolvedValue({ ok: true, report: REPORT });
  vi.mocked(renderReport).mockReturnValue([{ embeds: [{ title: "Page 1" }] }]);
});

describe("/investigate-artist: command data", () => {
  const json = data.toJSON();

  it("is a guild-only command named investigate-artist", () => {
    expect(json.name).toBe("investigate-artist");
    expect(json.dm_permission).toBe(false);
    expect(json.description).toContain("owner only");
    expect(json.description.length).toBeLessThanOrEqual(100);
  });

  it("is hidden from members without Administrator", () => {
    expect(json.default_member_permissions).toBe(PermissionFlagsBits.Administrator.toString());
  });

  it("takes one optional user option for the applicant", () => {
    expect(json.options).toHaveLength(1);
    expect(json.options?.[0]).toMatchObject({ name: "applicant", type: 6, required: false });
  });
});

describe("/investigate-artist: owner check", () => {
  it("answers anyone else with a short private refusal and does nothing more", async () => {
    vi.mocked(isOwner).mockReturnValue(false);
    const { interaction, channel, ctx } = setup({ userId: "400000000000000077" });

    await execute(ctx);

    expect(isOwner).toHaveBeenCalledExactlyOnceWith("400000000000000077");
    expect(interaction.reply).toHaveBeenCalledExactlyOnceWith(REFUSAL);
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(TicketService.findByChannelId).not.toHaveBeenCalled();
    expect(runInvestigation).not.toHaveBeenCalled();
    expect(renderReport).not.toHaveBeenCalled();
    expect(channel?.send).not.toHaveBeenCalled();
    expect(channel?.messages.fetch).not.toHaveBeenCalled();
  });

  it("refuses a server admin and the server's owner when their ID is not on the list", async () => {
    vi.mocked(isOwner).mockReturnValue(false);
    const { interaction, ctx } = setup({
      userId: "400000000000000077",
      extra: { memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator) },
    });
    (interaction.guild as unknown as { ownerId: string }).ownerId = "400000000000000077";

    await execute(ctx);

    expect(interaction.reply).toHaveBeenCalledExactlyOnceWith(REFUSAL);
    expect(runInvestigation).not.toHaveBeenCalled();
  });

  it("refuses outside a ticket too, without saying whether the channel is one", async () => {
    vi.mocked(isOwner).mockReturnValue(false);
    const { interaction, ctx } = setup({ channel: ticketChannel({ name: "general", parentId: null }) });

    await execute(ctx);

    expect(interaction.reply).toHaveBeenCalledExactlyOnceWith(REFUSAL);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it("checks the user who ran the command", async () => {
    const { ctx } = setup();
    await execute(ctx);

    expect(isOwner).toHaveBeenCalledExactlyOnceWith(OWNER_ID);
    expect(runInvestigation).toHaveBeenCalledTimes(1);
  });
});

describe("/investigate-artist: privacy", () => {
  it("defers privately before it looks at anything", async () => {
    const { interaction, ctx } = setup();
    await execute(ctx);

    expect(interaction.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
    expect(order(interaction.deferReply)).toBeLessThan(order(TicketService.findByChannelId));
    expect(order(interaction.deferReply)).toBeLessThan(order(runInvestigation));
  });

  it("never replies in public and never sends to the ticket channel", async () => {
    vi.mocked(renderReport).mockReturnValue([
      { embeds: [{ title: "Page 1" }] },
      { embeds: [{ title: "Page 2" }] },
      { embeds: [{ title: "Page 3" }] },
    ]);
    const { interaction, channel, ctx } = setup();
    await execute(ctx);

    expect(interaction.reply).not.toHaveBeenCalled();
    expect(channel?.send).not.toHaveBeenCalled();
    for (const [message] of vi.mocked(interaction.followUp).mock.calls) {
      expect(message).toMatchObject({ flags: MessageFlags.Ephemeral });
    }
  });
});

describe("/investigate-artist: ticket check", () => {
  it.each([
    ["a channel that is not a ticket", ticketChannel({ name: "general", parentId: "600000000000000002" })],
    ["a ticket-named channel outside the tickets category", ticketChannel({ parentId: "600000000000000002" })],
    ["another kind of ticket in the tickets category", ticketChannel({ name: "support-0007" })],
    ["a thread named like a ticket", ticketChannel({ type: ChannelType.PublicThread })],
    ["a voice channel named like a ticket", ticketChannel({ type: ChannelType.GuildVoice })],
    ["a direct message", ticketChannel({ isDMBased: () => true, type: ChannelType.DM })],
  ])("says so in %s", async (_label, channel) => {
    const { interaction, ctx } = setup({ channel });
    await execute(ctx);

    expect(interaction.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
    expect(interaction.editReply).toHaveBeenCalledExactlyOnceWith({ content: NOT_A_TICKET });
    expect(runInvestigation).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it("says so when there is no channel or no server", async () => {
    const noChannel = setup({ channel: null });
    await execute(noChannel.ctx);
    const noGuild = setup({ guild: null });
    await execute(noGuild.ctx);

    expect(noChannel.interaction.editReply).toHaveBeenCalledExactlyOnceWith({ content: NOT_A_TICKET });
    expect(noGuild.interaction.editReply).toHaveBeenCalledExactlyOnceWith({ content: NOT_A_TICKET });
    expect(runInvestigation).not.toHaveBeenCalled();
  });

  it("names the ticket type when the bot's own records say it is a different one", async () => {
    vi.mocked(TicketService.findByChannelId).mockReturnValue({
      typeKey: "partnership",
      openerUserId: APPLICANT_ID,
      status: "open",
      legacySource: null,
    } as unknown as ReturnType<typeof TicketService.findByChannelId>);
    const { interaction, ctx } = setup();
    await execute(ctx);

    expect(TicketService.findByChannelId).toHaveBeenCalledExactlyOnceWith(CHANNEL_ID);
    expect(interaction.editReply).toHaveBeenCalledExactlyOnceWith({
      content: "This is a `partnership` ticket. The command only works in 2D artist verification tickets.",
    });
    expect(runInvestigation).not.toHaveBeenCalled();
  });

  it("recognizes a Ticket Tool ticket by its category and name", async () => {
    const { ctx } = setup();
    await execute(ctx);

    expect(getTicketsCategoryId).toHaveBeenCalledExactlyOnceWith(GUILD_ID);
    expect(runCall().input.ticket).toEqual({ ok: true, system: "ticket-tool", openerId: null, closed: false });
  });

  it("recognizes a closed Ticket Tool ticket", async () => {
    const { ctx } = setup({ channel: ticketChannel({ name: "2d-artist-closed0042" }) });
    await execute(ctx);

    expect(runCall().input.ticket).toMatchObject({ system: "ticket-tool", closed: true });
  });

  it("takes the opener from the bot's own ticket record when there is one", async () => {
    vi.mocked(TicketService.findByChannelId).mockReturnValue({
      typeKey: "2d-artist",
      openerUserId: APPLICANT_ID,
      status: "closed",
      legacySource: null,
    } as unknown as ReturnType<typeof TicketService.findByChannelId>);
    const { ctx } = setup({ channel: ticketChannel({ name: "renamed-by-staff", parentId: null }) });
    await execute(ctx);

    expect(runCall().input.ticket).toEqual({
      ok: true,
      system: "first-party",
      openerId: APPLICANT_ID,
      closed: true,
    });
  });
});

describe("/investigate-artist: running", () => {
  it("hands the run the server, the channel, the caller and the members with access", async () => {
    const { interaction, channel, ctx } = setup();
    await execute(ctx);

    const { input, deps } = runCall();
    expect(input.guild).toBe(interaction.guild);
    expect(input.channel).toBe(channel);
    expect(input).toMatchObject({
      overrideApplicantId: null,
      memberOverwriteIds: [APPLICANT_ID, "bot-123"],
      botUserId: "bot-123",
      invokedBy: OWNER_ID,
    });
    expect(deps.db).toBe(db);
    expect(deps.settings).toEqual({ name: "test-settings" });
  });

  it("passes the applicant option through", async () => {
    const { ctx } = setup({ applicantId: "400000000000000003" });
    await execute(ctx);

    expect(runCall().input.overrideApplicantId).toBe("400000000000000003");
  });

  it("shows progress by editing the private reply, and a failed edit does not stop the run", async () => {
    const { interaction, ctx } = setup();
    vi.mocked(runInvestigation).mockImplementation(async (input) => {
      await input.onProgress("Reading the ticket...");
      vi.mocked(interaction.editReply).mockRejectedValueOnce(new Error("Unknown Message"));
      await input.onProgress("Fetching 2 images...");
      return { ok: true, report: REPORT };
    });

    await execute(ctx);

    const edits = vi.mocked(interaction.editReply).mock.calls.map(([message]) => message);
    expect(edits).toEqual([
      { content: "Reading the ticket..." },
      { content: "Fetching 2 images..." },
      { content: "", embeds: [{ title: "Page 1" }], allowedMentions: NO_MENTIONS },
    ]);
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it("tracks the run and the reply as separate phases", async () => {
    const { interaction, ctx } = setup();
    const phases: string[] = [];
    const tracked = createTestCommandContext(interaction, { onStep: (phase) => phases.push(phase) });
    await execute(tracked);

    expect(phases).toEqual(["investigate", "reply"]);
    expect(ctx.currentPhase()).toBe("enter");
  });
});

describe("/investigate-artist: answering", () => {
  it("shows a refusal from the run as plain private text that pings nobody", async () => {
    vi.mocked(runInvestigation).mockResolvedValue({
      ok: false,
      message: `<@${APPLICANT_ID}> has not posted anything in this ticket yet, so there is nothing to review.`,
    });
    const { interaction, ctx } = setup();
    await execute(ctx);

    expect(interaction.editReply).toHaveBeenCalledExactlyOnceWith({
      content: `<@${APPLICANT_ID}> has not posted anything in this ticket yet, so there is nothing to review.`,
      allowedMentions: NO_MENTIONS,
    });
    expect(renderReport).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it("puts a one-page report in the deferred reply", async () => {
    const { interaction, ctx } = setup();
    await execute(ctx);

    expect(renderReport).toHaveBeenCalledExactlyOnceWith(REPORT);
    expect(interaction.editReply).toHaveBeenCalledExactlyOnceWith({
      content: "",
      embeds: [{ title: "Page 1" }],
      allowedMentions: NO_MENTIONS,
    });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it("sends the later pages of a long report as private follow-ups, in order", async () => {
    vi.mocked(renderReport).mockReturnValue([
      { embeds: [{ title: "Page 1" }] },
      { embeds: [{ title: "Page 2a" }, { title: "Page 2b" }] },
      { embeds: [{ title: "Page 3" }] },
    ]);
    const { interaction, ctx } = setup();
    await execute(ctx);

    expect(interaction.editReply).toHaveBeenCalledExactlyOnceWith({
      content: "",
      embeds: [{ title: "Page 1" }],
      allowedMentions: NO_MENTIONS,
    });
    expect(vi.mocked(interaction.followUp).mock.calls.map(([message]) => message)).toEqual([
      { embeds: [{ title: "Page 2a" }, { title: "Page 2b" }], flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS },
      { embeds: [{ title: "Page 3" }], flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS },
    ]);
    expect(order(interaction.editReply)).toBeLessThan(order(interaction.followUp));
  });
});

describe("/investigate-artist: errors", () => {
  const NOTICE = {
    content: "The investigation stopped on an error. Nothing was posted in this channel. Trace: `test-trace-123`",
    flags: MessageFlags.Ephemeral,
  };

  it("answers a failed run privately with the trace ID and does not rethrow", async () => {
    const failure = Object.assign(new Error(`Request failed: ${"x".repeat(500)}`), { code: 50013 });
    vi.mocked(runInvestigation).mockRejectedValue(failure);
    const { interaction, ctx } = setup();

    await expect(execute(ctx)).resolves.toBeUndefined();

    expect(interaction.followUp).toHaveBeenCalledExactlyOnceWith(NOTICE);
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("logs the error's name, message and code, never the error object", async () => {
    const failure = Object.assign(new Error(`Request failed: ${"x".repeat(500)}`), { code: 50013, requestBody: "ticket text" });
    vi.mocked(runInvestigation).mockRejectedValue(failure);
    const { ctx } = setup();
    await execute(ctx);

    const [fields] = vi.mocked(logger.error).mock.calls[0] ?? [];
    expect(fields).toEqual({
      evt: "investigate_artist_failed",
      traceId: "test-trace-123",
      phase: "investigate",
      errName: "Error",
      errMessage: `Request failed: ${"x".repeat(284)}`,
      code: 50013,
    });
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain("ticket text");
  });

  it("logs something useful when what was thrown is not an error", async () => {
    vi.mocked(runInvestigation).mockRejectedValue("plain string");
    const { ctx } = setup();
    await execute(ctx);

    expect(vi.mocked(logger.error).mock.calls[0]?.[0]).toMatchObject({ errName: "string", errMessage: "plain string" });
  });

  it("answers privately when the report cannot be rendered or sent", async () => {
    vi.mocked(renderReport).mockImplementation(() => {
      throw new Error("render broke");
    });
    const broken = setup();
    await execute(broken.ctx);

    vi.mocked(renderReport).mockReturnValue([{ embeds: [{ title: "Page 1" }] }, { embeds: [{ title: "Page 2" }] }]);
    const unsent = setup();
    vi.mocked(unsent.interaction.followUp).mockRejectedValueOnce(new Error("Invalid Form Body"));
    await execute(unsent.ctx);

    expect(broken.interaction.followUp).toHaveBeenCalledExactlyOnceWith(NOTICE);
    expect(vi.mocked(unsent.interaction.followUp).mock.calls.at(-1)?.[0]).toEqual(NOTICE);
  });

  it("uses a private reply when even the deferral failed", async () => {
    const { interaction, ctx } = setup();
    vi.mocked(interaction.deferReply).mockRejectedValue(new Error("Unknown interaction"));

    await expect(execute(ctx)).resolves.toBeUndefined();

    expect(interaction.reply).toHaveBeenCalledExactlyOnceWith(NOTICE);
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(runInvestigation).not.toHaveBeenCalled();
  });

  it("gives up quietly when the notice itself cannot be delivered", async () => {
    vi.mocked(runInvestigation).mockRejectedValue(new Error("boom"));
    const { interaction, ctx } = setup();
    vi.mocked(interaction.followUp).mockRejectedValue(new Error("Unknown Webhook"));

    await expect(execute(ctx)).resolves.toBeUndefined();
  });
});

describe("/investigate-artist: with the real owner list", () => {
  async function load(ownerIds: string) {
    vi.resetModules();
    vi.doUnmock("../../src/lib/owner.js");
    vi.doMock("../../src/lib/env.js", async (importOriginal) => {
      const real = await importOriginal<typeof import("../../src/lib/env.js")>();
      return { ...real, env: { ...real.env, OWNER_IDS: ownerIds } };
    });
    const command = await import("../../src/commands/investigate-artist.js");
    const run = await import("../../src/features/artistInvestigation/run.js");
    const render = await import("../../src/features/artistInvestigation/render.js");
    vi.mocked(run.runInvestigation).mockResolvedValue({ ok: true, report: REPORT });
    vi.mocked(render.renderReport).mockReturnValue([{ embeds: [{ title: "Page 1" }] }]);
    return { execute: command.execute, runInvestigation: vi.mocked(run.runInvestigation) };
  }

  afterAll(() => {
    vi.doUnmock("../../src/lib/env.js");
    vi.resetModules();
  });

  it("lets an ID on OWNER_IDS through and stops every other ID in the handler", async () => {
    const command = await load("400000000000000008, 400000000000000009");
    const owner = setup({ userId: "400000000000000009" });
    const stranger = setup({ userId: "400000000000000077" });

    await command.execute(owner.ctx);
    await command.execute(stranger.ctx);

    expect(owner.interaction.deferReply).toHaveBeenCalledExactlyOnceWith({ flags: MessageFlags.Ephemeral });
    expect(command.runInvestigation).toHaveBeenCalledTimes(1);
    expect(command.runInvestigation.mock.calls[0]?.[0].invokedBy).toBe("400000000000000009");
    expect(stranger.interaction.reply).toHaveBeenCalledExactlyOnceWith(REFUSAL);
    expect(stranger.interaction.deferReply).not.toHaveBeenCalled();
  });

  it("lets nobody through when OWNER_IDS is empty", async () => {
    const command = await load("");
    const { interaction, ctx } = setup();

    await command.execute(ctx);

    expect(interaction.reply).toHaveBeenCalledExactlyOnceWith(REFUSAL);
    expect(command.runInvestigation).not.toHaveBeenCalled();
  });
});
