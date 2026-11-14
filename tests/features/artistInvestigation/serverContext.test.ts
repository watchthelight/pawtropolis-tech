// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/artistInvestigation/serverContext.test.ts
 * WHAT: What the bot reads about an applicant from Discord, its own database,
 *       the Ticket Tool log and the Verify Blacklist thread.
 * WHY: Each source can fail without the others. A source that could not be read
 *      has to show up as a gap in the report, never as "nothing found", because
 *      "no earlier tickets" and "could not check" mean different things to the owner.
 */
import type { Guild } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ids = vi.hoisted(() => ({
  configuredGuild: "300000000000000002",
  logChannel: "500000000000000010",
  blacklistThread: "500000000000000011",
}));

// Only the production server has a ticket log and a blacklist thread on file.
// The tests give a made-up server the same two settings.
vi.mock("../../../src/features/artistInvestigation/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/features/artistInvestigation/config.js")>()),
  getArtistLogChannelId: (guildId: string) => (guildId === ids.configuredGuild ? ids.logChannel : null),
  getVerifyBlacklistThreadId: (guildId: string) => (guildId === ids.configuredGuild ? ids.blacklistThread : null),
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { LIMITS } from "../../../src/features/artistInvestigation/config.js";
import {
  UNKNOWN_USERNAME,
  blacklistEntry,
  gatherApplicantContext,
  priorTicketsFromLog,
  snowflakeToMs,
  type StaffMessage,
} from "../../../src/features/artistInvestigation/serverContext.js";
import { APPLICANT_ID, CHANNEL_ID, GUILD_ID, OTHER_MEMBER_ID, T0, memoryDb, schemaDb } from "./fixtures.js";

const DAY_MS = 86_400_000;
const CHANNEL_NAME = "2d-artist-0042";
const NO_LOG_GAP = "No ticket log channel is configured for this server, so earlier Ticket Tool tickets are unknown.";
const NO_BLACKLIST_GAP = "No Verify Blacklist thread is configured for this server.";

/** A staff-channel message. Higher n is newer, in both id and time. */
function staffMessage(n: number, overrides: Partial<StaffMessage> = {}): StaffMessage {
  return {
    id: String(900000000000000000n + BigInt(n)),
    createdTimestamp: T0 - 600 * DAY_MS + n * DAY_MS,
    content: "",
    embeds: [],
    ...overrides,
  };
}

/** The transcript post Ticket Tool leaves in the log when a ticket closes. */
const transcript = (n: number, ownerId: string, ticketName: string) =>
  staffMessage(n, {
    embeds: [
      {
        fields: [
          { name: "Ticket Owner", value: `<@${ownerId}>` },
          { name: "Ticket Name", value: ticketName },
          { name: "Panel Name", value: "2D Artist" },
        ],
      },
    ],
  });

/** A channel that serves its messages newest first, 100 a page, like Discord. */
function staffChannel(messages: StaffMessage[]) {
  const newestFirst = [...messages].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1));
  const fetch = vi.fn(async ({ limit, before }: { limit: number; before?: string }) => {
    const older = before ? newestFirst.filter((m) => BigInt(m.id) < BigInt(before)) : newestFirst;
    return new Map(older.slice(0, limit).map((m) => [m.id, m]));
  });
  return { isTextBased: () => true, messages: { fetch } };
}

interface FakeRole {
  id: string;
  name: string;
  position: number;
}

const member = (guildId: string, roles: FakeRole[] = [{ id: "r1", name: "Member", position: 2 }]) => ({
  joinedTimestamp: Date.UTC(2025, 5, 1),
  nickname: "Foxy the Artist",
  roles: {
    cache: new Map([{ id: guildId, name: "@everyone", position: 0 }, ...roles].map((role) => [role.id, role])),
  },
});

interface GuildOptions {
  id?: string;
  user?: { username: string; globalName: string | null } | Error;
  member?: ReturnType<typeof member> | Error;
  logChannel?: unknown;
  blacklistThread?: unknown;
}

function fakeGuild(options: GuildOptions = {}) {
  const id = options.id ?? GUILD_ID;
  const give = (value: unknown) => async () => {
    if (value instanceof Error) throw value;
    return value;
  };
  return {
    id,
    client: {
      users: { fetch: vi.fn(give(options.user ?? { username: "foxyartz", globalName: "Foxy" })) },
      channels: { fetch: vi.fn(give(options.blacklistThread ?? null)) },
    },
    members: { fetch: vi.fn(give(options.member ?? member(id))) },
    channels: { fetch: vi.fn(give(options.logChannel ?? null)) },
  };
}

