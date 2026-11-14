// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/artistInvestigation/run.test.ts
 * WHAT: Tests for one whole investigation with every outside stage replaced:
 *       Discord history, image downloads, the lookup services and the model.
 * WHY: The budget guard, the one-run lock and "one failed stage does not sink
 *      the run" all live here. It is also where a run is shown to only read:
 *      nothing is sent to the ticket channel and no ticket text reaches the logs.
 */
import Database from "better-sqlite3";
import type { Guild } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import type { AnalysisOutcome } from "../../../src/features/artistInvestigation/analysis.js";
import { NO_USAGE, recordRun } from "../../../src/features/artistInvestigation/budget.js";
import type { RawMessage } from "../../../src/features/artistInvestigation/collect.js";
import {
  LIMITS,
  TICKET_TOOL_BOT_ID,
  type InvestigationSettings,
} from "../../../src/features/artistInvestigation/config.js";
import {
  readCache,
  writeCache,
} from "../../../src/features/artistInvestigation/provenance/cache.js";
import {
  runInvestigation,
  type RunDeps,
  type RunInput,
  type RunResult,
} from "../../../src/features/artistInvestigation/run.js";
import { UNKNOWN_USERNAME } from "../../../src/features/artistInvestigation/serverContext.js";
import type { ProvenanceResult } from "../../../src/features/artistInvestigation/types.js";
import { logger } from "../../../src/lib/logger.js";
import {
  APPLICANT_ID,
  BOT_ID,
  CHANNEL_ID,
  GUILD_ID,
  OTHER_MEMBER_ID,
  STAFF_ID,
  T0,
  applicantContext,
  assessment,
  attachment,
  memoryDb,
  preparedImage,
  provenanceMatch,
  rawMatch,
  settings,
} from "./fixtures.js";

