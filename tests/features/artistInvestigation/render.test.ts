// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/artistInvestigation/render.test.ts
 * WHAT: Tests for the report renderer: what each section says, how long text is
 *       split, and what happens to text that did not come from us.
 * WHY: The report is the only thing the owner sees. It has to fit Discord's
 *      embed limits at any length, keep saying it is advisory, and never let
 *      ticket text, a lookup service or the model plant a link or a label.
 */
import { describe, expect, it } from "vitest";
import type { APIEmbed } from "discord.js";
import type { Assessment } from "../../../src/features/artistInvestigation/analysis.js";
import { formatFooter } from "../../../src/features/artistInvestigation/budget.js";
import { CRITERIA, WORKFLOW_GAPS, requirementQuotes } from "../../../src/features/artistInvestigation/criteria.js";
import {
  paginate,
  renderReport,
  type ApplicantSource,
  type InvestigationReport,
  type ReportPage,
} from "../../../src/features/artistInvestigation/render.js";
import type { CollectedImage, ServiceReport } from "../../../src/features/artistInvestigation/types.js";
import {
  APPLICANT_ID,
  CHANNEL_ID,
  GUILD_ID,
  T0,
  applicantContext,
  assessment,
  provenanceMatch,
  ticketEvidence,
} from "./fixtures.js";

const USAGE = { inputTokens: 21_000, outputTokens: 3_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
const JUMP = `https://discord.com/channels/${GUILD_ID}/${CHANNEL_ID}`;
const seconds = (ms: number) => Math.floor(ms / 1000);

function service(overrides: Partial<ServiceReport> = {}): ServiceReport {
  return { service: "fluffle", status: "ok", detail: null, queries: 2, cacheHits: 0, matches: 1, ...overrides };
}

function image(n: number, overrides: Partial<CollectedImage> = {}): CollectedImage {
  return {
    key: `img${n}`,
    messageId: String(700000000000000000n + BigInt(n + 1)),
    messageLabel: `m${n + 1}`,
    postedAtMs: T0 + n * 60_000,
    name: `piece-${n}.png`,
    url: `https://cdn.discordapp.com/attachments/1/2/piece-${n}.png`,
    contentType: "image/png",
    size: 250_000,
    width: 1200,
    height: 900,
    source: "attachment",
    ...overrides,
  };
}

function report(overrides: Partial<InvestigationReport> = {}): InvestigationReport {
  return {
    guildId: GUILD_ID,
    channelId: CHANNEL_ID,
    ticket: { channelName: "2d-artist-0042", system: "ticket-tool", closed: false, historyComplete: true },
    applicantVia: "greeting",
    evidence: ticketEvidence(),
    applicant: applicantContext(),
    images: [{ key: "img1", metadataNotes: [] }],
    imageFailures: [],
    provenance: { matches: [provenanceMatch()], services: [service()], omitted: 0 },
    analysis: { kind: "ok", assessment: assessment(), usage: USAGE },
    cost: {
      model: "claude-opus-5-5",
      usage: USAGE,
      runUsd: 0.144,
      monthUsd: 12.5,
      capUsd: 200,
      worstCase: false,
      ledgerSaved: true,
    },
    ...overrides,
  };
}

const withAnswer = (overrides: Partial<Assessment>, rest: Partial<InvestigationReport> = {}) =>
  report({ analysis: { kind: "ok", assessment: assessment(overrides), usage: USAGE }, ...rest });

const embedsOf = (pages: ReportPage[]) => pages.flatMap((page) => page.embeds);

/** Every embed of one section joined, continuation pages included. */
function section(pages: ReportPage[], title: string): string | null {
  const parts = embedsOf(pages).filter((embed) => embed.title === title || embed.title === `${title} (continued)`);
  return parts.length > 0 ? parts.map((embed) => embed.description).join("\n\n") : null;
}

const titles = (pages: ReportPage[]) => embedsOf(pages).map((embed) => embed.title);
const everything = (pages: ReportPage[]) => embedsOf(pages).map((embed) => embed.description).join("\n\n");
const render = (overrides: Partial<InvestigationReport> = {}) => renderReport(report(overrides));

/** Targets of every masked link in the text. */
const linkTargets = (text: string) => [...text.matchAll(/(?<!\\)\[[^\]]*\]\(([^)\s]*)\)/g)].map((m) => m[1]);

const embedChars = (embed: APIEmbed) =>
  (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0);

describe("paginate", () => {
  it("returns nothing for no blocks", () => {
    expect(paginate([])).toEqual([]);
  });

  it("joins blocks with a blank line while they fit", () => {
    expect(paginate(["one", "two", "three"])).toEqual(["one\n\ntwo\n\nthree"]);
  });

  it("starts a new page when the next block would pass the limit", () => {
    // "aaaa\n\nbbbb" is 10 characters: it fits a limit of 10 and not a limit of 9.
    expect(paginate(["aaaa", "bbbb"], 10)).toEqual(["aaaa\n\nbbbb"]);
    expect(paginate(["aaaa", "bbbb"], 9)).toEqual(["aaaa", "bbbb"]);
    expect(paginate(["aaaa", "bbbb", "cc"], 9)).toEqual(["aaaa", "bbbb\n\ncc"]);
  });

  it("keeps a block whole when it fits on a page of its own", () => {
    const pages = paginate(["x".repeat(30), "y".repeat(40), "z".repeat(30)], 50);
    expect(pages).toEqual(["x".repeat(30), "y".repeat(40), "z".repeat(30)]);
  });

  it("cuts a block that is longer than a page at a line break", () => {
    const block = `${"a".repeat(30)}\n${"b".repeat(30)}`;
    expect(paginate([block], 40)).toEqual(["a".repeat(30), "b".repeat(30)]);
  });

  it("cuts at a space when there is no line break", () => {
    const block = `${"a".repeat(30)} ${"b".repeat(30)}`;
    expect(paginate([block], 40)).toEqual(["a".repeat(30), "b".repeat(30)]);
  });

  it("cuts mid-word when the only break is in the first half of the page", () => {
    const block = `ab ${"c".repeat(100)}`;
    const pages = paginate([block], 40);
    expect(pages.every((page) => page.length <= 40)).toBe(true);
    expect(pages.join("")).toBe(block);
  });

  it("never returns an empty page or a page over the limit, and loses no words", () => {
    const words = Array.from({ length: 900 }, (_, i) => `word${i}`);
    const blocks = [words.slice(0, 300).join(" "), words.slice(300, 310).join("\n"), words.slice(310).join(" ")];
    const pages = paginate(blocks, 200);

    expect(pages.length).toBeGreaterThan(10);
    expect(pages.every((page) => page.length > 0 && page.length <= 200)).toBe(true);
    expect(pages.join(" ").split(/\s+/)).toEqual(words);
  });

  it("uses a limit under Discord's 4096 by default", () => {
    const pages = paginate(["a".repeat(3900), "b"]);
    expect(pages).toEqual(["a".repeat(3900), "b"]);
    expect(paginate(["a".repeat(3901)])).toHaveLength(2);
  });
});

