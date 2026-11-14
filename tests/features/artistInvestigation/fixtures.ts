// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/artistInvestigation/fixtures.ts
 * WHAT: Builders for the plain data /investigate-artist passes between stages.
 * WHY: Every stage takes the same shapes (messages, matches, settings). One set
 *      of builders keeps the tests short and keeps made-up IDs in one place.
 *      Nothing here comes from a real ticket.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate084ArtistInvestigation } from "../../../migrations/084_artist_investigation.js";
import type { Assessment } from "../../../src/features/artistInvestigation/analysis.js";
import type { InvestigationSettings } from "../../../src/features/artistInvestigation/config.js";
import { CRITERIA } from "../../../src/features/artistInvestigation/criteria.js";
import type {
  ApplicantContext,
  PreparedImage,
  ProvenanceMatch,
  RawMatch,
  TicketAttachment,
  TicketEvidence,
  TicketMessage,
} from "../../../src/features/artistInvestigation/types.js";

export const APPLICANT_ID = "400000000000000001";
export const STAFF_ID = "400000000000000002";
export const OTHER_MEMBER_ID = "400000000000000003";
export const BOT_ID = "400000000000000009";
export const GUILD_ID = "300000000000000001";
export const CHANNEL_ID = "500000000000000001";

/** 2026-11-01 12:00 UTC. */
export const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);

/** An in-memory database with the ledger and the lookup cache from migration 084. */
export function memoryDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.exec(
    `CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, name TEXT, applied_at INTEGER DEFAULT (strftime('%s','now')));`
  );
  migrate084ArtistInvestigation(db);
  return db;
}

/**
 * An in-memory database with the bot's whole schema. Foreign keys are off so a
 * test can insert the few rows it needs without their parent rows.
 */
export function schemaDb(): InstanceType<typeof Database> {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  db.exec(readFileSync(path.join("tests", "fixtures", "schema.sql"), "utf8"));
  return db;
}

export function settings(overrides: Partial<InvestigationSettings> = {}): InvestigationSettings {
  return {
    anthropicApiKey: "test-key",
    anthropicWorkspaceId: null,
    model: "claude-opus-5-5",
    monthlyCapUsd: 200,
    maxImages: 12,
    sauceNaoApiKey: null,
    e621Login: null,
    e621ApiKey: null,
    userAgent: "test-agent/1.0",
    ...overrides,
  };
}

export function attachment(overrides: Partial<TicketAttachment> = {}): TicketAttachment {
  return {
    id: "600000000000000001",
    name: "sketch.png",
    url: "https://cdn.discordapp.com/attachments/1/2/sketch.png?ex=abc&is=def",
    contentType: "image/png",
    size: 250_000,
    width: 1200,
    height: 900,
    ...overrides,
  };
}

let nextMessage = 0;

/** A ticket message. Ids count up so that later calls are later messages. */
export function message(overrides: Partial<TicketMessage> = {}): TicketMessage {
  nextMessage++;
  return {
    id: String(700000000000000000n + BigInt(nextMessage)),
    authorId: APPLICANT_ID,
    authorName: "foxyartz",
    authorIsBot: false,
    createdAtMs: T0 + nextMessage * 60_000,
    content: "",
    attachments: [],
    embeds: [],
    ...overrides,
  };
}

export function rawMatch(overrides: Partial<RawMatch> = {}): RawMatch {
  return {
    service: "fluffle",
    sourceUrl: "https://www.furaffinity.net/view/12345/",
    platform: "furaffinity",
    uploader: "FoxyArtz",
    artists: ["FoxyArtz"],
    postedAt: null,
    similarity: 97,
    quality: "exact",
    title: null,
    tags: [],
    relatedUrls: [],
    ...overrides,
  };
}

export function provenanceMatch(overrides: Partial<ProvenanceMatch> = {}): ProvenanceMatch {
  return {
    ...rawMatch(),
    imageKey: "img1",
    variant: "original",
    ownership: "applicant",
    matchedHandle: "furaffinity: FoxyArtz",
    predatesAccount: false,
    baseHints: [],
    ...overrides,
  };
}