const OWNER_ID = "400000000000000008";
/** 2026-11-11 12:00 UTC: ten days into the month that T0 opens. */
const NOW = T0 + 10 * 86_400_000;
const USAGE = { inputTokens: 21_000, outputTokens: 3_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
const GREETING = `Hello <@${APPLICANT_ID}>! A <@&900000000000000001> has been notified and will be with you shortly.`;
const SKETCH_URL = "https://cdn.discordapp.com/attachments/1/2/sketch.png";
const FINAL_URL = "https://cdn.discordapp.com/attachments/1/3/final.png";

type Db = InstanceType<typeof Database>;
type Stage<K extends keyof RunDeps> = NonNullable<RunDeps[K]>;

let sequence = 0;

function raw(overrides: Partial<RawMessage> = {}): RawMessage {
  sequence++;
  return {
    id: String(800000000000000000n + BigInt(sequence)),
    author: { id: APPLICANT_ID, username: "foxyartz", bot: false, globalName: "Foxy" },
    member: null,
    createdTimestamp: T0 + sequence * 60_000,
    content: "",
    attachments: new Map(),
    embeds: [],
    ...overrides,
  };
}

const greeting = () =>
  raw({
    author: { id: TICKET_TOOL_BOT_ID, username: "Ticket Tool", bot: true },
    content: GREETING,
  });
const picture = (name: string, url: string, content = "") =>
  raw({ content, attachments: new Map([[name, attachment({ id: name, name, url })]]) });

/** A greeting, two applicant messages with one image each, and a staff reply between them. */
function standardTicket(): RawMessage[] {
  return [
    greeting(),
    picture(
      "sketch.png",
      SKETCH_URL,
      "Hi! My gallery is https://www.furaffinity.net/user/foxyartz and this is a private note"
    ),
    raw({
      author: { id: STAFF_ID, username: "staffer", bot: false },
      content: "Thanks, looking now.",
    }),
    picture("final.png", FINAL_URL, "And the finished piece."),
  ];
}

/** Serves history the way Discord does: newest first, `limit` at a time, older than `before`. */
function ticketChannel(messages: RawMessage[]) {
  const fetch = vi.fn(async ({ limit, before }: { limit: number; before?: string }) => {
    const older = before ? messages.filter((m) => BigInt(m.id) < BigInt(before)) : messages;
    return new Map(
      older
        .slice(-limit)
        .reverse()
        .map((m) => [m.id, m])
    );
  });
  return { id: CHANNEL_ID, name: "2d-artist-0042", messages: { fetch }, send: vi.fn(), fetch };
}

const LOOKUPS: ProvenanceResult = {
  matches: [provenanceMatch()],
  services: [
    { service: "fluffle", status: "ok", detail: null, queries: 4, cacheHits: 0, matches: 1 },
    {
      service: "e621",
      status: "skipped",
      detail: "E621_LOGIN and E621_API_KEY are not set",
      queries: 0,
      cacheHits: 0,
      matches: 0,
    },
    { service: "saucenao", status: "ok", detail: null, queries: 2, cacheHits: 1, matches: 0 },
  ],
  omitted: 0,
};

interface HarnessOptions {
  messages?: RawMessage[];
  settings?: Partial<InvestigationSettings>;
  input?: Partial<RunInput>;
  db?: Db;
}

function harness(options: HarnessOptions = {}) {
  const db = options.db ?? memoryDb();
  const channel = ticketChannel(options.messages ?? standardTicket());
  const progress: string[] = [];
  const deps = {
    db,
    settings: settings(options.settings),
    now: () => NOW,
    context: vi.fn<Stage<"context">>(async () => applicantContext()),
    fetchImage: vi.fn<Stage<"fetchImage">>(async (url) => Buffer.from(url)),
    prepare: vi.fn<Stage<"prepare">>(async (key) => preparedImage(key)),
    lookups: vi.fn<Stage<"lookups">>(async () => LOOKUPS),
    analyze: vi.fn<Stage<"analyze">>(async () => ({
      kind: "ok",
      assessment: assessment(),
      usage: USAGE,
    })),
  };
  const input: RunInput = {
    guild: { id: GUILD_ID } as unknown as Guild,
    channel,
    ticket: { system: "ticket-tool", openerId: null, closed: false },
    overrideApplicantId: null,
    memberOverwriteIds: [],
    botUserId: BOT_ID,
    invokedBy: OWNER_ID,
    onProgress: async (text) => {
      progress.push(text);
    },
    ...options.input,
  };
  return { db, channel, deps, input, progress, run: () => runInvestigation(input, deps) };
}

function reportOf(result: RunResult) {
  if (!result.ok) throw new Error(`expected a report, got: ${result.message}`);
  return result.report;
}

function messageOf(result: RunResult) {
  if (result.ok) throw new Error("expected a refusal, got a report");
  return result.message;
}

interface LedgerRow {
  guild_id: string;
  channel_id: string;
  invoked_by: string;
  model: string;
  status: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  image_count: number;
  lookup_count: number;
  created_at_s: number;
}

const ledger = (db: Db) =>
  db
    .prepare(
      `SELECT guild_id, channel_id, invoked_by, model, status, input_tokens, output_tokens, cache_read_tokens,
              cache_write_tokens, cost_usd, image_count, lookup_count, created_at_s
       FROM artist_investigation_run ORDER BY id`
    )
    .all() as LedgerRow[];

function seedSpend(db: Db, usd: number, atMs: number) {
  recordRun(db, {
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    invokedBy: OWNER_ID,
    model: "claude-opus-5-5",
    status: "ok",
    usage: NO_USAGE,
    costUsd: usd,
    imageCount: 0,
    lookupCount: 0,
    nowMs: atMs,
  });
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  sequence = 0;
});

