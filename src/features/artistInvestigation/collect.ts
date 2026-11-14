/**
 * Pawtropolis Tech -- src/features/artistInvestigation/collect.ts
 * WHAT: Reads a ticket's full history and sorts what the applicant posted into
 *       images, other files, links, claimed handles and a labeled transcript.
 * WHY: Everything later in the run (lookups, the model, the report) cites
 *      evidence by label (m4, img2). Building those labels once, from plain
 *      data, keeps the citations checkable and the logic testable.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { LIMITS } from "./config.js";
import { dedupeHandles, extractHandles, extractUrls } from "./handles.js";
import type {
  ClaimedHandle,
  CollectedFile,
  CollectedImage,
  FileKind,
  TicketAttachment,
  TicketEvidence,
  TicketMessage,
} from "./types.js";

/** The parts of a discord.js Message this module reads. A real Message fits it. */
export interface RawMessage {
  id: string;
  author: { id: string; username: string; bot: boolean; globalName?: string | null };
  member?: { displayName: string } | null;
  createdTimestamp: number;
  content: string;
  attachments: { values(): Iterable<TicketAttachment> };
  embeds: ReadonlyArray<{
    data: { type?: string };
    title: string | null;
    description: string | null;
    url: string | null;
    image: { url: string; proxyURL?: string } | null;
    thumbnail: { url: string; proxyURL?: string } | null;
  }>;
}

export interface HistoryChannel {
  messages: {
    fetch(options: { limit: number; before?: string }): Promise<{ values(): Iterable<RawMessage> }>;
  };
}

const PAGE_SIZE = 100;

export function toTicketMessage(raw: RawMessage): TicketMessage {
  return {
    id: raw.id,
    authorId: raw.author.id,
    authorName: raw.member?.displayName ?? raw.author.globalName ?? raw.author.username,
    authorIsBot: raw.author.bot,
    createdAtMs: raw.createdTimestamp,
    content: raw.content ?? "",
    attachments: [...raw.attachments.values()].map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      contentType: a.contentType ?? null,
      size: a.size,
      width: a.width ?? null,
      height: a.height ?? null,
    })),
    embeds: raw.embeds.map((e) => {
      const type = e.data.type ?? null;
      // A pasted image link becomes an "image" embed whose picture sits in `thumbnail`.
      const asset = type === "image" ? (e.thumbnail ?? e.image) : (e.image ?? null);
      return {
        type,
        title: e.title ?? null,
        description: e.description ?? null,
        url: e.url ?? null,
        imageUrl: asset ? (asset.proxyURL ?? asset.url) : null,
      };
    }),
  };
}

const olderFirst = (a: { id: string }, b: { id: string }) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1);

/**
 * Every message in the channel, oldest first. `complete` is false only when the
 * page cap was reached before the start of the channel.
 */
export async function fetchTicketHistory(
  channel: HistoryChannel,
  maxPages: number = LIMITS.maxHistoryPages
): Promise<{ messages: TicketMessage[]; complete: boolean }> {
  const all: TicketMessage[] = [];
  let before: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const batch = [
      ...(
        await channel.messages.fetch(before ? { limit: PAGE_SIZE, before } : { limit: PAGE_SIZE })
      ).values(),
    ];
    all.push(...batch.map(toTicketMessage));
    if (batch.length < PAGE_SIZE) return { messages: all.sort(olderFirst), complete: true };
    before = [...batch].sort(olderFirst)[0]?.id;
  }
  return { messages: all.sort(olderFirst), complete: false };
}

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "webp",
  "gif",
  "avif",
  "tif",
  "tiff",
]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v", "wmv", "flv"]);
const SOURCE_EXTENSIONS = new Set([
  "psd",
  "psb",
  "clip",
  "csp",
  "sai",
  "sai2",
  "kra",
  "ora",
  "procreate",
  "xcf",
  "mdp",
  "afphoto",
  "afdesign",
  "pdn",
  "tvpp",
  "rif",
  "ipv",
]);

const extensionOf = (name: string): string =>
  name.split("?")[0]?.split(".").pop()?.toLowerCase() ?? "";

function isImage(att: TicketAttachment): boolean {
  if (att.contentType?.startsWith("image/svg")) return false;
  if (att.contentType?.startsWith("image/"))
    return IMAGE_EXTENSIONS.has(extensionOf(att.name)) || !att.name.includes(".");
  return !att.contentType && IMAGE_EXTENSIONS.has(extensionOf(att.name));
}

export function classifyFile(att: Pick<TicketAttachment, "name" | "contentType">): FileKind {
  const ext = extensionOf(att.name);
  if (att.contentType?.startsWith("video/") || VIDEO_EXTENSIONS.has(ext)) return "video";
  if (SOURCE_EXTENSIONS.has(ext)) return "source_file";
  return "other";
}

const DISCORD_MEDIA_HOST =
  /^https?:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net|images-ext-\d+\.discordapp\.net)\//i;