describe("renderReport: layout", () => {
  it("puts the sections in a fixed order with one color", () => {
    const pages = render();

    expect(titles(pages)).toEqual([
      "Artist investigation: #2d-artist-0042",
      "Criteria",
      "Images",
      "Reverse image search",
      "Flags and next steps",
      "Notes",
    ]);
    expect(new Set(embedsOf(pages).map((embed) => embed.color))).toEqual(new Set([0x5b6ee1]));
  });

  it("opens with the advisory line before anything else", () => {
    const first = embedsOf(render())[0];

    expect(first?.description?.startsWith("**Advisory only.** These are indicators with reasoning, not a verdict.")).toBe(true);
    expect(first?.description).toContain("Stolen, traced and AI-generated art cannot be detected reliably.");
    expect(first?.description).toContain("Nothing was posted in the ticket and no action was taken.");
  });

  it("keeps the advisory line when there is no AI assessment", () => {
    const first = embedsOf(render({ analysis: { kind: "skipped", message: "No key." } }))[0];
    expect(first?.description?.startsWith("**Advisory only.**")).toBe(true);
  });

  it("puts the cost footer on the last embed only", () => {
    const cost = report().cost;
    const embeds = embedsOf(render());

    expect(embeds.at(-1)?.footer?.text).toBe(formatFooter(cost));
    expect(embeds.at(-1)?.footer?.text).toContain("Run: $0.14 (21.0k in / 3.0k out, claude-opus-5-5)");
    expect(embeds.at(-1)?.footer?.text).toContain("Month: $12.50 of $200.00 cap");
    expect(embeds.slice(0, -1).every((embed) => embed.footer === undefined)).toBe(true);
  });

  it("says so in the footer when the run was counted at its worst case", () => {
    const cost = { ...report().cost, worstCase: true };
    const footer = embedsOf(render({ cost })).at(-1)?.footer?.text;

    expect(footer).toBe(`${formatFooter(cost)} · token counts never came back, so this run is counted at its worst case`);
  });

  it("says so in the footer when the run could not be saved to the ledger", () => {
    const cost = { ...report().cost, ledgerSaved: false };
    const footer = embedsOf(render({ cost })).at(-1)?.footer?.text;

    expect(footer).toBe(`${formatFooter(cost)} · this run could not be saved to the usage ledger, so later totals will miss it`);
  });
});