describe("runInvestigation: a full run", () => {
  it("returns a report built from every stage", async () => {
    const h = harness();
    const report = reportOf(await h.run());

    expect(report.guildId).toBe(GUILD_ID);
    expect(report.channelId).toBe(CHANNEL_ID);
    expect(report.ticket).toEqual({
      channelName: "2d-artist-0042",
      system: "ticket-tool",
      closed: false,
      historyComplete: true,
    });
    expect(report.applicantVia).toBe("greeting");
    expect(report.applicant).toEqual(applicantContext());
    expect(report.evidence).toMatchObject({
      applicantId: APPLICANT_ID,
      messageCount: 4,
      applicantMessageCount: 2,
    });
    expect(
      report.evidence.images.map((image) => [image.key, image.name, image.messageLabel])
    ).toEqual([
      ["img1", "sketch.png", "m2"],
      ["img2", "final.png", "m4"],
    ]);
    expect(report.images).toEqual([
      { key: "img1", metadataNotes: [] },
      { key: "img2", metadataNotes: [] },
    ]);
    expect(report.imageFailures).toEqual([]);
    expect(report.provenance).toBe(LOOKUPS);
    expect(report.analysis).toEqual({ kind: "ok", assessment: assessment(), usage: USAGE });
  });

  it("passes each stage what the one before it produced", async () => {
    const h = harness();
    const report = reportOf(await h.run());

    expect(h.deps.context).toHaveBeenCalledExactlyOnceWith({
      guild: h.input.guild,
      applicantId: APPLICANT_ID,
      channelId: CHANNEL_ID,
      channelName: "2d-artist-0042",
      db: h.db,
    });
    expect(h.deps.fetchImage.mock.calls.map(([url]) => url).sort()).toEqual(
      [SKETCH_URL, FINAL_URL].sort()
    );
    expect(h.deps.prepare.mock.calls.map(([key, bytes]) => [key, bytes.toString()]).sort()).toEqual(
      [
        ["img1", SKETCH_URL],
        ["img2", FINAL_URL],
      ]
    );

    const [images, context, lookupDeps] = h.deps.lookups.mock.calls[0] ?? [];
    expect(images?.map((image) => image.key)).toEqual(["img1", "img2"]);
    expect(context).toEqual({
      settings: h.deps.settings,
      handles: report.evidence.handles,
      accountCreatedAtMs: applicantContext().accountCreatedAtMs,
    });
    expect(lookupDeps?.db).toBe(h.db);
    expect(lookupDeps?.now?.()).toBe(NOW);

    expect(h.deps.analyze).toHaveBeenCalledExactlyOnceWith({
      settings: h.deps.settings,
      ticket: report.ticket,
      evidence: report.evidence,
      applicant: report.applicant,
      images: [preparedImage("img1"), preparedImage("img2")],
      imageFailures: [],
      provenance: LOOKUPS,
    });
  });

  it("costs the run from the token counts and writes it to the ledger", async () => {
    const h = harness();
    const report = reportOf(await h.run());

    // 21,000 input tokens at $4 per million plus 3,000 output tokens at $20 per million.
    expect(report.cost.runUsd).toBeCloseTo(0.144, 9);
    expect(report.cost).toMatchObject({
      model: "claude-opus-5-5",
      usage: USAGE,
      capUsd: 200,
      worstCase: false,
      ledgerSaved: true,
    });
    expect(report.cost.monthUsd).toBeCloseTo(0.144, 9);
    expect(ledger(h.db)).toEqual([
      {
        guild_id: GUILD_ID,
        channel_id: CHANNEL_ID,
        invoked_by: OWNER_ID,
        model: "claude-opus-5-5",
        status: "ok",
        input_tokens: 21_000,
        output_tokens: 3_000,
        cache_read_tokens: 0,
        cache_write_tokens: 0,
        cost_usd: report.cost.runUsd,
        image_count: 2,
        lookup_count: 6,
        created_at_s: NOW / 1000,
      },
    ]);
  });

  it("adds this run to what was already spent this month and ignores last month", async () => {
    const h = harness();
    seedSpend(h.db, 5, T0 + 3_600_000);
    seedSpend(h.db, 7.5, NOW - 60_000);
    seedSpend(h.db, 50, T0 - 2 * 86_400_000);
    const report = reportOf(await h.run());

    expect(report.cost.monthUsd).toBeCloseTo(12.5 + 0.144, 9);
  });

  it("tells the owner what it is doing, in order", async () => {
    const h = harness();
    await h.run();

    expect(h.progress).toEqual([
      "Reading the ticket...",
      "Fetching 2 images...",
      "Checking 2 images against the lookup services...",
      "Asking the model. This can take a few minutes...",
    ]);
  });

  it("uses the singular for one image", async () => {
    const h = harness({ messages: [greeting(), picture("sketch.png", SKETCH_URL)] });
    await h.run();

    expect(h.progress).toContain("Fetching 1 image...");
    expect(h.progress).toContain("Checking 1 image against the lookup services...");
  });

  it("only reads the channel: nothing is sent to the ticket", async () => {
    const h = harness();
    await h.run();

    expect(h.channel.send).not.toHaveBeenCalled();
    expect(h.channel.fetch).toHaveBeenCalledExactlyOnceWith({ limit: 100 });
  });

  it("keeps ticket text, names and image links out of the logs", async () => {
    const h = harness();
    await h.run();

    const logged = JSON.stringify([
      vi.mocked(logger.info).mock.calls,
      vi.mocked(logger.warn).mock.calls,
      vi.mocked(logger.error).mock.calls,
      vi.mocked(logger.debug).mock.calls,
    ]);
    for (const secret of [
      "private note",
      "foxyartz",
      "furaffinity",
      "cdn.discordapp.com",
      "sketch.png",
      APPLICANT_ID,
    ]) {
      expect(logged).not.toContain(secret);
    }
    // The in-memory database logs its own migration, so pick the run's line out by its event name.
    const runLines = vi
      .mocked(logger.info)
      .mock.calls.map(([fields]) => fields as unknown as Record<string, unknown>)
      .filter((fields) => fields.evt === "investigate_artist_run");
    expect(runLines).toHaveLength(1);
    expect(runLines[0]).toMatchObject({
      evt: "investigate_artist_run",
      guildId: GUILD_ID,
      channelId: CHANNEL_ID,
      status: "ok",
      images: 2,
      imageFailures: 0,
      matches: 1,
      lookups: 6,
      inputTokens: 21_000,
      outputTokens: 3_000,
    });
  });

  it("passes the ticket's state through to the report", async () => {
    const h = harness({
      input: { ticket: { system: "first-party", openerId: APPLICANT_ID, closed: true } },
    });
    const report = reportOf(await h.run());

    expect(report.ticket).toEqual({
      channelName: "2d-artist-0042",
      system: "first-party",
      closed: true,
      historyComplete: true,
    });
    expect(report.applicantVia).toBe("ticket");
  });

  it("says so when the channel has more history than it reads", async () => {
    const filler = Array.from({ length: LIMITS.maxHistoryPages * 100 + 5 }, () =>
      raw({ content: "hello" })
    );
    const h = harness({ messages: filler, input: { overrideApplicantId: APPLICANT_ID } });
    const report = reportOf(await h.run());

    expect(h.channel.fetch).toHaveBeenCalledTimes(LIMITS.maxHistoryPages);
    expect(report.ticket.historyComplete).toBe(false);
    expect(report.evidence.messageCount).toBe(LIMITS.maxHistoryPages * 100);
  });

  it("treats the applicant's Discord names as claimed handles, except a name it never learned", async () => {
    const known = harness();
    const unknown = harness();
    unknown.deps.context.mockResolvedValue(
      applicantContext({ username: UNKNOWN_USERNAME, globalName: null, nickname: "Foxy Fox" })
    );

    const discordNames = async (h: ReturnType<typeof harness>) =>
      reportOf(await h.run())
        .evidence.handles.filter((handle) => handle.origin === "discord")
        .map((handle) => handle.handle);

    expect(await discordNames(known)).toEqual(["foxyartz", "Foxy"]);
    expect(await discordNames(unknown)).toEqual(["Foxy Fox"]);
  });

  it("clears out lookup results that are past their keep time", async () => {
    const h = harness();
    writeCache(
      h.db,
      "sha-old",
      "fluffle",
      "original",
      [rawMatch()],
      NOW - (LIMITS.cacheTtlSeconds + 60) * 1000
    );
    writeCache(h.db, "sha-fresh", "fluffle", "original", [rawMatch()], NOW - 60_000);
    await h.run();

    const count = h.db.prepare("SELECT COUNT(*) AS n FROM artist_provenance_cache").get() as {
      n: number;
    };
    expect(count.n).toBe(1);
    expect(readCache(h.db, "sha-fresh", "fluffle", "original", NOW)).toHaveLength(1);
  });
});