const utcStamp = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + " UTC";

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)} [cut]` : text;

/** Keep the head and the tail when the transcript is over budget: the requirements and first submissions sit at the top, the latest answers at the bottom. */
function fitTranscript(lines: string[], budget: number): { text: string; truncated: boolean } {
  const full = lines.join("\n");
  if (full.length <= budget) return { text: full, truncated: false };

  const head: string[] = [];
  const tail: string[] = [];
  let headSize = 0;
  let tailSize = 0;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo <= hi) {
    const first = lines[lo] ?? "";
    const last = lines[hi] ?? "";
    if (headSize <= tailSize * 0.7 && headSize + first.length + tailSize < budget) {
      head.push(first);
      headSize += first.length + 1;
      lo++;
    } else if (headSize + tailSize + last.length < budget) {
      tail.unshift(last);
      tailSize += last.length + 1;
      hi--;
    } else {
      break;
    }
  }
  const omitted = hi - lo + 1;
  return {
    text: [
      ...head,
      `[... ${omitted} message${omitted === 1 ? "" : "s"} left out to fit the size limit ...]`,
      ...tail,
    ].join("\n"),
    truncated: true,
  };
}

export interface EvidenceOptions {
  maxImages: number;
  /** The applicant's Discord username, global name and server nickname. */
  identityNames: string[];
}

export function buildEvidence(
  messages: TicketMessage[],
  applicantId: string,
  options: EvidenceOptions
): TicketEvidence {
  const images: CollectedImage[] = [];
  const files: CollectedFile[] = [];
  const links: string[] = [];
  const handles: ClaimedHandle[] = [];
  const messageIds: Record<string, string> = {};
  const lines: string[] = [];
  const seenImageUrls = new Set<string>();
  let applicantMessageCount = 0;
  let greetingText = "";

  messages.forEach((msg, index) => {
    const label = `m${index + 1}`;
    messageIds[label] = msg.id;
    const isApplicant = msg.authorId === applicantId;
    const speaker = msg.authorIsBot ? "BOT" : isApplicant ? "APPLICANT" : "MEMBER";
    const notes: string[] = [];

    if (msg.authorIsBot && !greetingText) {
      greetingText = [msg.content, ...msg.embeds.map((e) => e.description ?? "")].join("\n");
    }

    if (isApplicant) {
      applicantMessageCount++;
      for (const att of msg.attachments) {
        if (isImage(att)) {
          const dedupeKey = att.url.split("?")[0] ?? att.url;
          if (seenImageUrls.has(dedupeKey)) continue;
          seenImageUrls.add(dedupeKey);
          const key = `img${images.length + 1}`;
          images.push({
            key,
            messageId: msg.id,
            messageLabel: label,
            postedAtMs: msg.createdAtMs,
            name: att.name,
            url: att.url,
            contentType: att.contentType,
            size: att.size,
            width: att.width,
            height: att.height,
            source: "attachment",
          });
          notes.push(
            `${key} (image "${att.name}"${att.width && att.height ? `, ${att.width}x${att.height}` : ""})`
          );
        } else {
          const kind = classifyFile(att);
          files.push({
            messageId: msg.id,
            messageLabel: label,
            postedAtMs: msg.createdAtMs,
            name: att.name,
            contentType: att.contentType,
            size: att.size,
            kind,
          });
          notes.push(
            `${kind === "source_file" ? "source file" : kind === "video" ? "video" : "file"} "${att.name}" (${megabytes(att.size)}, contents not inspected)`
          );
        }
      }
      for (const embed of msg.embeds) {
        if (embed.type !== "image" || !embed.imageUrl) continue;
        const dedupeKey = (embed.url ?? embed.imageUrl).split("?")[0] ?? embed.imageUrl;
        if (seenImageUrls.has(dedupeKey)) continue;
        seenImageUrls.add(dedupeKey);
        const key = `img${images.length + 1}`;
        const name = decodeURIComponent(
          (embed.url ?? embed.imageUrl).split("?")[0]?.split("/").pop() ?? "linked image"
        );
        images.push({
          key,
          messageId: msg.id,
          messageLabel: label,
          postedAtMs: msg.createdAtMs,
          name,
          url: embed.imageUrl,
          contentType: null,
          size: 0,
          width: null,
          height: null,
          source: "embed",
        });
        notes.push(`${key} (linked image "${name}")`);
      }
      for (const url of extractUrls(msg.content)) {
        if (!DISCORD_MEDIA_HOST.test(url) && !links.includes(url)) links.push(url);
      }
      handles.push(...extractHandles(msg.content));
    } else if (msg.attachments.length > 0) {
      notes.push(
        `${msg.attachments.length} attachment${msg.attachments.length === 1 ? "" : "s"} (not part of the application)`
      );
    }

    const embedText = msg.authorIsBot
      ? msg.embeds
          .map((e) => [e.title, e.description].filter(Boolean).join(": "))
          .filter(Boolean)
          .join(" / ")
      : "";
    const body =
      clip([msg.content.trim(), embedText].filter(Boolean).join(" "), LIMITS.messageChars) ||
      "(no text)";
    lines.push(
      `[${label}] ${utcStamp(msg.createdAtMs)} | ${speaker} (${msg.authorName}): ${body}` +
        (notes.length > 0 ? `\n      attached: ${notes.join("; ")}` : "")
    );
  });

  for (const name of options.identityNames) {
    if (name.trim())
      handles.push({ platform: "discord", handle: name.trim(), origin: "discord", url: null });
  }

  const transcript = fitTranscript(lines, LIMITS.transcriptChars);
  return {
    applicantId,
    messageCount: messages.length,
    applicantMessageCount,
    firstMessageAtMs: messages[0]?.createdAtMs ?? null,
    lastMessageAtMs: messages[messages.length - 1]?.createdAtMs ?? null,
    images: images.slice(0, options.maxImages),
    imagesOverCap: images.slice(options.maxImages),
    files,
    links,
    handles: dedupeHandles(handles),
    messageIds,
    greetingText,
    transcript: transcript.text,
    transcriptTruncated: transcript.truncated,
  };
}