export function preparedImage(key: string, overrides: Partial<PreparedImage> = {}): PreparedImage {
  return {
    key,
    sha256: `sha-${key}`,
    modelBytes: Buffer.from(`model-${key}`),
    modelMediaType: "image/jpeg",
    modelWidth: 1568,
    modelHeight: 1176,
    lookupBytes: Buffer.from(`lookup-${key}`),
    lookupMirroredBytes: Buffer.from(`mirrored-${key}`),
    lookupMediaType: "image/jpeg",
    originalWidth: 3000,
    originalHeight: 2250,
    metadataNotes: [],
    ...overrides,
  };
}

export function applicantContext(overrides: Partial<ApplicantContext> = {}): ApplicantContext {
  return {
    userId: APPLICANT_ID,
    username: "foxyartz",
    globalName: "Foxy",
    nickname: null,
    accountCreatedAtMs: Date.UTC(2023, 0, 15),
    joinedAtMs: Date.UTC(2025, 5, 1),
    inServer: true,
    roles: ["Member"],
    recentMessageCount: 42,
    lastSeenAtMs: T0 - 86_400_000,
    gateApplication: { status: "approved", submittedAt: "2025-06-01T10:00:00.000Z" },
    priorTickets: [],
    onVerifyBlacklist: false,
    blacklistNote: null,
    gaps: [],
    ...overrides,
  };
}

export function ticketEvidence(overrides: Partial<TicketEvidence> = {}): TicketEvidence {
  return {
    applicantId: APPLICANT_ID,
    messageCount: 3,
    applicantMessageCount: 2,
    firstMessageAtMs: T0,
    lastMessageAtMs: T0 + 3_600_000,
    images: [
      {
        key: "img1",
        messageId: "700000000000000002",
        messageLabel: "m2",
        postedAtMs: T0 + 60_000,
        name: "sketch.png",
        url: "https://cdn.discordapp.com/attachments/1/2/sketch.png",
        contentType: "image/png",
        size: 250_000,
        width: 1200,
        height: 900,
        source: "attachment",
      },
    ],
    imagesOverCap: [],
    files: [],
    links: [],
    handles: [
      {
        platform: "furaffinity",
        handle: "FoxyArtz",
        origin: "link",
        url: "https://www.furaffinity.net/user/foxyartz",
      },
    ],
    messageIds: { m1: "700000000000000001", m2: "700000000000000002", m3: "700000000000000003" },
    greetingText: "",
    transcript:
      "[m1] 2026-11-01 12:00 UTC | BOT (Ticket Tool): Hello\n[m2] 2026-11-01 12:01 UTC | APPLICANT (foxyartz): here is my art",
    transcriptTruncated: false,
    ...overrides,
  };
}

/** A complete, valid model answer: one entry per criterion. */
export function assessment(overrides: Partial<Assessment> = {}): Assessment {
  return {
    overall_score: 72,
    overall_summary: "The applicant posted one sketch with a matching gallery upload.",
    confidence: "medium",
    confidence_reason: "Only one image was submitted.",
    criteria: CRITERIA.map((criterion) => ({
      key: criterion.key,
      rating: "partly_met" as const,
      score: 6,
      reasoning: `Reasoning for ${criterion.key}.`,
      evidence: ["img1", "m2"],
    })),
    image_notes: [
      {
        image: "img1",
        role: "sketch",
        ai_indicator_strength: "none",
        notes: "A pencil sketch with a signature.",
      },
    ],
    red_flags: [],
    green_flags: [
      {
        flag: "Voluntary sharing of WIPs/process",
        reasoning: "A sketch was posted unprompted.",
        evidence: ["img1"],
      },
    ],
    statements_check: [],
    questions: ["Can you share a timelapse?"],
    cannot_determine: ["Whether the applicant controls the linked gallery."],
    ...overrides,
  };
}