describe("runInvestigation: who the applicant is", () => {
  it("takes the ticket greeting's word for it", async () => {
    const h = harness();
    expect(reportOf(await h.run()).applicantVia).toBe("greeting");
    expect(h.deps.context.mock.calls[0]?.[0].applicantId).toBe(APPLICANT_ID);
  });

  it("lets the applicant option override everything else", async () => {
    const messages = [
      ...standardTicket(),
      raw({ author: { id: OTHER_MEMBER_ID, username: "otter", bot: false }, content: "mine too" }),
    ];
    const h = harness({ messages, input: { overrideApplicantId: OTHER_MEMBER_ID } });
    const report = reportOf(await h.run());

    expect(report.applicantVia).toBe("option");
    expect(report.evidence.applicantId).toBe(OTHER_MEMBER_ID);
    expect(report.evidence.applicantMessageCount).toBe(1);
    expect(report.evidence.images).toEqual([]);
  });

  it("falls back to the one member with access when there is no greeting", async () => {
    const h = harness({
      messages: standardTicket().slice(1),
      input: { memberOverwriteIds: [BOT_ID, TICKET_TOOL_BOT_ID, APPLICANT_ID] },
    });

    expect(reportOf(await h.run()).applicantVia).toBe("overwrite");
  });

  it("stops and asks for the option when nobody can be identified", async () => {
    const h = harness({ messages: standardTicket().slice(1) });
    const result = await h.run();

    expect(messageOf(result)).toBe(
      "Could not tell who opened this ticket. Run it again with the `applicant` option."
    );
    expect(h.deps.context).not.toHaveBeenCalled();
    expect(h.deps.fetchImage).not.toHaveBeenCalled();
    expect(h.deps.lookups).not.toHaveBeenCalled();
    expect(h.deps.analyze).not.toHaveBeenCalled();
    expect(ledger(h.db)).toEqual([]);
  });

  it("stops when more than one member has access and the greeting names nobody", async () => {
    const h = harness({
      messages: standardTicket().slice(1),
      input: { memberOverwriteIds: [APPLICANT_ID, OTHER_MEMBER_ID] },
    });

    expect(messageOf(await h.run())).toBe(
      "More than one member has access to this ticket and the greeting does not name the opener. Run it again with the `applicant` option."
    );
  });
});

