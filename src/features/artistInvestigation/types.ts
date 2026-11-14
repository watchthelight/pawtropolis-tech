/**
 * Pawtropolis Tech -- src/features/artistInvestigation/types.ts
 * WHAT: Shared shapes for /investigate-artist.
 * WHY: The collector, the lookup services, the model call and the renderer are
 *      separate modules that pass the same evidence around. Plain data types keep
 *      every stage testable without Discord objects.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

export interface TicketAttachment {
  id: string;
  name: string;
  url: string;
  contentType: string | null;
  size: number;
  width: number | null;
  height: number | null;
}

interface TicketEmbed {
  type: string | null;
  title: string | null;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
}

/** A Discord message reduced to what the investigation reads. */
export interface TicketMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorIsBot: boolean;
  createdAtMs: number;
  content: string;
  attachments: TicketAttachment[];
  embeds: TicketEmbed[];
}

export interface CollectedImage {
  /** Stable label used in the report and in the model prompt: img1, img2, ... */
  key: string;
  messageId: string;
  /** Transcript label of the message it was posted in: m1, m2, ... */
  messageLabel: string;
  postedAtMs: number;
  name: string;
  url: string;
  contentType: string | null;
  size: number;
  width: number | null;
  height: number | null;
  source: "attachment" | "embed";
}

export type FileKind = "video" | "source_file" | "other";

export interface CollectedFile {
  messageId: string;
  messageLabel: string;
  postedAtMs: number;
  name: string;
  contentType: string | null;
  size: number;
  kind: FileKind;
}

export interface ClaimedHandle {
  platform: string;
  handle: string;
  /** Where the claim came from: a profile link, an @name in text, or the Discord account itself. */
  origin: "link" | "text" | "discord";
  url: string | null;
}

export interface TicketEvidence {
  applicantId: string;
  messageCount: number;
  applicantMessageCount: number;
  firstMessageAtMs: number | null;
  lastMessageAtMs: number | null;
  images: CollectedImage[];
  /** Images past the per-run cap. Listed in the report, never analyzed. */
  imagesOverCap: CollectedImage[];
  files: CollectedFile[];
  links: string[];
  handles: ClaimedHandle[];
  /** Transcript label to Discord message id, for jump links in the report. */
  messageIds: Record<string, string>;
  /** Text of the first bot message (the ticket greeting), embeds included. */
  greetingText: string;
  /** Plain-text transcript, oldest first, trimmed to a budget. */
  transcript: string;
  transcriptTruncated: boolean;
}

export type ProvenanceServiceName = "fluffle" | "e621" | "saucenao";
export type ImageVariant = "original" | "mirrored";

/** One hit from a lookup service, before it is compared with the applicant. */
export interface RawMatch {
  service: ProvenanceServiceName;
  sourceUrl: string;
  platform: string | null;
  /** The account that posted it, when the service reports one. */
  uploader: string | null;
  /** Every creator name the service attaches to the post (artist tags, author names). */
  artists: string[];
  /** ISO 8601 date when the service reports one. */
  postedAt: string | null;
  /** 0 to 100. */
  similarity: number | null;
  quality: "exact" | "probable" | "unlikely" | null;
  title: string | null;
  tags: string[];
  /** Other places the post says the art came from. */
  relatedUrls: string[];
}

export type Ownership = "applicant" | "possible" | "other" | "unknown";

export interface ProvenanceMatch extends RawMatch {
  imageKey: string;
  variant: ImageVariant;
  ownership: Ownership;
  /** Which claimed handle matched, when one did. */
  matchedHandle: string | null;
  /** True when the post date is earlier than the applicant's Discord account. Null when no date. */
  predatesAccount: boolean | null;
  baseHints: string[];
}

type ServiceStatus = "ok" | "partial" | "skipped" | "failed";

export interface ServiceReport {
  service: ProvenanceServiceName;
  status: ServiceStatus;
  /** Why it was skipped or what failed. Never contains a credential. */
  detail: string | null;
  queries: number;
  cacheHits: number;
  matches: number;
}

export interface ProvenanceResult {
  /** Best first. The report labels them p1, p2, ... in this order. */
  matches: ProvenanceMatch[];
  services: ServiceReport[];
  /** Lower-ranked matches dropped by the per-image cap. */
  omitted: number;
}

/** A submitted image that could not be downloaded or decoded. */
export interface ImageFailure {
  key: string;
  name: string;
  /** Short, safe to show. */
  reason: string;
}

export interface TicketFacts {
  channelName: string;
  system: "first-party" | "ticket-tool";
  closed: boolean;
  /** False when the channel has more history than the page cap allowed. */
  historyComplete: boolean;
}

export interface PriorTicket {
  name: string;
  /** ISO 8601 time the record refers to (opened for first-party, closed for Ticket Tool). */
  when: string | null;
  note: string;
  source: "first-party" | "ticket-tool-log";
}

export interface ApplicantContext {
  userId: string;
  username: string;
  globalName: string | null;
  nickname: string | null;
  accountCreatedAtMs: number;
  joinedAtMs: number | null;
  /** True, false, or null when membership could not be checked. */
  inServer: boolean | null;
  roles: string[];
  /** Messages recorded for this member in the activity table, which keeps 90 days. Null when unread. */
  recentMessageCount: number | null;
  lastSeenAtMs: number | null;
  gateApplication: { status: string; submittedAt: string | null } | null;
  priorTickets: PriorTicket[];
  /** True, false, or null when the blacklist thread could not be read. */
  onVerifyBlacklist: boolean | null;
  blacklistNote: string | null;
  /** Checks that could not run, in plain words. */
  gaps: string[];
}

/** An image ready for a lookup service or the model. */
export interface PreparedImage {
  key: string;
  sha256: string;
  /** Downscaled bytes for the model. */
  modelBytes: Buffer;
  modelMediaType: "image/jpeg" | "image/png";
  modelWidth: number;
  modelHeight: number;
  /** Downscaled bytes for lookup services (smaller limits than the model). */
  lookupBytes: Buffer;
  lookupMirroredBytes: Buffer;
  lookupMediaType: "image/jpeg" | "image/png";
  originalWidth: number;
  originalHeight: number;
  /** Software or generator strings found in the file metadata, if any. */
  metadataNotes: string[];
}