describe("renderReport: summary", () => {
  it("shows the score, the confidence and the model's summary", () => {
    const summary = section(render(), "Artist investigation: #2d-artist-0042");

    expect(summary).toContain("**Score: 72 / 100** · confidence: medium\nOnly one image was submitted.");
    expect(summary).toContain("The applicant posted one sketch with a matching gallery upload.");
  });

  it("describes the applicant from the collected data", () => {
    const summary = section(render(), "Artist investigation: #2d-artist-0042");

    expect(summary).toContain(
      [
        `**Applicant** <@${APPLICANT_ID}> (foxyartz), identified from the ticket greeting`,
        `Account created <t:${seconds(Date.UTC(2023, 0, 15))}:D>, 3 years 9 months before the ticket`,
        `Joined <t:${seconds(Date.UTC(2025, 5, 1))}:D>, 17 months before the ticket`,
        "Roles: Member",
        `Activity: 42 messages in the last 90 days, latest <t:${seconds(T0 - 86_400_000)}:D>`,
        "Gate application: approved, submitted 2025-06-01",
        "Other 2D artist tickets: none found",
        "Verify Blacklist: not listed",
      ].join("\n")
    );
  });

  it.each<[ApplicantSource, string]>([
    ["option", "identified from the `applicant` option"],
    ["ticket", "identified from the ticket record"],
    ["greeting", "identified from the ticket greeting"],
    ["overwrite", "identified from the channel's member permissions"],
  ])("says how the applicant was identified (%s)", (applicantVia, words) => {
    expect(section(render({ applicantVia }), "Artist investigation: #2d-artist-0042")).toContain(words);
  });

  it("says when membership could not be checked", () => {
    const summary = section(
      render({ applicant: applicantContext({ inServer: null, joinedAtMs: null, roles: [] }) }),
      "Artist investigation: #2d-artist-0042"
    );

    expect(summary).toContain("Server membership could not be checked");
    expect(summary).not.toContain("Joined <t:");
    expect(summary).not.toContain("Roles:");
  });

  it("marks an applicant who has left the server", () => {
    const summary = section(
      render({ applicant: applicantContext({ inServer: false, joinedAtMs: null, roles: [] }) }),
      "Artist investigation: #2d-artist-0042"
    );
    expect(summary).toContain("**No longer in the server**");
  });

  it("lists at most 15 roles", () => {
    const roles = Array.from({ length: 20 }, (_, i) => `Role ${i + 1}`);
    const summary = section(render({ applicant: applicantContext({ roles }) }), "Artist investigation: #2d-artist-0042");

    expect(summary).toContain("Role 15");
    expect(summary).not.toContain("Role 16");
  });

  it("covers the applicant facts that are missing or unusual", () => {
    const summary = section(
      render({
        applicant: applicantContext({
          recentMessageCount: null,
          lastSeenAtMs: null,
          gateApplication: null,
          onVerifyBlacklist: null,
        }),
      }),
      "Artist investigation: #2d-artist-0042"
    );

    expect(summary).toContain("Activity: not available");
    expect(summary).toContain("Gate application: none on record");
    expect(summary).toContain("Verify Blacklist: could not be checked");
  });

  it("counts a single message in the singular and leaves out a missing latest date", () => {
    const summary = section(
      render({ applicant: applicantContext({ recentMessageCount: 1, lastSeenAtMs: null }) }),
      "Artist investigation: #2d-artist-0042"
    );

    expect(summary).toContain("Activity: 1 message in the last 90 days\n");
  });

  it("shows a gate application without a submission date", () => {
    const summary = section(
      render({ applicant: applicantContext({ gateApplication: { status: "draft", submittedAt: null } }) }),
      "Artist investigation: #2d-artist-0042"
    );
    expect(summary).toContain("Gate application: draft\n");
  });

  it("lists up to six other tickets", () => {
    const priorTickets = Array.from({ length: 8 }, (_, i) => ({
      name: `2d-artist-000${i + 1}`,
      when: i === 0 ? null : `2026-0${i + 1}-10T09:00:00.000Z`,
      note: i === 0 ? "still open" : "closed: no reply",
      source: "first-party" as const,
    }));
    const summary = section(render({ applicant: applicantContext({ priorTickets }) }), "Artist investigation: #2d-artist-0042");

    expect(summary).toContain(
      "Other 2D artist tickets: 2d-artist-0001, still open; 2d-artist-0002 (opened 2026-02-10), closed: no reply; 2d-artist-0003"
    );
    expect(summary).toContain("2d-artist-0006");
    expect(summary).not.toContain("2d-artist-0007");
  });

  it("says that the date of a Ticket Tool ticket is the day it closed", () => {
    const priorTickets = [
      {
        name: "2d-artist-0300",
        when: "2026-11-09T18:00:00.000Z",
        note: "transcript on file in the ticket log",
        source: "ticket-tool-log" as const,
      },
    ];
    const summary = section(render({ applicant: applicantContext({ priorTickets }) }), "Artist investigation: #2d-artist-0042");

    expect(summary).toContain("Other 2D artist tickets: 2d-artist-0300 (closed 2026-11-09), transcript on file in the ticket log\n");
  });

  it("makes a Verify Blacklist entry stand out, with or without a note", () => {
    const withNote = section(
      render({ applicant: applicantContext({ onVerifyBlacklist: true, blacklistNote: "Traced art in 2025" }) }),
      "Artist investigation: #2d-artist-0042"
    );
    const withoutNote = section(
      render({ applicant: applicantContext({ onVerifyBlacklist: true, blacklistNote: null }) }),
      "Artist investigation: #2d-artist-0042"
    );

    expect(withNote).toContain("**On the Verify Blacklist** (Traced art in 2025)");
    expect(withoutNote).toContain("**On the Verify Blacklist** (no note)");
  });

  it("sums up what was submitted", () => {
    const summary = section(render(), "Artist investigation: #2d-artist-0042");

    expect(summary).toContain(
      [
        "**Submitted** 3 messages in the ticket, 2 from the applicant",
        "Images: 1 posted, 1 analyzed",
        "Files (contents not inspected): none",
        "Links (not opened): 0",
        "Claimed handles: furaffinity: FoxyArtz",
      ].join("\n")
    );
    expect(summary).not.toContain("This ticket is closed.");
  });

  it("counts images over the limit and images that failed to load", () => {
    const summary = section(
      render({
        evidence: ticketEvidence({ images: [image(1), image(2), image(3)], imagesOverCap: [image(4), image(5)] }),
        images: [{ key: "img1", metadataNotes: [] }],
        imageFailures: [
          { key: "img2", name: "piece-2.png", reason: "HTTP 404" },
          { key: "img3", name: "piece-3.png", reason: "not an image" },
        ],
      }),
      "Artist investigation: #2d-artist-0042"
    );

    expect(summary).toContain("Images: 5 posted, 1 analyzed, 2 over the per-run limit, 2 could not be loaded");
  });

  it("names the kinds of files, the link count and the handles the applicant claimed", () => {
    const file = (kind: "video" | "source_file" | "other", name: string) => ({
      messageId: "700000000000000002",
      messageLabel: "m2",
      postedAtMs: T0,
      name,
      contentType: null,
      size: 1000,
      kind,
    });
    const summary = section(
      render({
        evidence: ticketEvidence({
          images: [],
          files: [file("video", "a.mp4"), file("video", "b.mp4"), file("source_file", "c.psd"), file("other", "d.zip")],
          links: ["https://example.com/a", "https://example.com/b"],
          handles: [
            { platform: "furaffinity", handle: "FoxyArtz", origin: "link", url: "https://www.furaffinity.net/user/foxyartz" },
            { platform: "twitter", handle: "foxy_artz", origin: "text", url: null },
            { platform: "discord", handle: "foxyartz", origin: "discord", url: null },
          ],
        }),
        images: [],
        provenance: { matches: [], services: [], omitted: 0 },
      }),
      "Artist investigation: #2d-artist-0042"
    );

    expect(summary).toContain("Images: none posted");
    expect(summary).toContain("Files (contents not inspected): 2 videos, 1 source file, 1 other file");
    expect(summary).toContain("Links (not opened): 2");
    expect(summary).toContain("Claimed handles: furaffinity: FoxyArtz, twitter: foxy\\_artz");
    expect(summary).not.toContain("discord: foxyartz");
  });

  it("says when there are no handles, the ticket is closed or the history is incomplete", () => {
    const summary = section(
      render({
        ticket: { channelName: "2d-artist-closed0042", system: "ticket-tool", closed: true, historyComplete: false },
        evidence: ticketEvidence({ handles: [], messageCount: 1, applicantMessageCount: 1, transcriptTruncated: true }),
      }),
      "Artist investigation: #2d-artist-closed0042"
    );

    expect(summary).toContain("**Submitted** 1 message in the ticket, 1 from the applicant");
    expect(summary).toContain("Claimed handles: none");
    expect(summary).toContain("This ticket is closed.");
    expect(summary).toContain("The channel has more history than was read. The oldest messages are missing.");
    expect(summary).toContain("The transcript was too long to send whole. Messages in the middle were left out.");
  });
});

describe("renderReport: without an AI assessment", () => {
  it.each([
    [{ kind: "skipped" as const, message: "ANTHROPIC_API_KEY is not set, so the model was not asked." }],
    [{ kind: "error" as const, message: "The Claude API could not be reached.", usage: null, mayBeBilled: false }],
    [{ kind: "refused" as const, message: "The model declined to assess this ticket.", usage: USAGE }],
    [{ kind: "truncated" as const, message: "The model's answer was cut off.", usage: USAGE }],
    [{ kind: "invalid" as const, message: "The model's answer could not be read.", usage: USAGE }],
  ])("explains why and keeps the collected facts ($kind)", (analysis) => {
    const pages = render({ analysis });
    const summary = section(pages, "Artist investigation: #2d-artist-0042");

    expect(summary).toContain(`**No AI assessment in this report.** ${analysis.message}`);
    expect(summary).toContain("What was collected from the ticket and the reverse image results are listed below.");
    expect(summary).not.toContain("Score:");
    expect(summary).toContain("**Applicant**");
    expect(titles(pages)).toEqual(["Artist investigation: #2d-artist-0042", "Images", "Reverse image search", "Notes"]);
    expect(section(pages, "Notes")).not.toContain("Cited messages");
    expect(section(pages, "Images")).toBe(`**img1** · [sketch.png](${JUMP}/700000000000000002)`);
  });
});