describe("runInvestigation: nothing to review", () => {
  it("stops when the applicant has posted nothing, before anything is fetched or spent", async () => {
    const h = harness({
      messages: [
        greeting(),
        raw({ author: { id: STAFF_ID, username: "staffer", bot: false }, content: "Hello?" }),
      ],
    });
    const result = await h.run();

    expect(messageOf(result)).toBe(
      `<@${APPLICANT_ID}> has not posted anything in this ticket yet, so there is nothing to review. ` +
        "If someone else is the applicant, run it again with the `applicant` option."
    );
    expect(h.deps.fetchImage).not.toHaveBeenCalled();
    expect(h.deps.lookups).not.toHaveBeenCalled();
    expect(h.deps.analyze).not.toHaveBeenCalled();
    expect(ledger(h.db)).toEqual([]);
  });

  it("stops on a channel with no messages at all", async () => {
    const h = harness({ messages: [], input: { overrideApplicantId: APPLICANT_ID } });
    expect(messageOf(await h.run())).toContain("has not posted anything in this ticket yet");
  });

  it("says so when the ticket's messages cannot be read", async () => {
    const h = harness();
    h.channel.fetch.mockRejectedValue(new Error("Missing Access"));
    const result = await h.run();

    expect(messageOf(result)).toBe(
      "The messages in this ticket could not be read (Missing Access). Nothing was run and nothing was spent."
    );
    expect(h.deps.analyze).not.toHaveBeenCalled();
    expect(ledger(h.db)).toEqual([]);
  });

  it("still reviews a ticket with text and no images", async () => {
    const h = harness({
      messages: [greeting(), raw({ content: "I have no samples yet, sorry." })],
    });
    const report = reportOf(await h.run());

    expect(h.deps.fetchImage).not.toHaveBeenCalled();
    expect(h.deps.lookups.mock.calls[0]?.[0]).toEqual([]);
    expect(h.deps.analyze.mock.calls[0]?.[0].images).toEqual([]);
    expect(h.progress).toEqual([
      "Reading the ticket...",
      "No images to look up. Moving on...",
      "Asking the model. This can take a few minutes...",
    ]);
    expect(report.images).toEqual([]);
    expect(ledger(h.db)[0]).toMatchObject({ status: "ok", image_count: 0 });
  });
});

