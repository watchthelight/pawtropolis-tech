/**
 * Pawtropolis Tech -- src/features/artistInvestigation/render.ts
 * WHAT: Turns a finished investigation into Discord embeds, split across as
 *       many private messages as the content needs.
 * WHY: A full report is far longer than one embed. Discord allows 4096
 *      characters per description, 10 embeds and 6000 characters per message, so
 *      the text is cut at line breaks and packed under those limits. Matches,
 *      links and counts come from the collected data, never from the model, so
 *      a wrong model answer cannot invent a source.
 * DOCS:
 *  - https://discord.com/developers/docs/resources/message#embed-object-embed-limits
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { escapeMarkdown, type APIEmbed } from "discord.js";
import { describeAge, describeOwnership, matchLabel, type AnalysisOutcome, type Assessment, type Rating } from "./analysis.js";
import { formatFooter, type TokenUsage } from "./budget.js";
import { CRITERIA, WORKFLOW_GAPS, displayRule, findRequirementDrift, type WorkflowSource } from "./criteria.js";
import { scatteredImages } from "./handles.js";
import type {
  ApplicantContext,
  ImageFailure,
  ProvenanceMatch,
  ProvenanceResult,
  ProvenanceServiceName,
  TicketEvidence,
  TicketFacts,
} from "./types.js";

interface RunCost {
  model: string;
  usage: TokenUsage;
  runUsd: number;
  /** Tracked spend for the calendar month, this run included. */
  monthUsd: number;
  capUsd: number;
  /** Token counts never came back, so the run was counted at its worst-case estimate. */
  worstCase: boolean;
  /** False when the run could not be written to the usage ledger. */
  ledgerSaved: boolean;
}

export type ApplicantSource = "option" | "ticket" | "greeting" | "overwrite";

export interface InvestigationReport {
  guildId: string;
  channelId: string;
  ticket: TicketFacts;
  applicantVia: ApplicantSource;
  evidence: TicketEvidence;
  applicant: ApplicantContext;
  /** Images that were downloaded and decoded, with what their files say about themselves. */
  images: Array<{ key: string; metadataNotes: string[] }>;
  imageFailures: ImageFailure[];
  provenance: ProvenanceResult;
  analysis: AnalysisOutcome | { kind: "skipped"; message: string };
  cost: RunCost;
}

export interface ReportPage {
  embeds: APIEmbed[];
}

const COLOR = 0x5b6ee1;
/** Under Discord's 4096 so a title and a footer always fit beside it. */
const DESCRIPTION_LIMIT = 3900;
/** Under Discord's 6000 characters across all embeds of one message. */
const MESSAGE_LIMIT = 5800;
const EMBEDS_PER_MESSAGE = 10;

const SERVICE_NAMES: Record<ProvenanceServiceName, string> = { fluffle: "Fluffle", e621: "e621", saucenao: "SauceNAO" };

const RATING_WORDS: Record<Rating, string> = {
  met: "met",
  partly_met: "partly met",
  not_met: "not met",
  concern: "concern",
  undetermined: "cannot be determined",
};

const SOURCE_NAMES: Record<WorkflowSource, string> = {
  requirements: "applicant requirements",
  handbook: "mod handbook",
  art_rules: "art rules",
};

const VIA_WORDS: Record<ApplicantSource, string> = {
  option: "the `applicant` option",
  ticket: "the ticket record",
  greeting: "the ticket greeting",
  overwrite: "the channel's member permissions",
};

interface Section {
  title: string;
  /** Units of text that are kept whole where they fit. */
  blocks: string[];
}