describe("renderReport: criteria", () => {
  it("shows one block per criterion with the server's own rule text", () => {
    const criteria = section(render(), "Criteria") ?? "";

    for (const criterion of CRITERIA) {
      expect(criteria).toContain(`**${criterion.title}** · partly met · 6/10\nReasoning for ${criterion.key}.\nEvidence: img1, m2\n-# Rules: `);
    }
    expect(criteria).toContain('-# Rules: "3 different WIP/Layers to previous work" (applicant requirements) · ');
    expect(criteria).toContain('"No tracing, AI passing as original, or art theft" (art rules)');
    expect(criteria).toContain('"AI detection triggers" (mod handbook)');
  });

  it("shows a rule quoted from a handbook table without its column bars", () => {
    const criteria = section(render(), "Criteria") ?? "";

    expect(criteria).toContain('"100% AI-generated / Prohibited / Not allowed / Decline Verification" (mod handbook)');
    expect(criteria).not.toContain("| 100% AI-generated |");
  });

  it.each([
    ["met", "met"],
    ["partly_met", "partly met"],
    ["not_met", "not met"],
    ["concern", "concern"],
    ["undetermined", "cannot be determined"],
  ] as const)("writes the rating %s in words", (rating, words) => {
    const base = assessment();
    const criteria = section(
      withAnswerPages({ criteria: base.criteria.map((c, i) => (i === 0 ? { ...c, rating, score: 4 } : c)) }),
      "Criteria"
    );

    expect(criteria).toContain(`**Process evidence** · ${words} · 4/10`);
  });

  it("says no concern found where met would read as if the problem had been found", () => {
    const base = assessment();
    const criteria =
      section(withAnswerPages({ criteria: base.criteria.map((c) => ({ ...c, rating: "met" as const, score: 9 })) }), "Criteria") ?? "";

    expect(criteria).toContain("**AI indicators** · no concern found · 9/10");
    expect(criteria).toContain("**Terms of service** · met · 9/10");
    for (const criterion of CRITERIA) {
      expect(criteria).toContain(`**${criterion.title}** · ${criterion.kind === "risk" ? "no concern found" : "met"} · 9/10`);
    }
  });

  it("keeps the other ratings as they are on a check that looks for a problem", () => {
    const base = assessment();
    const rated = (rating: "concern" | "undetermined") =>
      section(
        withAnswerPages({ criteria: base.criteria.map((c) => (c.key === "ai_indicators" ? { ...c, rating, score: 3 } : c)) }),
        "Criteria"
      );

    expect(rated("concern")).toContain("**AI indicators** · concern · 3/10");
    expect(rated("undetermined")).toContain("**AI indicators** · cannot be determined · 3/10");
  });

  it("leaves the score out when there is none", () => {
    const base = assessment();
    const criteria = section(
      withAnswerPages({
        criteria: base.criteria.map((c, i) => (i === 0 ? { ...c, rating: "undetermined" as const, score: null } : c)),
      }),
      "Criteria"
    );

    expect(criteria).toContain("**Process evidence** · cannot be determined\n");
  });

  it("keeps only the labels that exist in this run", () => {
    const base = assessment();
    const criteria = section(
      withAnswerPages({
        criteria: base.criteria.map((c, i) =>
          i === 0 ? { ...c, evidence: ["IMG1", "img1", "see m2 and p1", "img9", "m44", "p7", "the sketch"] } : c
        ),
      }),
      "Criteria"
    );

    expect(criteria).toContain("**Process evidence** · partly met · 6/10\nReasoning for process_evidence.\nEvidence: img1, m2, p1\n");
  });

  it("says when a criterion cites nothing usable", () => {
    const base = assessment();
    const criteria = section(
      withAnswerPages({ criteria: base.criteria.map((c, i) => (i === 0 ? { ...c, evidence: ["img9", "nothing"] } : c)) }),
      "Criteria"
    );

    expect(criteria).toContain("Reasoning for process_evidence.\nEvidence: none cited\n");
  });
});

describe("renderReport: images", () => {
  it("links each image to its message and adds the model's note", () => {
    expect(section(render(), "Images")).toBe(
      `**img1** · [sketch.png](${JUMP}/700000000000000002) · sketch · AI indicators: none\nA pencil sketch with a signature.`
    );
  });

  it("is left out when the applicant posted no images", () => {
    const pages = render({
      evidence: ticketEvidence({ images: [] }),
      images: [],
      provenance: { matches: [], services: [service({ queries: 0, matches: 0 })], omitted: 0 },
    });

    expect(titles(pages)).not.toContain("Images");
    expect(section(pages, "Reverse image search")).toContain("No images were available to search.");
  });

  it("writes the image role in words and matches the model's label loosely", () => {
    const images = section(
      withAnswerPages({
        image_notes: [{ image: " IMG1 ", role: "layers_screenshot", ai_indicator_strength: "moderate", notes: "Layer panel visible." }],
      }),
      "Images"
    );

    expect(images).toContain("· layers screenshot · AI indicators: moderate\nLayer panel visible.");
  });

  it("shows an image the model said nothing about without a note", () => {
    expect(section(withAnswerPages({ image_notes: [] }), "Images")).toBe(`**img1** · [sketch.png](${JUMP}/700000000000000002)`);
  });

  it("shows what the file's metadata says", () => {
    const images = section(
      render({ images: [{ key: "img1", metadataNotes: ["Software: Krita 5.2", "Created 2026-10-30"] }] }),
      "Images"
    );

    expect(images).toContain("\n-# File metadata: Software: Krita 5.2; Created 2026-10-30");
  });

  it("says why an image was not analyzed and ignores any note for it", () => {
    const images = section(
      render({
        evidence: ticketEvidence({ images: [image(1), image(2)] }),
        images: [{ key: "img1", metadataNotes: [] }],
        imageFailures: [{ key: "img2", name: "piece-2.png", reason: "the download timed out" }],
        analysis: {
          kind: "ok",
          usage: USAGE,
          assessment: assessment({
            image_notes: [
              { image: "img1", role: "finished", ai_indicator_strength: "none", notes: "Clean lines." },
              { image: "img2", role: "finished", ai_indicator_strength: "strong", notes: "Should not be shown." },
            ],
          }),
        },
      }),
      "Images"
    );

    expect(images).toContain(`**img2** · [piece-2.png](${JUMP}/700000000000000003) · not analyzed: the download timed out`);
    expect(images).not.toContain("Should not be shown.");
  });

  it("lists the images that were over the per-run limit", () => {
    const images = section(
      render({ evidence: ticketEvidence({ images: [image(1)], imagesOverCap: [image(2), image(3)] }) }),
      "Images"
    );

    expect(images).toContain(
      `**Not analyzed, over the per-run limit:** [piece-2.png](${JUMP}/700000000000000003), [piece-3.png](${JUMP}/700000000000000004)`
    );
  });
});