describe("runInvestigation: budget guard", () => {
  const CAP_REACHED =
    "Monthly cap reached. Tracked spend this month is $200.00 of the $200.00 cap (INVESTIGATE_MONTHLY_CAP_USD). The total resets at the start of next month (UTC).";

  it("refuses to start once the month's spend has reached the cap", async () => {
    const h = harness();
    seedSpend(h.db, 200, NOW - 3_600_000);
    const result = await h.run();

    expect(messageOf(result)).toBe(CAP_REACHED);
    expect(h.channel.fetch).not.toHaveBeenCalled();
    expect(h.deps.context).not.toHaveBeenCalled();
    expect(h.deps.analyze).not.toHaveBeenCalled();
    expect(h.progress).toEqual([]);
    expect(ledger(h.db)).toHaveLength(1);
  });

  it("refuses when the spend is over a cap that was lowered", async () => {
    const h = harness({ settings: { monthlyCapUsd: 20 } });
    seedSpend(h.db, 31.4, NOW - 3_600_000);

    expect(messageOf(await h.run())).toBe(
      "Monthly cap reached. Tracked spend this month is $31.40 of the $20.00 cap (INVESTIGATE_MONTHLY_CAP_USD). The total resets at the start of next month (UTC)."
    );
  });

  it("refuses before any lookup or model call when this run's worst case would pass the cap", async () => {
    const h = harness();
    seedSpend(h.db, 199.99, NOW - 3_600_000);
    const result = await h.run();

    expect(messageOf(result)).toMatch(
      /^Monthly cap reached\. Tracked spend this month is \$199\.99 and this run could cost up to \$\d+\.\d\d, which would pass the \$200\.00 cap \(INVESTIGATE_MONTHLY_CAP_USD\)\. The total resets at the start of next month \(UTC\)\.$/
    );
    expect(h.deps.lookups).not.toHaveBeenCalled();
    expect(h.deps.analyze).not.toHaveBeenCalled();
    expect(ledger(h.db)).toHaveLength(1);
  });

  it("runs when the worst case still fits under the cap", async () => {
    const h = harness();
    seedSpend(h.db, 150, NOW - 3_600_000);

    expect((await h.run()).ok).toBe(true);
    expect(h.deps.analyze).toHaveBeenCalledTimes(1);
  });

  it("does not count last month's spend against this month's cap", async () => {
    const h = harness();
    seedSpend(h.db, 500, T0 - 86_400_000);

    expect((await h.run()).ok).toBe(true);
  });

  it("is switched off by a cap of zero", async () => {
    const h = harness({ settings: { monthlyCapUsd: 0 } });
    const result = await h.run();

    expect(messageOf(result)).toBe(
      "This command is switched off: INVESTIGATE_MONTHLY_CAP_USD is set to 0."
    );
    expect(h.channel.fetch).not.toHaveBeenCalled();
    expect(ledger(h.db)).toEqual([]);
  });

  it("refuses to run when the ledger cannot be read", async () => {
    const h = harness({ db: new Database(":memory:") });
    const result = await h.run();

    expect(messageOf(result)).toBe(
      "The usage ledger could not be read, so nothing was run and nothing was spent. Check that migration 084 has been applied."
    );
    expect(h.channel.fetch).not.toHaveBeenCalled();
    expect(h.deps.analyze).not.toHaveBeenCalled();
  });

  it("still returns the report when the run cannot be written to the ledger, and says so", async () => {
    const h = harness();
    seedSpend(h.db, 5, NOW - 3_600_000);
    h.deps.analyze.mockImplementation(async () => {
      h.db.exec("DROP TABLE artist_investigation_run");
      return { kind: "ok", assessment: assessment(), usage: USAGE };
    });
    const report = reportOf(await h.run());

    expect(report.cost.ledgerSaved).toBe(false);
    expect(report.cost.runUsd).toBeCloseTo(0.144, 9);
    expect(report.cost.monthUsd).toBeCloseTo(5.144, 9);
    expect(vi.mocked(logger.error).mock.calls[0]?.[0]).toMatchObject({
      evt: "investigate_artist_ledger_failed",
    });
  });
});

describe("runInvestigation: without an API key", () => {
  it("skips the model, still runs the lookups and costs nothing", async () => {
    const h = harness({ settings: { anthropicApiKey: null } });
    const report = reportOf(await h.run());

    expect(h.deps.analyze).not.toHaveBeenCalled();
    expect(h.deps.lookups).toHaveBeenCalledTimes(1);
    expect(report.analysis).toEqual({
      kind: "skipped",
      message: "ANTHROPIC_API_KEY is not set, so the model was not asked.",
    });
    expect(report.cost).toMatchObject({
      runUsd: 0,
      monthUsd: 0,
      usage: NO_USAGE,
      worstCase: false,
      ledgerSaved: true,
    });
    expect(ledger(h.db)[0]).toMatchObject({
      status: "skipped",
      cost_usd: 0,
      input_tokens: 0,
      image_count: 2,
      lookup_count: 6,
    });
    expect(h.progress).not.toContain("Asking the model. This can take a few minutes...");
  });

  it("is not held back by the cap, since nothing is spent", async () => {
    const zeroCap = harness({ settings: { anthropicApiKey: null, monthlyCapUsd: 0 } });
    const overCap = harness({ settings: { anthropicApiKey: null } });
    seedSpend(overCap.db, 999, NOW - 3_600_000);

    expect((await zeroCap.run()).ok).toBe(true);
    expect((await overCap.run()).ok).toBe(true);
  });
});

describe("runInvestigation: one run at a time", () => {
  it("refuses a second run while the first is still going", async () => {
    const first = harness();
    const gate = deferred<void>();
    first.deps.context.mockImplementation(async () => {
      await gate.promise;
      return applicantContext();
    });
    const second = harness();

    const firstRun = first.run();
    const secondResult = await second.run();
    gate.resolve();
    const firstResult = await firstRun;

    expect(messageOf(secondResult)).toBe(
      "An investigation is already running. Try again when it finishes."
    );
    expect(second.channel.fetch).not.toHaveBeenCalled();
    expect(firstResult.ok).toBe(true);
    expect((await second.run()).ok).toBe(true);
  });

  it("lets the next run start after one that stopped on an error", async () => {
    const broken = harness();
    broken.deps.context.mockRejectedValue(new Error("boom"));

    await expect(broken.run()).rejects.toThrow("boom");
    expect((await harness().run()).ok).toBe(true);
  });
});