describe("snowflakeToMs", () => {
  it("reads the creation time out of a Discord id", () => {
    // The worked example from Discord's API reference.
    expect(snowflakeToMs("175928847299117063")).toBe(1462015105796);
  });
});

describe("priorTicketsFromLog", () => {
  it("lists the applicant's earlier tickets and nobody else's", () => {
    const log = [
      transcript(3, OTHER_MEMBER_ID, "2d-artist-0040"),
      transcript(2, APPLICANT_ID, "2d-artist-0031"),
      transcript(1, APPLICANT_ID, "2d-artist-0012"),
    ];

    expect(priorTicketsFromLog(log, APPLICANT_ID, CHANNEL_NAME)).toEqual([
      {
        name: "2d-artist-0031",
        when: new Date(staffMessage(2).createdTimestamp).toISOString(),
        note: "closed, transcript on file in the ticket log",
        source: "ticket-tool-log",
      },
      expect.objectContaining({ name: "2d-artist-0012", source: "ticket-tool-log" }),
    ]);
  });

  it("leaves out the ticket being reviewed", () => {
    const log = [transcript(1, APPLICANT_ID, CHANNEL_NAME)];
    expect(priorTicketsFromLog(log, APPLICANT_ID, CHANNEL_NAME)).toEqual([]);
  });

  it("counts a ticket once when the log mentions it twice", () => {
    const log = [transcript(2, APPLICANT_ID, "2d-artist-0031"), transcript(1, APPLICANT_ID, "2d-artist-0031")];
    expect(priorTicketsFromLog(log, APPLICANT_ID, CHANNEL_NAME)).toHaveLength(1);
  });

  it("ignores log lines that are not transcripts", () => {
    const log = [
      staffMessage(1, { content: `Ticket created by <@${APPLICANT_ID}>` }),
      staffMessage(2, { embeds: [{ fields: [{ name: "Ticket Owner", value: `<@${APPLICANT_ID}>` }] }] }),
      staffMessage(3, { embeds: [{ fields: [] }] }),
    ];
    expect(priorTicketsFromLog(log, APPLICANT_ID, CHANNEL_NAME)).toEqual([]);
  });
});

describe("blacklistEntry", () => {
  const at = Date.UTC(2026, 9, 5, 18, 30);

  it("returns the staff note with its date and without the mention", () => {
    const messages = [staffMessage(1, { createdTimestamp: at, content: `<@${APPLICANT_ID}> - sold traced art,\n  refused twice` })];
    expect(blacklistEntry(messages, APPLICANT_ID)).toBe("2026-10-05: sold traced art, refused twice");
  });

  it("recognizes the nickname form of a mention", () => {
    const messages = [staffMessage(1, { createdTimestamp: at, content: `<@!${APPLICANT_ID}> AI art` })];
    expect(blacklistEntry(messages, APPLICANT_ID)).toBe("2026-10-05: AI art");
  });

  it("says so when the entry has no note", () => {
    const messages = [staffMessage(1, { createdTimestamp: at, content: `<@${APPLICANT_ID}>` })];
    expect(blacklistEntry(messages, APPLICANT_ID)).toBe("2026-10-05: listed without a note");
  });

  it("drops other people's mentions from the note", () => {
    const messages = [staffMessage(1, { createdTimestamp: at, content: `<@${APPLICANT_ID}> reported by <@${OTHER_MEMBER_ID}> for reselling` })];
    expect(blacklistEntry(messages, APPLICANT_ID)).toBe("2026-10-05: reported by for reselling");
  });

  it("cuts a very long note", () => {
    const messages = [staffMessage(1, { createdTimestamp: at, content: `<@${APPLICANT_ID}> ${"x".repeat(900)}` })];
    expect(blacklistEntry(messages, APPLICANT_ID)).toBe(`2026-10-05: ${"x".repeat(300)}`);
  });

  it("returns nothing when the user is not listed", () => {
    const messages = [
      staffMessage(1, { content: `<@${OTHER_MEMBER_ID}> traced` }),
      // The id appears, but not as a mention of this user.
      staffMessage(2, { content: `see ticket ${APPLICANT_ID}9` }),
    ];
    expect(blacklistEntry(messages, APPLICANT_ID)).toBeNull();
  });
});