describe("renderReport: reverse image search", () => {
  const searched = (services: ServiceReport[]) =>
    section(render({ provenance: { matches: [], services, omitted: 0 } }), "Reverse image search") ?? "";

  it("reports each service by what happened to it", () => {
    const text = searched([
      service({ service: "fluffle", queries: 2, cacheHits: 3, matches: 1 }),
      service({ service: "e621", status: "skipped", detail: "E621_LOGIN and E621_API_KEY are not set", queries: 0, matches: 0 }),
      service({ service: "saucenao", status: "failed", detail: "service error (HTTP 500)", queries: 0, matches: 0 }),
    ]);

    expect(text).toContain(
      [
        "**Services**",
        "Fluffle: ran, 2 lookups (+3 from cache), 1 match",
        "e621: skipped (E621\\_LOGIN and E621\\_API\\_KEY are not set)",
        "SauceNAO: **failed** (service error (HTTP 500))",
      ].join("\n")
    );
  });

  it("marks a service that only finished part of its lookups", () => {
    const text = searched([
      service({ status: "partial", detail: "1 of 2 lookups finished: request timed out", queries: 1, matches: 2 }),
    ]);

    expect(text).toContain("Fluffle: **incomplete** (1 of 2 lookups finished: request timed out); 1 lookup, 2 matches");
  });

  it("falls back to plain words when a service gave no detail", () => {
    const text = searched([
      service({ service: "e621", status: "skipped", queries: 0, matches: 0 }),
      service({ service: "saucenao", status: "failed", queries: 0, matches: 0 }),
    ]);

    expect(text).toContain("e621: skipped (not configured)");
    expect(text).toContain("SauceNAO: **failed** (no detail)");
  });

  it("says when no lookup ran at all", () => {
    expect(searched([])).toContain("**Services**\nNo lookup ran.");
  });

  it("lists a match with its source, similarity, names and date", () => {
    const text = section(
      render({
        provenance: {
          matches: [
            provenanceMatch({
              sourceUrl: "https://www.furaffinity.net/view/12345/",
              similarity: 96.6,
              postedAt: "2024-03-05T10:00:00.000Z",
              artists: ["FoxyArtz"],
              uploader: "FoxyArtz",
            }),
          ],
          services: [service()],
          omitted: 0,
        },
      }),
      "Reverse image search"
    );

    expect(text).toContain(
      [
        "**img1** sketch.png",
        "`p1` [furaffinity](https://www.furaffinity.net/view/12345/) · exact, 97% · artist: FoxyArtz · posted 2024-03-05 · via Fluffle",
        'Name check: under a handle the applicant claimed ("furaffinity: FoxyArtz")',
      ].join("\n")
    );
  });

  it("names the uploader only when it is not one of the artists", () => {
    const text = section(
      render({
        provenance: {
          matches: [
            provenanceMatch({ service: "e621", platform: "e621", artists: ["foxyartz", "collab_pal"], uploader: "reposter99" }),
          ],
          services: [service({ service: "e621" })],
          omitted: 0,
        },
      }),
      "Reverse image search"
    );

    expect(text).toContain("· artist: foxyartz, collab\\_pal · uploader: reposter99 · no post date · via e621");
  });

  it("copes with a match that has no platform, similarity, quality or names", () => {
    const text = section(
      render({
        provenance: {
          matches: [
            provenanceMatch({
              service: "saucenao",
              sourceUrl: "https://example.org/art/1",
              platform: null,
              similarity: null,
              quality: null,
              artists: [],
              uploader: null,
              ownership: "unknown",
              matchedHandle: null,
            }),
          ],
          services: [service({ service: "saucenao" })],
          omitted: 0,
        },
      }),
      "Reverse image search"
    );

    expect(text).toContain("`p1` [SauceNAO](https://example.org/art/1) · no post date · via SauceNAO\n");
    expect(text).toContain("Name check: nothing to compare: no name on the match, or the applicant claimed no handles outside Discord");
  });

  it("makes a match under someone else's name, an early post date and base hints stand out", () => {
    const text = section(
      render({
        provenance: {
          matches: [
            provenanceMatch({
              artists: ["SomeoneElse"],
              uploader: "SomeoneElse",
              ownership: "other",
              matchedHandle: null,
              predatesAccount: true,
              postedAt: "2019-05-01T00:00:00.000Z",
              baseHints: ['Title mentions a base: "F2U wolf base"', "Tagged: base, ych"],
            }),
          ],
          services: [service()],
          omitted: 0,
        },
      }),
      "Reverse image search"
    );

    expect(text).toContain(
      [
        "Name check: **under a different name from every handle the applicant claimed**",
        "**Posted before the applicant's Discord account existed**",
        'Note: Title mentions a base: "F2U wolf base"',
        "Note: Tagged: base, ych",
      ].join("\n")
    );
  });

  it("does not shout about a match that is close to a claimed handle", () => {
    const text = section(
      render({
        provenance: {
          matches: [provenanceMatch({ ownership: "possible", matchedHandle: "furaffinity: FoxyArtz" })],
          services: [service()],
          omitted: 0,
        },
      }),
      "Reverse image search"
    );

    expect(text).toContain('Name check: close to a handle the applicant claimed ("furaffinity: FoxyArtz"), not an exact match');
    expect(text).not.toContain("**Posted before");
  });

  it("numbers matches across images the same way the model saw them, and lists images with no match", () => {
    const text =
      section(
        render({
          evidence: ticketEvidence({ images: [image(1), image(2), image(3)] }),
          images: [1, 2, 3].map((n) => ({ key: `img${n}`, metadataNotes: [] })),
          provenance: {
            matches: [
              provenanceMatch({ imageKey: "img3", sourceUrl: "https://e621.net/posts/1" }),
              provenanceMatch({ imageKey: "img1", sourceUrl: "https://e621.net/posts/2" }),
              provenanceMatch({ imageKey: "img3", sourceUrl: "https://e621.net/posts/3" }),
            ],
            services: [service({ matches: 3 })],
            omitted: 0,
          },
        }),
        "Reverse image search"
      ) ?? "";

    expect(text).toContain("**img1** piece-1.png\n`p2` [furaffinity](https://e621.net/posts/2)");
    expect(text).toMatch(/\*\*img3\*\* piece-3\.png\n`p1` \[furaffinity\]\(https:\/\/e621\.net\/posts\/1\)[^]*\n`p3` \[furaffinity\]\(https:\/\/e621\.net\/posts\/3\)/);
    expect(text.indexOf("**img1** piece-1.png")).toBeLessThan(text.indexOf("**img3** piece-3.png"));
    expect(text).toContain("**No match found:** img2");
  });

  it("warns when the matches for one image name many different artists", () => {
    const strangers = (imageKey: string, count: number) =>
      Array.from({ length: count }, (_, i) =>
        provenanceMatch({ imageKey, artists: [`artist${i}`], uploader: `artist${i}`, ownership: "other", matchedHandle: null })
      );
    const text =
      section(
        render({
          evidence: ticketEvidence({ images: [image(1), image(2)] }),
          images: [1, 2].map((n) => ({ key: `img${n}`, metadataNotes: [] })),
          provenance: {
            matches: [...strangers("img1", 3), ...strangers("img2", 6)],
            services: [service({ matches: 9 })],
            omitted: 0,
          },
        }),
        "Reverse image search"
      ) ?? "";

    expect(text).toContain(
      "**img2** piece-2.png\n-# These matches name 6 different artists. One artwork is rarely posted under that many names, so most of them are probably look-alikes, which is common for text pages and flat line art. Open them before reading anything into a match.\n`p4` "
    );
    expect(text).toContain("**img1** piece-1.png\n`p1` ");
    expect(text.match(/These matches name/g)).toHaveLength(1);
  });

  it("does not count an image that failed to load as searched", () => {
    const text = section(
      render({
        evidence: ticketEvidence({ images: [image(1), image(2)] }),
        images: [{ key: "img1", metadataNotes: [] }],
        imageFailures: [{ key: "img2", name: "piece-2.png", reason: "HTTP 404" }],
        provenance: { matches: [], services: [service({ matches: 0 })], omitted: 0 },
      }),
      "Reverse image search"
    );

    expect(text).toContain("**No match found:** img1\n");
    expect(text).not.toContain("img2");
  });

  it("says how many lower-ranked matches were left out", () => {
    const one = section(render({ provenance: { matches: [], services: [service()], omitted: 1 } }), "Reverse image search");
    const many = section(render({ provenance: { matches: [], services: [service()], omitted: 14 } }), "Reverse image search");

    expect(one).toContain("1 lower-ranked match left out.");
    expect(many).toContain("14 lower-ranked matches left out.");
  });

  it("always ends by saying what a match does and does not prove", () => {
    for (const provenance of [
      { matches: [provenanceMatch()], services: [service()], omitted: 0 },
      { matches: [], services: [], omitted: 0 },
    ]) {
      const text = section(render({ provenance }), "Reverse image search") ?? "";
      expect(text.endsWith("A match under the applicant's handle shows where the art is posted, not who drew it.")).toBe(true);
      expect(text).toContain("-# No match is not proof of originality, and a match is not proof of theft.");
    }
  });
});