describe("runInvestigation: images", () => {
  it("keeps going when one image cannot be downloaded", async () => {
    const h = harness();
    h.deps.fetchImage.mockImplementation(async (url) => {
      if (url === FINAL_URL) throw new Error("HTTP 404");
      return Buffer.from(url);
    });
    const report = reportOf(await h.run());

    expect(report.images).toEqual([{ key: "img1", metadataNotes: [] }]);
    expect(report.imageFailures).toEqual([{ key: "img2", name: "final.png", reason: "HTTP 404" }]);
    expect(h.deps.lookups.mock.calls[0]?.[0].map((image) => image.key)).toEqual(["img1"]);
    expect(h.deps.analyze.mock.calls[0]?.[0]).toMatchObject({
      images: [preparedImage("img1")],
      imageFailures: [{ key: "img2", name: "final.png", reason: "HTTP 404" }],
    });
    expect(ledger(h.db)[0]).toMatchObject({ status: "ok", image_count: 1 });
  });

  it("keeps going when one image cannot be decoded, with a short reason", async () => {
    const h = harness();
    h.deps.prepare.mockImplementation(async (key) => {
      if (key === "img1")
        throw new Error(`Input buffer\n   contains unsupported image format ${"x".repeat(300)}`);
      return preparedImage(key);
    });
    const report = reportOf(await h.run());

    expect(report.images.map((image) => image.key)).toEqual(["img2"]);
    expect(report.imageFailures[0]?.reason).toHaveLength(120);
    expect(
      report.imageFailures[0]?.reason.startsWith("Input buffer contains unsupported image format x")
    ).toBe(true);
  });

  it("gives a reason even when what was thrown is not an error", async () => {
    const h = harness();
    h.deps.fetchImage.mockRejectedValue("nope");
    const report = reportOf(await h.run());

    expect(report.imageFailures.map((failure) => failure.reason)).toEqual([
      "unknown error",
      "unknown error",
    ]);
  });

  it("still asks the model when every image failed, and says there is nothing to look up", async () => {
    const h = harness();
    h.deps.fetchImage.mockRejectedValue(new Error("the download timed out"));
    const report = reportOf(await h.run());

    expect(report.images).toEqual([]);
    expect(report.imageFailures.map((failure) => failure.key).sort()).toEqual(["img1", "img2"]);
    expect(h.deps.lookups.mock.calls[0]?.[0]).toEqual([]);
    expect(h.deps.analyze).toHaveBeenCalledTimes(1);
    expect(h.progress).toContain("No images to look up. Moving on...");
  });

  it("hands the images on in the order they were posted, whatever order they finish in", async () => {
    const h = harness();
    const slow = deferred<Buffer>();
    h.deps.fetchImage.mockImplementation((url) =>
      url === SKETCH_URL ? slow.promise : Promise.resolve(Buffer.from(url))
    );

    const running = h.run();
    await vi.waitFor(() => expect(h.deps.prepare).toHaveBeenCalledTimes(1));
    expect(h.deps.prepare.mock.calls[0]?.[0]).toBe("img2");
    slow.resolve(Buffer.from(SKETCH_URL));
    const report = reportOf(await running);

    expect(report.images.map((image) => image.key)).toEqual(["img1", "img2"]);
    expect(h.deps.lookups.mock.calls[0]?.[0].map((image) => image.key)).toEqual(["img1", "img2"]);
  });

  it("downloads a few images at a time, never all at once", async () => {
    const pictures = Array.from({ length: 10 }, (_, i) =>
      picture(`piece-${i + 1}.png`, `https://cdn.discordapp.com/attachments/1/${i + 10}/piece.png`)
    );
    const h = harness({ messages: [greeting(), ...pictures] });
    let inFlight = 0;
    let peak = 0;
    h.deps.fetchImage.mockImplementation(async (url) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight--;
      return Buffer.from(url);
    });
    const report = reportOf(await h.run());

    expect(report.images).toHaveLength(10);
    expect(peak).toBe(LIMITS.imageConcurrency);
  });

  it("leaves images over the per-run limit alone", async () => {
    const h = harness({ settings: { maxImages: 1 } });
    const report = reportOf(await h.run());

    expect(report.evidence.images.map((image) => image.name)).toEqual(["sketch.png"]);
    expect(report.evidence.imagesOverCap.map((image) => image.name)).toEqual(["final.png"]);
    expect(h.deps.fetchImage).toHaveBeenCalledExactlyOnceWith(SKETCH_URL);
  });
});