const discordDate = (ms: number) => `<t:${Math.floor(ms / 1000)}:D>`;
const plural = (count: number, word: string, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;

/** Text from the ticket or a lookup service, made safe to sit inside our own formatting. */
const safe = (text: string, max = 100) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return escapeMarkdown(flat.length > max ? `${flat.slice(0, max)}...` : flat, { maskedLink: true });
};
const linkText = (text: string, max = 60) => safe(text.replace(/[[\]]/g, ""), max);
/** A lookup service's URL as a link target. Nothing in it can close the link early or open another one. */
const linkTarget = (url: string) =>
  url.trim().replace(/[\s()[\]<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);
/** An en dash between two numbers or labels: img1 to img3, 2019 to 2021. */
const RANGE_DASH = new RegExp(`(?<=\\d)\\s*${EN_DASH}\\s*(?=[a-z]*\\d)`, "gi");
/** A dash standing in for a pause: an em dash, or an en dash with space around it. */
const PAUSE_DASH = new RegExp(`\\s*${EM_DASH}\\s*|\\s+${EN_DASH}\\s+`, "g");
const CURLY_SINGLE = new RegExp(`[${String.fromCharCode(0x2018, 0x2019)}]`, "g");
const CURLY_DOUBLE = new RegExp(`[${String.fromCharCode(0x201c, 0x201d)}]`, "g");

/**
 * Model prose keeps its light formatting but cannot carry a masked link, and
 * reads in plain punctuation whatever the model typed.
 */
const prose = (text: string) =>
  text
    .replace(/\]\(/g, "] (")
    .replace(RANGE_DASH, " to ")
    .replace(PAUSE_DASH, ", ")
    .replaceAll(EN_DASH, "-")
    .replace(CURLY_SINGLE, "'")
    .replace(CURLY_DOUBLE, '"')
    .trim();

/** Cut one over-long block at line breaks, then spaces, so every piece fits. */
function splitLong(text: string, limit: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const at = cut > limit / 2 ? cut : limit;
    pieces.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

export function paginate(blocks: string[], limit: number = DESCRIPTION_LIMIT): string[] {
  const pages: string[] = [];
  let current = "";
  for (const block of blocks.flatMap((b) => splitLong(b, limit))) {
    const joined = current ? `${current}\n\n${block}` : block;
    if (joined.length > limit) {
      pages.push(current);
      current = block;
    } else {
      current = joined;
    }
  }
  if (current) pages.push(current);
  return pages;
}

const embedSize = (embed: APIEmbed) =>
  (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text.length ?? 0);

function pack(embeds: APIEmbed[]): ReportPage[] {
  const pages: ReportPage[] = [];
  let current: APIEmbed[] = [];
  let total = 0;
  for (const embed of embeds) {
    const size = embedSize(embed);
    if (current.length > 0 && (total + size > MESSAGE_LIMIT || current.length >= EMBEDS_PER_MESSAGE)) {
      pages.push({ embeds: current });
      current = [];
      total = 0;
    }
    current.push(embed);
    total += size;
  }
  if (current.length > 0) pages.push({ embeds: current });
  return pages;
}

/** Labels the model cited, reduced to the ones that exist in this run. */
function citedLabels(raw: string[], known: Set<string>): string[] {
  const found = raw.flatMap((entry) => entry.toLowerCase().match(/\b(?:img|m|p)\d+\b/g) ?? []);
  return [...new Set(found)].filter((label) => known.has(label));
}

function applicantBlock(report: InvestigationReport): string {
  const { applicant, evidence } = report;
  const referenceMs = evidence.firstMessageAtMs ?? Date.now();
  const lines = [
    `**Applicant** <@${applicant.userId}> (${safe(applicant.username, 40)}), identified from ${VIA_WORDS[report.applicantVia]}`,
    `Account created ${discordDate(applicant.accountCreatedAtMs)}, ${describeAge(applicant.accountCreatedAtMs, referenceMs)} before the ticket`,
  ];

  if (applicant.inServer === null) lines.push("Server membership could not be checked");
  else if (!applicant.inServer) lines.push("**No longer in the server**");
  else if (applicant.joinedAtMs !== null) {
    lines.push(`Joined ${discordDate(applicant.joinedAtMs)}, ${describeAge(applicant.joinedAtMs, referenceMs)} before the ticket`);
  }

  if (applicant.roles.length > 0) lines.push(`Roles: ${applicant.roles.slice(0, 15).map((r) => safe(r, 30)).join(", ")}`);
  lines.push(
    applicant.recentMessageCount === null
      ? "Activity: not available"
      : `Activity: ${plural(applicant.recentMessageCount, "message")} in the last 90 days` +
          (applicant.lastSeenAtMs ? `, latest ${discordDate(applicant.lastSeenAtMs)}` : "")
  );
  lines.push(
    applicant.gateApplication
      ? `Gate application: ${safe(applicant.gateApplication.status, 30)}` +
          (applicant.gateApplication.submittedAt ? `, submitted ${applicant.gateApplication.submittedAt.slice(0, 10)}` : "")
      : "Gate application: none on record"
  );
  lines.push(
    applicant.priorTickets.length === 0
      ? "Earlier 2D artist tickets: none found"
      : `Earlier 2D artist tickets: ${applicant.priorTickets
          .slice(0, 6)
          .map((t) => `${safe(t.name, 30)}${t.when ? ` (${t.when.slice(0, 10)})` : ""}: ${safe(t.note, 80)}`)
          .join("; ")}`
  );
  lines.push(
    applicant.onVerifyBlacklist === null
      ? "Verify Blacklist: could not be checked"
      : applicant.onVerifyBlacklist
        ? `**On the Verify Blacklist** (${safe(applicant.blacklistNote ?? "no note", 200)})`
        : "Verify Blacklist: not listed"
  );
  return lines.join("\n");
}

function submittedBlock(report: InvestigationReport): string {
  const { evidence, ticket } = report;
  const posted = evidence.images.length + evidence.imagesOverCap.length;
  const kinds = { video: 0, source_file: 0, other: 0 };
  for (const file of evidence.files) kinds[file.kind]++;
  const files = [
    kinds.video > 0 ? plural(kinds.video, "video") : null,
    kinds.source_file > 0 ? plural(kinds.source_file, "source file") : null,
    kinds.other > 0 ? plural(kinds.other, "other file") : null,
  ].filter(Boolean);
  const handles = evidence.handles.filter((h) => h.origin !== "discord");

  const lines = [
    `**Submitted** ${plural(evidence.messageCount, "message")} in the ticket, ${evidence.applicantMessageCount} from the applicant`,
    posted === 0
      ? "Images: none posted"
      : `Images: ${posted} posted, ${report.images.length} analyzed` +
        (evidence.imagesOverCap.length > 0 ? `, ${evidence.imagesOverCap.length} over the per-run limit` : "") +
        (report.imageFailures.length > 0 ? `, ${report.imageFailures.length} could not be loaded` : ""),
    `Files (contents not inspected): ${files.length > 0 ? files.join(", ") : "none"}`,
    `Links (not opened): ${evidence.links.length}`,
    `Claimed handles: ${handles.length > 0 ? handles.slice(0, 12).map((h) => `${safe(h.platform, 20)}: ${safe(h.handle, 40)}`).join(", ") : "none"}`,
  ];
  if (ticket.closed) lines.push("This ticket is closed.");
  if (!ticket.historyComplete) lines.push("The channel has more history than was read. The oldest messages are missing.");
  if (evidence.transcriptTruncated) lines.push("The transcript was too long to send whole. Messages in the middle were left out.");
  return lines.join("\n");
}

function summarySection(report: InvestigationReport): Section {
  const { analysis } = report;
  const blocks = [
    "**Advisory only.** These are indicators with reasoning, not a verdict. Stolen, traced and AI-generated art cannot be detected reliably. Nothing was posted in the ticket and no action was taken.",
  ];
  if (analysis.kind === "ok") {
    const a = analysis.assessment;
    blocks.push(`**Score: ${a.overall_score} / 100** · confidence: ${a.confidence}\n${prose(a.confidence_reason)}`);
    blocks.push(prose(a.overall_summary));
  } else {
    blocks.push(
      `**No AI assessment in this report.** ${prose(analysis.message)}\nWhat was collected from the ticket and the reverse image results are listed below.`
    );
  }
  blocks.push(applicantBlock(report), submittedBlock(report));
  return { title: `Artist investigation: #${report.ticket.channelName}`, blocks };
}

function criteriaSection(assessment: Assessment, known: Set<string>): Section {
  const blocks = assessment.criteria.map((entry) => {
    const criterion = CRITERIA.find((c) => c.key === entry.key);
    const cited = citedLabels(entry.evidence, known);
    const rules = (criterion?.rules ?? []).map((r) => `"${displayRule(r.text)}" (${SOURCE_NAMES[r.source]})`).join(" · ");
    return [
      `**${criterion?.title ?? entry.key}** · ${RATING_WORDS[entry.rating]}${entry.score === null ? "" : ` · ${entry.score}/10`}`,
      prose(entry.reasoning),
      `Evidence: ${cited.length > 0 ? cited.join(", ") : "none cited"}`,
      `-# Rules: ${rules}`,
    ].join("\n");
  });
  return { title: "Criteria", blocks };
}

function imagesSection(report: InvestigationReport, jump: (messageId: string) => string): Section | null {
  const { evidence } = report;
  if (evidence.images.length + evidence.imagesOverCap.length === 0) return null;

  const notes = report.analysis.kind === "ok" ? report.analysis.assessment.image_notes : [];
  const failed = new Map(report.imageFailures.map((f) => [f.key, f.reason]));
  const blocks = evidence.images.map((image) => {
    const head = `**${image.key}** · [${linkText(image.name)}](${jump(image.messageId)})`;
    const failure = failed.get(image.key);
    if (failure) return `${head} · not analyzed: ${safe(failure, 200)}`;

    const note = notes.find((n) => n.image.toLowerCase().trim() === image.key);
    const metadata = report.images.find((i) => i.key === image.key)?.metadataNotes ?? [];
    return [
      note ? `${head} · ${note.role.replace(/_/g, " ")} · AI indicators: ${note.ai_indicator_strength}` : head,
      ...(note ? [prose(note.notes)] : []),
      ...(metadata.length > 0 ? [`-# File metadata: ${metadata.map((m) => safe(m, 220)).join("; ")}`] : []),
    ].join("\n");
  });

  if (evidence.imagesOverCap.length > 0) {
    blocks.push(
      `**Not analyzed, over the per-run limit:** ${evidence.imagesOverCap
        .map((image) => `[${linkText(image.name, 40)}](${jump(image.messageId)})`)
        .join(", ")}`
    );
  }
  return { title: "Images", blocks };
}

function matchBlock(match: ProvenanceMatch, index: number): string {
  const head = [
    `\`${matchLabel(index)}\` [${linkText(match.platform ?? SERVICE_NAMES[match.service], 30)}](${linkTarget(match.sourceUrl)})`,
    [match.quality, match.similarity === null ? null : `${Math.round(match.similarity)}%`].filter(Boolean).join(", "),
    match.artists.length > 0 ? `artist: ${safe(match.artists.slice(0, 3).join(", "), 60)}` : null,
    match.uploader && !match.artists.includes(match.uploader) ? `uploader: ${safe(match.uploader, 40)}` : null,
    match.postedAt ? `posted ${match.postedAt.slice(0, 10)}` : "no post date",
    `via ${SERVICE_NAMES[match.service]}`,
  ];
  const ownership =
    match.ownership === "other" ? `**${describeOwnership(match)}**` : safe(describeOwnership(match), 160);
  const lines = [head.filter(Boolean).join(" · "), `Name check: ${ownership}`];
  if (match.predatesAccount) lines.push("**Posted before the applicant's Discord account existed**");
  lines.push(...match.baseHints.map((hint) => `Note: ${safe(hint, 160)}`));
  return lines.join("\n");
}

function provenanceSection(report: InvestigationReport): Section {
  const { provenance, evidence } = report;
  const services = provenance.services.map((s) => {
    const name = SERVICE_NAMES[s.service];
    const counts = `${plural(s.queries, "lookup")}${s.cacheHits > 0 ? ` (+${s.cacheHits} from cache)` : ""}, ${plural(s.matches, "match", "matches")}`;
    const detail = safe(s.detail ?? (s.status === "skipped" ? "not configured" : "no detail"), 240);
    if (s.status === "skipped") return `${name}: skipped (${detail})`;
    if (s.status === "failed") return `${name}: **failed** (${detail})`;
    if (s.status === "partial") return `${name}: **incomplete** (${detail}); ${counts}`;
    return `${name}: ran, ${counts}`;
  });
  const blocks = [`**Services**\n${services.length > 0 ? services.join("\n") : "No lookup ran."}`];

  const analyzed = evidence.images.filter((image) => report.images.some((i) => i.key === image.key));
  const scattered = scatteredImages(provenance.matches);
  for (const image of analyzed) {
    const matches = provenance.matches
      .map((match, index) => ({ match, index }))
      .filter(({ match }) => match.imageKey === image.key);
    if (matches.length === 0) continue;
    const artists = scattered.get(image.key);
    blocks.push(
      [
        `**${image.key}** ${safe(image.name, 60)}`,
        artists
          ? `-# These matches name ${artists} different artists. One artwork is rarely posted under that many names, so most of them are probably look-alikes, which is common for text pages and flat line art. Open them before reading anything into a match.`
          : null,
        ...matches.map(({ match, index }) => matchBlock(match, index)),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  const matched = new Set(provenance.matches.map((m) => m.imageKey));
  const unmatched = analyzed.filter((image) => !matched.has(image.key)).map((image) => image.key);
  if (analyzed.length === 0) blocks.push("No images were available to search.");
  else if (unmatched.length > 0) blocks.push(`**No match found:** ${unmatched.join(", ")}`);
  if (provenance.omitted > 0) blocks.push(`${plural(provenance.omitted, "lower-ranked match", "lower-ranked matches")} left out.`);

  blocks.push(
    "-# No match is not proof of originality, and a match is not proof of theft. Mirrored copies are searched where a service allows it. Crops and recolors are found only when a service's own matching tolerates them. A match under the applicant's handle shows where the art is posted, not who drew it."
  );
  return { title: "Reverse image search", blocks };
}

function findingsSection(assessment: Assessment, known: Set<string>): Section {
  const cite = (labels: string[]) => {
    const cited = citedLabels(labels, known);
    return cited.length > 0 ? ` (${cited.join(", ")})` : "";
  };
  const list = (items: string[]) => (items.length > 0 ? items.join("\n") : "None reported.");

  return {
    title: "Flags and next steps",
    blocks: [
      `**Red flags**\n${list(assessment.red_flags.map((f) => `- ${prose(f.flag)}: ${prose(f.reasoning)}${cite(f.evidence)}`))}`,
      `**Green flags**\n${list(assessment.green_flags.map((f) => `- ${prose(f.flag)}: ${prose(f.reasoning)}${cite(f.evidence)}`))}`,
      `**Statements check**\n${list(
        assessment.statements_check.map((s) => `- "${prose(s.claim)}": ${s.assessment}. ${prose(s.reasoning)}${cite(s.evidence)}`)
      )}`,
      `**What to ask next**\n${list(assessment.questions.map((q, i) => `${i + 1}. ${prose(q)}`))}`,
      `**Cannot be determined**\n${list(assessment.cannot_determine.map((c) => `- ${prose(c)}`))}`,
    ],
  };
}

function notesSection(report: InvestigationReport, citedMessages: string[], jump: (messageId: string) => string): Section {
  const blocks: string[] = [];

  if (citedMessages.length > 0) {
    const links = citedMessages
      .slice(0, 30)
      .map((label) => `[${label}](${jump(report.evidence.messageIds[label] ?? "")})`)
      .join(" · ");
    blocks.push(`**Cited messages**\n${links}`);
  }

  blocks.push(`**Where the workflow is unclear**\n${WORKFLOW_GAPS.map((gap) => `- ${gap}`).join("\n")}`);

  const drift = findRequirementDrift(report.evidence.greetingText);
  if (drift.length > 0) {
    blocks.push(
      `**Requirement text differs in this ticket**\nThe greeting posted here does not contain these requirement lines, which the criteria were built from:\n${drift
        .map((line) => `- "${line}"`)
        .join("\n")}\nIf the requirements changed, the criteria need the same change.`
    );
  }

  const gaps = [
    ...report.applicant.gaps,
    ...report.imageFailures.map((f) => `${f.key} "${f.name}" could not be loaded: ${f.reason}.`),
  ];
  if (gaps.length > 0) blocks.push(`**Checks that could not run**\n${gaps.map((gap) => `- ${safe(gap, 300)}`).join("\n")}`);

  return { title: "Notes", blocks };
}

export function renderReport(report: InvestigationReport): ReportPage[] {
  const jump = (messageId: string) => `https://discord.com/channels/${report.guildId}/${report.channelId}/${messageId}`;
  const known = new Set<string>([
    ...report.evidence.images.map((image) => image.key),
    ...Object.keys(report.evidence.messageIds),
    ...report.provenance.matches.map((_, index) => matchLabel(index)),
  ]);

  const sections: Array<Section | null> = [summarySection(report)];
  let citedMessages: string[] = [];
  if (report.analysis.kind === "ok") {
    const a = report.analysis.assessment;
    sections.push(criteriaSection(a, known));
    const everything = [
      ...a.criteria.flatMap((c) => c.evidence),
      ...a.red_flags.flatMap((f) => f.evidence),
      ...a.green_flags.flatMap((f) => f.evidence),
      ...a.statements_check.flatMap((s) => s.evidence),
    ];
    citedMessages = citedLabels(everything, known)
      .filter((label) => label.startsWith("m"))
      .sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
  }
  sections.push(imagesSection(report, jump), provenanceSection(report));
  if (report.analysis.kind === "ok") sections.push(findingsSection(report.analysis.assessment, known));
  sections.push(notesSection(report, citedMessages, jump));

  const embeds = sections
    .filter((section): section is Section => section !== null)
    .flatMap((section) =>
      paginate(section.blocks).map<APIEmbed>((description, page) => ({
        title: page === 0 ? section.title : `${section.title} (continued)`,
        description,
        color: COLOR,
      }))
    );

  const last = embeds[embeds.length - 1];
  if (last) {
    const notes = [
      formatFooter(report.cost),
      report.cost.worstCase ? "token counts never came back, so this run is counted at its worst case" : null,
      report.cost.ledgerSaved ? null : "this run could not be saved to the usage ledger, so later totals will miss it",
    ];
    last.footer = { text: notes.filter(Boolean).join(" · ") };
  }
  return pack(embeds);
}