describe("renderReport: flags and next steps", () => {
  it("lists flags, the statements check, questions and open points", () => {
    const flags = section(
      withAnswerPages({
        red_flags: [{ flag: "Sudden style/quality jumps between pieces", reasoning: "img1 is far rougher than the gallery.", evidence: ["img1", "p1", "p9"] }],
        green_flags: [{ flag: "Speedpaints", reasoning: "A timelapse file was posted.", evidence: [] }],
        statements_check: [
          { claim: "I drew all of these", assessment: "unverifiable", reasoning: "Nothing ties the files to the account.", evidence: ["m2"] },
        ],
        questions: ["Can you share a timelapse?", "Which program do you use?"],
        cannot_determine: ["Who controls the gallery account."],
      }),
      "Flags and next steps"
    );

    expect(flags).toBe(
      [
        "**Red flags**\n- Sudden style/quality jumps between pieces: img1 is far rougher than the gallery. (img1, p1)",
        "**Green flags**\n- Speedpaints: A timelapse file was posted.",
        '**Statements check**\n- "I drew all of these": unverifiable. Nothing ties the files to the account. (m2)',
        "**What to ask next**\n1. Can you share a timelapse?\n2. Which program do you use?",
        "**Cannot be determined**\n- Who controls the gallery account.",
      ].join("\n\n")
    );
  });

  it("says when the model reported nothing under a heading", () => {
    const flags = section(
      withAnswerPages({ red_flags: [], green_flags: [], statements_check: [], questions: [], cannot_determine: [] }),
      "Flags and next steps"
    );

    expect(flags).toBe(
      ["Red flags", "Green flags", "Statements check", "What to ask next", "Cannot be determined"]
        .map((heading) => `**${heading}**\nNone reported.`)
        .join("\n\n")
    );
  });
});

describe("renderReport: notes", () => {
  it("links the cited messages in order, each one once", () => {
    const base = assessment();
    const messageIds = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`m${i + 1}`, String(700000000000000000n + BigInt(i + 1))])
    );
    const notes = section(
      withAnswerPages(
        {
          criteria: base.criteria.map((c, i) => (i === 0 ? { ...c, evidence: ["m10", "m2", "img1", "m99"] } : { ...c, evidence: [] })),
          red_flags: [{ flag: "DM advertising", reasoning: "Said so.", evidence: ["m3", "m2"] }],
          green_flags: [],
          statements_check: [{ claim: "c", assessment: "supported", reasoning: "r", evidence: ["m1"] }],
        },
        { evidence: ticketEvidence({ messageIds }) }
      ),
      "Notes"
    );

    expect(notes).toContain(
      `**Cited messages**\n[m1](${JUMP}/700000000000000001) · [m2](${JUMP}/700000000000000002) · [m3](${JUMP}/700000000000000003) · [m10](${JUMP}/700000000000000010)`
    );
    expect(notes).not.toContain("m99");
  });

  it("links at most 30 cited messages", () => {
    const base = assessment();
    const labels = Array.from({ length: 40 }, (_, i) => `m${i + 1}`);
    const messageIds = Object.fromEntries(labels.map((label, i) => [label, String(700000000000000000n + BigInt(i + 1))]));
    const notes = section(
      withAnswerPages(
        { criteria: base.criteria.map((c, i) => (i === 0 ? { ...c, evidence: labels } : c)) },
        { evidence: ticketEvidence({ messageIds }) }
      ),
      "Notes"
    );

    expect(notes).toContain("[m30](");
    expect(notes).not.toContain("[m31](");
  });

  it("leaves the cited messages out when the model cited none", () => {
    const base = assessment();
    const notes = section(
      withAnswerPages({ criteria: base.criteria.map((c) => ({ ...c, evidence: ["img1"] })), green_flags: [] }),
      "Notes"
    );

    expect(notes).not.toContain("Cited messages");
  });

  it("always lists the places where the workflow is unclear", () => {
    for (const pages of [render(), render({ analysis: { kind: "skipped", message: "No key." } })]) {
      const notes = section(pages, "Notes") ?? "";
      expect(notes).toContain("**Where the workflow is unclear**");
      for (const gap of WORKFLOW_GAPS) expect(notes).toContain(`- ${gap}`);
    }
  });

  it("says nothing about the requirements when the ticket has no greeting to compare", () => {
    expect(section(render(), "Notes")).not.toContain("Requirement text differs");
  });

  it("says nothing about the requirements when the greeting still carries every line", () => {
    const greetingText = requirementQuotes()
      .map((quote) => `<:paw:123456789012345678> **${quote}**`)
      .join("\n");

    expect(section(render({ evidence: ticketEvidence({ greetingText }) }), "Notes")).not.toContain("Requirement text differs");
  });

  it("names the requirement lines that are missing from this ticket's greeting", () => {
    const quotes = requirementQuotes();
    const greetingText = quotes.slice(1).join("\n");
    const notes = section(render({ evidence: ticketEvidence({ greetingText }) }), "Notes");

    expect(notes).toContain(
      `**Requirement text differs in this ticket**\nThe greeting posted here does not contain these requirement lines, which the criteria were built from:\n- "${quotes[0]}"\nIf the requirements changed, the criteria need the same change.`
    );
  });

  it("lists the checks that could not run", () => {
    const notes = section(
      render({
        evidence: ticketEvidence({ images: [image(1), image(2)] }),
        applicant: applicantContext({ gaps: ["Ticket log could not be read, so their other Ticket Tool tickets are unknown (Missing Access)."] }),
        imageFailures: [{ key: "img2", name: "piece_2.png", reason: "HTTP 404" }],
      }),
      "Notes"
    );

    expect(notes).toContain(
      [
        "**Checks that could not run**",
        "- Ticket log could not be read, so their other Ticket Tool tickets are unknown (Missing Access).",
        '- img2 "piece\\_2.png" could not be loaded: HTTP 404.',
      ].join("\n")
    );
  });

  it("has no such heading when every check ran", () => {
    expect(section(render(), "Notes")).not.toContain("Checks that could not run");
  });
});