describe("runInvestigation: a stage that fails", () => {
  it("reports every lookup service as failed when the lookup stage breaks, and still asks the model", async () => {
    const h = harness();
    h.deps.lookups.mockRejectedValue(new Error("database is locked"));
    const report = reportOf(await h.run());

    const failed = (service: string) => ({
      service,
      status: "failed",
      detail: "the lookup stage stopped on an unexpected error",
      queries: 0,
      cacheHits: 0,
      matches: 0,
    });
    expect(report.provenance).toEqual({
      matches: [],
      services: [failed("fluffle"), failed("e621"), failed("saucenao")],
      omitted: 0,
    });
    expect(h.deps.analyze.mock.calls[0]?.[0].provenance).toEqual(report.provenance);
    expect(report.analysis.kind).toBe("ok");
    expect(vi.mocked(logger.error).mock.calls[0]?.[0]).toEqual({
      evt: "investigate_artist_lookups_failed",
      problem: "database is locked",
    });
    expect(ledger(h.db)[0]).toMatchObject({ status: "ok", lookup_count: 0 });
  });

  it("counts a model call that blew up at its worst case", async () => {
    const h = harness();
    h.deps.analyze.mockRejectedValue(new Error("socket hang up"));
    const report = reportOf(await h.run());

    expect(report.analysis).toEqual({
      kind: "error",
      message: "The model call failed unexpectedly.",
      usage: null,
      mayBeBilled: true,
    });
    expect(report.cost.worstCase).toBe(true);
    expect(report.cost.usage).toEqual(NO_USAGE);
    // The worst case always includes the full output allowance: 20,000 tokens at $20 per million.
    expect(report.cost.runUsd).toBeGreaterThan(0.4);
    expect(report.cost.monthUsd).toBeCloseTo(report.cost.runUsd, 9);
    expect(ledger(h.db)[0]).toMatchObject({
      status: "error",
      cost_usd: report.cost.runUsd,
      input_tokens: 0,
      output_tokens: 0,
    });
    expect(report.provenance).toBe(LOOKUPS);
    expect(vi.mocked(logger.error).mock.calls[0]?.[0]).toEqual({
      evt: "investigate_artist_analysis_failed",
      problem: "socket hang up",
    });
  });

  it("counts a timed-out model call at its worst case, and more images make that worst case larger", async () => {
    const timedOut: AnalysisOutcome = {
      kind: "error",
      message: "The Claude API timed out.",
      usage: null,
      mayBeBilled: true,
    };
    const two = harness();
    two.deps.analyze.mockResolvedValue(timedOut);
    const none = harness({ messages: [greeting(), raw({ content: "text only" })] });
    none.deps.analyze.mockResolvedValue(timedOut);

    const withImages = reportOf(await two.run()).cost;
    const withoutImages = reportOf(await none.run()).cost;

    expect(withImages.worstCase).toBe(true);
    expect(withoutImages.worstCase).toBe(true);
    // Two 1568x1176 images are 2 x 56 x 42 image tokens at $4 per million.
    expect(withImages.runUsd - withoutImages.runUsd).toBeGreaterThan((2 * 56 * 42 * 4) / 1_000_000);
  });

  it("charges nothing for a model call that never reached the API", async () => {
    const h = harness();
    h.deps.analyze.mockResolvedValue({
      kind: "error",
      message: "The Claude API could not be reached.",
      usage: null,
      mayBeBilled: false,
    });
    const report = reportOf(await h.run());

    expect(report.cost).toMatchObject({ runUsd: 0, monthUsd: 0, worstCase: false });
    expect(ledger(h.db)[0]).toMatchObject({ status: "error", cost_usd: 0 });
  });

  it.each(["refused", "truncated", "invalid"] as const)(
    "pays for a %s answer by its token counts",
    async (kind) => {
      const h = harness();
      h.deps.analyze.mockResolvedValue({ kind, message: "No usable answer.", usage: USAGE });
      const report = reportOf(await h.run());

      expect(report.analysis).toEqual({ kind, message: "No usable answer.", usage: USAGE });
      expect(report.cost.runUsd).toBeCloseTo(0.144, 9);
      expect(report.cost.worstCase).toBe(false);
      expect(ledger(h.db)[0]).toMatchObject({
        status: kind,
        input_tokens: 21_000,
        output_tokens: 3_000,
      });
    }
  );
});