describe("gatherApplicantContext", () => {
  let db: ReturnType<typeof schemaDb>;

  const gather = (guild: ReturnType<typeof fakeGuild>, database = db) =>
    gatherApplicantContext({
      guild: guild as unknown as Guild,
      applicantId: APPLICANT_ID,
      channelId: CHANNEL_ID,
      channelName: CHANNEL_NAME,
      db: database,
    });

  const addActivity = (guildId: string, userId: string, ...timesS: number[]) => {
    const insert = db.prepare(
      `INSERT INTO message_activity (guild_id, channel_id, user_id, created_at_s, hour_bucket) VALUES (?, 'c1', ?, ?, ?)`
    );
    for (const t of timesS) insert.run(guildId, userId, t, Math.floor(t / 3600));
  };

  const addApplication = (id: string, userId: string, status: string, createdAt: string, submittedAt: string | null) =>
    db
      .prepare(`INSERT INTO application (id, guild_id, user_id, status, created_at, submitted_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, GUILD_ID, userId, status, createdAt, submittedAt);

  const addTicket = (row: {
    number: number;
    channelId: string;
    openedAt: number;
    status?: string;
    closeReason?: string | null;
    typeKey?: string;
    opener?: string;
    guildId?: string;
  }) =>
    db
      .prepare(
        `INSERT INTO ticket (id, type_key, number, channel_id, guild_id, opener_user_id, status, close_reason, opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `t-${row.typeKey ?? "2d-artist"}-${row.number}`,
        row.typeKey ?? "2d-artist",
        row.number,
        row.channelId,
        row.guildId ?? GUILD_ID,
        row.opener ?? APPLICANT_ID,
        row.status ?? "closed",
        row.closeReason ?? null,
        row.openedAt
      );

  beforeEach(() => {
    db = schemaDb();
  });
  afterEach(() => {
    db.close();
  });

  it("collects the profile, membership, activity, gate application and earlier tickets", async () => {
    const lastSeenS = T0 / 1000 - 3600;
    addActivity(GUILD_ID, APPLICANT_ID, lastSeenS - 5000, lastSeenS, lastSeenS - 90);
    addActivity(GUILD_ID, OTHER_MEMBER_ID, lastSeenS + 500);
    addActivity("another-guild", APPLICANT_ID, lastSeenS + 900);
    addApplication("app-old", APPLICANT_ID, "rejected", "2025-05-01 10:00:00", "2025-05-01 09:00:00");
    addApplication("app-new", APPLICANT_ID, "approved", "2025-06-01 10:00:00", "2025-06-01 09:30:00");
    addApplication("app-other", OTHER_MEMBER_ID, "kicked", "2026-01-01 10:00:00", null);
    addTicket({ number: 3, channelId: "c-3", openedAt: 1_750_000_000, closeReason: "did not answer" });
    addTicket({ number: 7, channelId: "c-7", openedAt: 1_760_000_000, status: "open" });
    addTicket({ number: 9, channelId: CHANNEL_ID, openedAt: 1_770_000_000, status: "open" });
    addTicket({ number: 4, channelId: "c-4", openedAt: 1_755_000_000, typeKey: "support" });
    addTicket({ number: 5, channelId: "c-5", openedAt: 1_756_000_000, opener: OTHER_MEMBER_ID });
    addTicket({ number: 6, channelId: "c-6", openedAt: 1_757_000_000, guildId: "another-guild" });

    const guild = fakeGuild({
      member: member(GUILD_ID, [
        { id: "r1", name: "Member", position: 2 },
        { id: "r2", name: "Artist Applicant", position: 9 },
        { id: "r3", name: "Level 5", position: 4 },
      ]),
    });
    const context = await gather(guild);

    expect(guild.client.users.fetch).toHaveBeenCalledWith(APPLICANT_ID);
    expect(guild.members.fetch).toHaveBeenCalledWith(APPLICANT_ID);
    expect(context).toEqual({
      userId: APPLICANT_ID,
      username: "foxyartz",
      globalName: "Foxy",
      nickname: "Foxy the Artist",
      accountCreatedAtMs: snowflakeToMs(APPLICANT_ID),
      joinedAtMs: Date.UTC(2025, 5, 1),
      inServer: true,
      // Highest role first, without @everyone.
      roles: ["Artist Applicant", "Level 5", "Member"],
      recentMessageCount: 3,
      lastSeenAtMs: lastSeenS * 1000,
      gateApplication: { status: "approved", submittedAt: "2025-06-01 09:30:00" },
      priorTickets: [
        { name: "2d-artist-0007", when: new Date(1_760_000_000_000).toISOString(), note: "still open", source: "first-party" },
        { name: "2d-artist-0003", when: new Date(1_750_000_000_000).toISOString(), note: "closed: did not answer", source: "first-party" },
      ],
      onVerifyBlacklist: null,
      blacklistNote: null,
      gaps: [NO_LOG_GAP, NO_BLACKLIST_GAP],
    });
  });

  it("reports an applicant the bot has no records for as zero activity, not as unknown", async () => {
    const context = await gather(fakeGuild());

    expect(context).toMatchObject({ recentMessageCount: 0, lastSeenAtMs: null, gateApplication: null, priorTickets: [] });
    expect(context.gaps).toEqual([NO_LOG_GAP, NO_BLACKLIST_GAP]);
  });

  it("records a closed ticket that has no reason", async () => {
    addTicket({ number: 3, channelId: "c-3", openedAt: 1_750_000_000 });
    const context = await gather(fakeGuild());
    expect(context.priorTickets).toEqual([expect.objectContaining({ name: "2d-artist-0003", note: "closed" })]);
  });

  it("marks an applicant who left the server, without calling it a failed check", async () => {
    const gone = Object.assign(new Error("Unknown Member"), { code: 10007 });
    const context = await gather(fakeGuild({ member: gone }));

    expect(context).toMatchObject({ inServer: false, joinedAtMs: null, nickname: null, roles: [], username: "foxyartz" });
    expect(context.gaps).toEqual([NO_LOG_GAP, NO_BLACKLIST_GAP]);
  });

  it("lists membership as a gap when Discord refuses the lookup", async () => {
    const context = await gather(fakeGuild({ member: Object.assign(new Error("Missing Access"), { code: 50001 }) }));

    expect(context.inServer).toBeNull();
    expect(context.gaps).toContain("Server membership could not be read (Missing Access).");
  });

  it("keeps the account age and a placeholder name when the profile cannot be read", async () => {
    const context = await gather(fakeGuild({ user: new Error("Unknown User") }));

    expect(context).toMatchObject({
      username: UNKNOWN_USERNAME,
      globalName: null,
      accountCreatedAtMs: snowflakeToMs(APPLICANT_ID),
      inServer: true,
    });
    expect(context.gaps).toContain("Discord profile could not be read (Unknown User).");
  });

  it("lists the bot's own records as a gap when the database cannot be read", async () => {
    const withoutBotTables = memoryDb();
    const context = await gather(fakeGuild(), withoutBotTables);
    withoutBotTables.close();

    expect(context).toMatchObject({ recentMessageCount: null, lastSeenAtMs: null, gateApplication: null, inServer: true });
    expect(context.gaps).toContain("Bot database records could not be read (no such table: message_activity).");
  });

  it("shortens a long error before it reaches the report", async () => {
    const context = await gather(fakeGuild({ user: new Error("e".repeat(500)) }));
    expect(context.gaps).toContain(`Discord profile could not be read (${"e".repeat(120)}).`);
  });

  it("does not look for a ticket log or a blacklist on a server that has neither", async () => {
    const guild = fakeGuild();
    await gather(guild);

    expect(guild.channels.fetch).not.toHaveBeenCalled();
    expect(guild.client.channels.fetch).not.toHaveBeenCalled();
  });

  describe("on a server with a ticket log and a Verify Blacklist", () => {
    const configured = (options: GuildOptions = {}) =>
      fakeGuild({
        id: ids.configuredGuild,
        logChannel: staffChannel([]),
        blacklistThread: staffChannel([]),
        ...options,
      });

    it("reads both, and reports a clean result as clean", async () => {
      const guild = configured();
      const context = await gather(guild);

      expect(guild.channels.fetch).toHaveBeenCalledWith(ids.logChannel);
      expect(guild.client.channels.fetch).toHaveBeenCalledWith(ids.blacklistThread);
      expect(context).toMatchObject({ priorTickets: [], onVerifyBlacklist: false, blacklistNote: null, gaps: [] });
    });

    it("adds earlier Ticket Tool tickets from the log", async () => {
      const logChannel = staffChannel([
        transcript(1, APPLICANT_ID, "2d-artist-0031"),
        transcript(2, OTHER_MEMBER_ID, "2d-artist-0040"),
        transcript(3, APPLICANT_ID, CHANNEL_NAME),
      ]);
      const context = await gather(configured({ logChannel }));

      expect(logChannel.messages.fetch).toHaveBeenCalledTimes(1);
      expect(logChannel.messages.fetch).toHaveBeenCalledWith({ limit: 100 });
      expect(context.priorTickets).toEqual([
        {
          name: "2d-artist-0031",
          when: new Date(staffMessage(1).createdTimestamp).toISOString(),
          note: "closed, transcript on file in the ticket log",
          source: "ticket-tool-log",
        },
      ]);
      expect(context.gaps).toEqual([]);
    });

    it("says how far back the log was read when it is longer than the page limit", async () => {
      const total = LIMITS.logPages * 100 + 20;
      const log = Array.from({ length: total }, (_, i) => transcript(i + 1, OTHER_MEMBER_ID, `2d-artist-${i + 1}`));
      // The applicant's old ticket sits in the part that is not read.
      log[4] = transcript(5, APPLICANT_ID, "2d-artist-0005");
      const logChannel = staffChannel(log);

      const context = await gather(configured({ logChannel }));

      expect(logChannel.messages.fetch).toHaveBeenCalledTimes(LIMITS.logPages);
      expect(logChannel.messages.fetch).toHaveBeenLastCalledWith({ limit: 100, before: staffMessage(121).id });
      expect(context.priorTickets).toEqual([]);
      const oldestRead = new Date(staffMessage(21).createdTimestamp).toISOString().slice(0, 10);
      expect(context.gaps).toEqual([`Ticket log was read back to ${oldestRead} only; older tickets are not counted.`]);
    });

    it("lists the log as a gap when the channel is gone or unreadable", async () => {
      const missing = await gather(configured({ logChannel: null }));
      expect(missing.gaps).toEqual(["Ticket log could not be read, so earlier Ticket Tool tickets are unknown (log channel is not readable)."]);

      const refused = await gather(configured({ logChannel: new Error("Missing Access") }));
      expect(refused.gaps).toEqual(["Ticket log could not be read, so earlier Ticket Tool tickets are unknown (Missing Access)."]);

      const notText = await gather(configured({ logChannel: { isTextBased: () => false } }));
      expect(notText.gaps).toHaveLength(1);
    });

    it("reports a blacklist entry with the staff note", async () => {
      const blacklistThread = staffChannel([
        staffMessage(1, { content: `<@${OTHER_MEMBER_ID}> traced` }),
        staffMessage(2, { createdTimestamp: Date.UTC(2026, 9, 5), content: `<@${APPLICANT_ID}> - sold traced art` }),
      ]);
      const context = await gather(configured({ blacklistThread }));

      expect(context).toMatchObject({ onVerifyBlacklist: true, blacklistNote: "2026-10-05: sold traced art", gaps: [] });
    });

    it("cannot clear an applicant when the blacklist is longer than the part it read", async () => {
      const total = LIMITS.blacklistPages * 100 + 1;
      const entries = Array.from({ length: total }, (_, i) => staffMessage(i + 1, { content: `<@${OTHER_MEMBER_ID}> entry ${i}` }));
      const blacklistThread = staffChannel(entries);

      const context = await gather(configured({ blacklistThread }));

      expect(blacklistThread.messages.fetch).toHaveBeenCalledTimes(LIMITS.blacklistPages);
      expect(context).toMatchObject({ onVerifyBlacklist: null, blacklistNote: null });
      expect(context.gaps).toEqual(["Verify Blacklist is longer than the part that was read; no entry was found in the newest messages."]);
    });

    it("still reports an entry found in the part of a long blacklist it did read", async () => {
      const total = LIMITS.blacklistPages * 100 + 1;
      const entries = Array.from({ length: total }, (_, i) => staffMessage(i + 1, { content: `<@${OTHER_MEMBER_ID}> entry ${i}` }));
      entries[total - 1] = staffMessage(total, { createdTimestamp: Date.UTC(2026, 9, 5), content: `<@${APPLICANT_ID}> AI art` });

      const context = await gather(configured({ blacklistThread: staffChannel(entries) }));

      expect(context).toMatchObject({ onVerifyBlacklist: true, blacklistNote: "2026-10-05: AI art", gaps: [] });
    });

    it("lists the blacklist as a gap when the thread cannot be read, and still reads the log", async () => {
      const logChannel = staffChannel([transcript(1, APPLICANT_ID, "2d-artist-0031")]);
      const context = await gather(configured({ logChannel, blacklistThread: new Error("Unknown Channel") }));

      expect(context.onVerifyBlacklist).toBeNull();
      expect(context.priorTickets).toHaveLength(1);
      expect(context.gaps).toEqual(["Verify Blacklist could not be read (Unknown Channel)."]);
    });
  });
});