describe("renderReport: text that did not come from us", () => {
  it("breaks masked links in the model's prose", () => {
    const base = assessment();
    const pages = withAnswerPages({
      overall_summary: "See [the proof](https://evil.example/a) for more.",
      confidence_reason: "[here](https://evil.example/b)",
      criteria: base.criteria.map((c) => ({ ...c, reasoning: "Fine, per [this](https://evil.example/c)." })),
      image_notes: [{ image: "img1", role: "sketch", ai_indicator_strength: "none", notes: "[x](https://evil.example/d)" }],
      red_flags: [{ flag: "[f](https://evil.example/e)", reasoning: "[r](https://evil.example/f)", evidence: [] }],
      green_flags: [{ flag: "[f](https://evil.example/g)", reasoning: "[r](https://evil.example/h)", evidence: [] }],
      statements_check: [{ claim: "[c](https://evil.example/i)", assessment: "supported", reasoning: "[r](https://evil.example/j)", evidence: [] }],
      questions: ["[q](https://evil.example/k)"],
      cannot_determine: ["[d](https://evil.example/l)"],
    });
    const text = everything(pages);

    expect(text).toContain("See [the proof] (https://evil.example/a) for more.");
    expect(text).not.toContain("](https://evil.example");
    expect(linkTargets(text).filter((target) => target?.includes("evil.example"))).toEqual([]);
  });

  it("puts the model's prose in plain punctuation", () => {
    const [enDash, emDash, openSingle, closeSingle, openDouble, closeDouble] = [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d].map(
      (code) => String.fromCharCode(code)
    );
    const base = assessment();
    const text = everything(
      withAnswerPages({
        overall_summary: `Sketches img1${enDash}img3 show process ${emDash} the rest do not.`,
        confidence_reason: `Posted 2019 ${enDash} 2021${emDash}before the account existed.`,
        criteria: base.criteria.map((c) => ({
          ...c,
          reasoning: `The applicant${closeSingle}s ${openDouble}ToS${closeDouble} is a client${enDash}artist agreement ${enDash} nothing more.`,
        })),
        questions: [`In 2021 ${enDash} the year of img2 ${enDash} did you post a ${openSingle}timelapse${closeSingle}?`],
      })
    );

    expect(text).toContain("Sketches img1 to img3 show process, the rest do not.");
    expect(text).toContain("Posted 2019 to 2021, before the account existed.");
    expect(text).toContain(`The applicant's "ToS" is a client-artist agreement, nothing more.`);
    expect(text).toContain("In 2021, the year of img2, did you post a 'timelapse'?");
    for (const mark of [enDash, emDash, openSingle, closeSingle, openDouble, closeDouble]) expect(text).not.toContain(mark);
  });

  it("breaks a masked link in the reason given for a missing assessment", () => {
    const text = everything(
      render({ analysis: { kind: "refused", message: "Declined: [details](https://evil.example/x)", usage: USAGE } })
    );

    expect(text).toContain("**No AI assessment in this report.** Declined: [details] (https://evil.example/x)");
  });

  it("escapes markdown and masked links in text taken from the ticket, the files and the server", () => {
    const pages = render({
      evidence: ticketEvidence({
        images: [image(1, { name: "my [final](https://evil.example/n) **art**.png" })],
        imagesOverCap: [image(2, { name: "[over](https://evil.example/o).png" })],
      }),
      images: [{ key: "img1", metadataNotes: ["Software: [Krita](https://evil.example/m)"] }],
      applicant: applicantContext({
        roles: ["**Bold** role", "[role](https://evil.example/r)"],
        onVerifyBlacklist: true,
        blacklistNote: "see [this](https://evil.example/b)",
        gaps: ["Server membership could not be read ([oops](https://evil.example/g))."],
      }),
      provenance: { matches: [], services: [service({ status: "failed", detail: "[retry](https://evil.example/s)" })], omitted: 0 },
    });
    const text = everything(pages);

    expect(text).toContain(`[my final(https://evil.example/n) \\*\\*art\\*\\*.png](${JUMP}/700000000000000002)`);
    expect(text).toContain("Roles: \\*\\*Bold\\*\\* role, \\[role](https://evil.example/r)");
    expect(text).toContain("-# File metadata: Software: \\[Krita](https://evil.example/m)");
    expect(text).toContain("**On the Verify Blacklist** (see \\[this](https://evil.example/b))");
    expect(text).toContain("Fluffle: **failed** (\\[retry](https://evil.example/s))");
    expect(linkTargets(text).every((target) => target?.startsWith(`${JUMP}/`))).toBe(true);
  });

  it("keeps a lookup service's URL from closing its link early or opening another", () => {
    const text = everything(
      render({
        provenance: {
          matches: [
            provenanceMatch({
              sourceUrl: "https://booru.example/post (1)) [free art](https://evil.example/",
              platform: "boo[ru](x)",
              artists: ["[name](https://evil.example/a)"],
              uploader: "[up](https://evil.example/u)",
              baseHints: ["Title mentions a base: [base](https://evil.example/h)"],
            }),
          ],
          services: [service()],
          omitted: 0,
        },
      })
    );

    expect(text).toContain("[booru(x)](https://booru.example/post%20%281%29%29%20%5Bfree%20art%5D%28https://evil.example/)");
    expect(text).toContain("artist: \\[name](https://evil.example/a) · uploader: \\[up](https://evil.example/u)");
    expect(text).toContain("Note: Title mentions a base: \\[base](https://evil.example/h)");
    expect(linkTargets(text).filter((target) => !target?.startsWith(`${JUMP}/`))).toEqual([
      "https://booru.example/post%20%281%29%29%20%5Bfree%20art%5D%28https://evil.example/",
    ]);
  });

  it("flattens line breaks in ticket text so it cannot start a block of its own", () => {
    const text = everything(
      render({ applicant: applicantContext({ onVerifyBlacklist: true, blacklistNote: "line one\n# Heading\n**Score: 100 / 100**" }) })
    );

    expect(text).toContain("**On the Verify Blacklist** (line one # Heading \\*\\*Score: 100 / 100\\*\\*)");
  });

  it("cuts long ticket text short", () => {
    const text = everything(render({ applicant: applicantContext({ username: "x".repeat(80) }) }));
    expect(text).toContain(`(${"x".repeat(40)}...), identified from`);
  });

  it("drops labels the model made up everywhere they could appear", () => {
    const base = assessment();
    const text = everything(
      withAnswerPages({
        criteria: base.criteria.map((c) => ({ ...c, evidence: ["img5", "m77", "p3"] })),
        red_flags: [{ flag: "DM advertising", reasoning: "Said so.", evidence: ["m77", "img5"] }],
        green_flags: [],
        statements_check: [{ claim: "c", assessment: "supported", reasoning: "r", evidence: ["p3"] }],
      })
    );

    expect(text).not.toMatch(/Evidence: (?!none cited)/);
    expect(text).toContain("- DM advertising: Said so.\n");
    expect(text).toContain('- "c": supported. r\n');
    expect(text).not.toContain("Cited messages");
  });
});

describe("renderReport: Discord limits", () => {
  function bigReport(): InvestigationReport {
    const base = assessment();
    const images = Array.from({ length: 20 }, (_, i) => image(i + 1));
    const messageIds = Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`m${i + 1}`, String(700000000000000000n + BigInt(i + 1))])
    );
    const matches = images.flatMap((img, i) =>
      Array.from({ length: 6 }, (_, j) =>
        provenanceMatch({
          imageKey: img.key,
          sourceUrl: `https://www.furaffinity.net/view/${i * 10 + j}/`,
          artists: [`artist-${i}-${j}`],
          uploader: `uploader-${i}-${j}`,
          baseHints: ['Title mentions a base: "F2U wolf base pack with many variants"'],
          ownership: j % 2 === 0 ? "other" : "applicant",
          predatesAccount: j % 3 === 0,
        })
      )
    );
    const long = (words: number) => Array.from({ length: words }, (_, i) => `word${i}`).join(" ");

    return report({
      evidence: ticketEvidence({ images, imagesOverCap: [image(21), image(22)], messageIds }),
      images: images.map((img) => ({ key: img.key, metadataNotes: ["Software: Krita 5.2", "Comment: exported for web"] })),
      applicant: applicantContext({ gaps: Array.from({ length: 6 }, (_, i) => `Gap number ${i + 1} could not be read.`) }),
      provenance: { matches, services: [service({ queries: 40, matches: 120 })], omitted: 37 },
      analysis: {
        kind: "ok",
        usage: USAGE,
        assessment: assessment({
          overall_summary: long(400),
          criteria: base.criteria.map((c) => ({ ...c, reasoning: long(250), evidence: ["img1", "m2", "p1", "m40"] })),
          image_notes: images.map((img) => ({
            image: img.key,
            role: "finished" as const,
            ai_indicator_strength: "weak" as const,
            notes: long(60),
          })),
          red_flags: Array.from({ length: 9 }, (_, i) => ({ flag: `Red flag ${i + 1}`, reasoning: long(80), evidence: ["img2"] })),
          green_flags: Array.from({ length: 5 }, (_, i) => ({ flag: `Green flag ${i + 1}`, reasoning: long(80), evidence: ["m3"] })),
          questions: Array.from({ length: 10 }, (_, i) => `Question ${i + 1}: ${long(30)}?`),
          cannot_determine: Array.from({ length: 8 }, (_, i) => `Open point ${i + 1}: ${long(30)}.`),
        }),
      },
    });
  }

  it("keeps every embed and every message inside Discord's limits on a very long report", () => {
    const pages = renderReport(bigReport());
    const embeds = embedsOf(pages);

    expect(pages.length).toBeGreaterThan(5);
    for (const embed of embeds) {
      expect(embed.description?.length).toBeGreaterThan(0);
      expect(embed.description?.length).toBeLessThanOrEqual(3900);
      expect(embed.title?.length).toBeLessThanOrEqual(256);
      expect(embed.footer?.text.length ?? 0).toBeLessThanOrEqual(2048);
    }
    for (const page of pages) {
      expect(page.embeds.length).toBeGreaterThan(0);
      expect(page.embeds.length).toBeLessThanOrEqual(10);
      expect(page.embeds.reduce((sum, embed) => sum + embedChars(embed), 0)).toBeLessThanOrEqual(6000);
    }
  });

  it("loses nothing when it splits: every image, match and criterion is still there", () => {
    const pages = renderReport(bigReport());
    const text = everything(pages);

    for (let n = 1; n <= 20; n++) expect(text).toContain(`**img${n}** · [piece-${n}.png]`);
    for (let n = 1; n <= 120; n++) expect(text).toContain(`\`p${n}\` [furaffinity]`);
    for (const criterion of CRITERIA) expect(text).toContain(`**${criterion.title}** · partly met · 6/10`);
    expect(text).toContain("37 lower-ranked matches left out.");
    expect(text).toContain("10. Question 10:");
  });

  it("marks continuation embeds and keeps one footer at the very end", () => {
    const pages = renderReport(bigReport());
    const embeds = embedsOf(pages);
    const names = embeds.map((embed) => embed.title);

    expect(names).toContain("Criteria (continued)");
    expect(names).toContain("Reverse image search (continued)");
    expect(names.indexOf("Criteria")).toBeLessThan(names.indexOf("Criteria (continued)"));
    expect(embeds.filter((embed) => embed.footer)).toHaveLength(1);
    expect(embeds.at(-1)?.footer?.text).toContain("Month: $12.50 of $200.00 cap");
    expect(embeds.at(-1)?.title).toMatch(/^Notes/);
  });

  it("still fits when the model writes one enormous unbroken string", () => {
    const base = assessment();
    const pages = withAnswerPages({
      overall_summary: "x".repeat(15_000),
      criteria: base.criteria.map((c, i) => (i === 0 ? { ...c, reasoning: "y".repeat(9_000) } : c)),
    });

    for (const page of pages) {
      expect(page.embeds.length).toBeLessThanOrEqual(10);
      expect(page.embeds.reduce((sum, embed) => sum + embedChars(embed), 0)).toBeLessThanOrEqual(6000);
      for (const embed of page.embeds) expect(embed.description?.length).toBeLessThanOrEqual(3900);
    }
    expect(everything(pages).replace(/[^x]/g, "").length).toBeGreaterThanOrEqual(15_000);
  });

  it("uses no more messages than the limits force", () => {
    for (const pages of [render(), renderReport(bigReport())]) {
      for (let i = 1; i < pages.length; i++) {
        const previous = pages[i - 1]?.embeds ?? [];
        const next = pages[i]?.embeds[0];
        const merged = previous.reduce((sum, embed) => sum + embedChars(embed), 0) + (next ? embedChars(next) : 0);
        expect(merged > 5800 || previous.length >= 10).toBe(true);
      }
    }
    expect(embedsOf(render())).toHaveLength(6);
    expect(render({ analysis: { kind: "skipped", message: "No key." } })).toHaveLength(1);
  });
});

function withAnswerPages(overrides: Partial<Assessment>, rest: Partial<InvestigationReport> = {}): ReportPage[] {
  return renderReport(withAnswer(overrides, rest));
}
