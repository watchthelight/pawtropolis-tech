/**
 * Pawtropolis Tech -- src/features/artistInvestigation/run.ts
 * WHAT: One investigation from start to finish: read the ticket, gather what the
 *       server knows, fetch the images, check the budget, run the lookups, ask
 *       the model and record the cost.
 * WHY: Each stage can fail on its own (an unreadable image, a dead lookup site,
 *      an API error). The run keeps whatever worked and says what did not. It
 *      only reads from Discord: the caller shows the result privately, and
 *      nothing here posts, edits or changes anything in the server.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";
import type { Guild } from "discord.js";
import { logger } from "../../lib/logger.js";
import { analyzeTicket, buildPromptText, promptChars } from "./analysis.js";
import {
  NO_USAGE,
  checkBudget,
  costUsd,
  estimateCostUsd,
  formatUsd,
  getMonthSpendUsd,
  imageTokens,
  recordRun,
} from "./budget.js";
import { buildEvidence, fetchTicketHistory, type HistoryChannel } from "./collect.js";
import { LIMITS, TICKET_TOOL_BOT_ID, type InvestigationSettings } from "./config.js";
import { fetchImageBytes, prepareImage } from "./images.js";
import { pruneCache } from "./provenance/cache.js";
import { LOOKUP_SERVICES, runProvenance } from "./provenance/index.js";
import type { InvestigationReport } from "./render.js";
import { UNKNOWN_USERNAME, gatherApplicantContext } from "./serverContext.js";
import { resolveApplicant } from "./ticketContext.js";
import type { ImageFailure, PreparedImage, ProvenanceResult, TicketFacts } from "./types.js";

export interface RunInput {
  guild: Guild;
  channel: HistoryChannel & { id: string; name: string };
  ticket: { system: "first-party" | "ticket-tool"; openerId: string | null; closed: boolean };
  /** The `applicant` option, when the owner supplied one. */
  overrideApplicantId: string | null;
  /** Users with their own permission overwrite on the channel. */
  memberOverwriteIds: string[];
  botUserId: string;
  invokedBy: string;
  /** Private status line for the owner. Must not throw. */
  onProgress: (text: string) => Promise<void>;
}

export interface RunDeps {
  db: Database;
  settings: InvestigationSettings;
  now?: () => number;
  fetchImage?: typeof fetchImageBytes;
  prepare?: typeof prepareImage;
  lookups?: typeof runProvenance;
  analyze?: typeof analyzeTicket;
  context?: typeof gatherApplicantContext;
}

export type RunResult = { ok: true; report: InvestigationReport } | { ok: false; message: string };

/** Room in the cost estimate for one lookup match line and for the output schema. */
const MATCH_LINE_CHARS = 450;
const SCHEMA_CHARS = 6_000;

const shortReason = (err: unknown) =>
  (err instanceof Error ? err.message : "unknown error").replace(/\s+/g, " ").slice(0, 120);

async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Lookups are paced per service and the monthly total is read before spending,
// so two runs at once would break both. The owner is the only caller anyway.
let running = false;

export async function runInvestigation(input: RunInput, deps: RunDeps): Promise<RunResult> {
  if (running)
    return {
      ok: false,
      message: "An investigation is already running. Try again when it finishes.",
    };
  running = true;
  try {
    return await investigate(input, deps);
  } finally {
    running = false;
  }
}

async function investigate(input: RunInput, deps: RunDeps): Promise<RunResult> {
  const { db, settings } = deps;
  const now = deps.now ?? Date.now;
  const startedMs = now();
  const willAskModel = settings.anthropicApiKey !== null;

  let monthSpend: number;
  try {
    monthSpend = getMonthSpendUsd(db, now());
    pruneCache(db, now());
  } catch {
    return {
      ok: false,
      message:
        "The usage ledger could not be read, so nothing was run and nothing was spent. Check that migration 084 has been applied.",
    };
  }
  if (willAskModel && settings.monthlyCapUsd <= 0) {
    return {
      ok: false,
      message: "This command is switched off: INVESTIGATE_MONTHLY_CAP_USD is set to 0.",
    };
  }
  if (willAskModel && monthSpend >= settings.monthlyCapUsd) {
    return {
      ok: false,
      message:
        `Monthly cap reached. Tracked spend this month is ${formatUsd(monthSpend)} of the ${formatUsd(settings.monthlyCapUsd)} cap ` +
        `(INVESTIGATE_MONTHLY_CAP_USD). The total resets at the start of next month (UTC).`,
    };
  }

  await input.onProgress("Reading the ticket...");
  let history: Awaited<ReturnType<typeof fetchTicketHistory>>;
  try {
    history = await fetchTicketHistory(input.channel);
  } catch (err) {
    logger.warn(
      { evt: "investigate_artist_history_failed", problem: shortReason(err) },
      "[investigate-artist] ticket history not readable"
    );
    return {
      ok: false,
      message: `The messages in this ticket could not be read (${shortReason(err)}). Nothing was run and nothing was spent.`,
    };
  }
  const who = resolveApplicant({
    overrideUserId: input.overrideApplicantId,
    ticketOpenerId: input.ticket.openerId,
    greetingContent:
      history.messages.find((m) => m.authorId === TICKET_TOOL_BOT_ID)?.content ?? null,
    memberOverwriteIds: input.memberOverwriteIds,
    excludeIds: [TICKET_TOOL_BOT_ID, input.botUserId],
  });
  if (!who.ok) return { ok: false, message: who.reason };

  const applicant = await (deps.context ?? gatherApplicantContext)({
    guild: input.guild,
    applicantId: who.userId,
    channelId: input.channel.id,
    channelName: input.channel.name,
    db,
  });
  const evidence = buildEvidence(history.messages, who.userId, {
    maxImages: settings.maxImages,
    identityNames: [applicant.username, applicant.globalName, applicant.nickname].filter(
      (name): name is string => typeof name === "string" && name !== UNKNOWN_USERNAME
    ),
  });
  if (evidence.applicantMessageCount === 0) {
    return {
      ok: false,
      message:
        `<@${who.userId}> has not posted anything in this ticket yet, so there is nothing to review. ` +
        "If someone else is the applicant, run it again with the `applicant` option.",
    };
  }

  const ticket: TicketFacts = {
    channelName: input.channel.name,
    system: input.ticket.system,
    closed: input.ticket.closed,
    historyComplete: history.complete,
  };

  const fetchImage = deps.fetchImage ?? fetchImageBytes;
  const prepare = deps.prepare ?? prepareImage;
  const prepared: PreparedImage[] = [];
  const imageFailures: ImageFailure[] = [];
  if (evidence.images.length > 0) {
    await input.onProgress(
      `Fetching ${evidence.images.length} image${evidence.images.length === 1 ? "" : "s"}...`
    );
    await eachLimited(evidence.images, LIMITS.imageConcurrency, async (image) => {
      try {
        prepared.push(await prepare(image.key, await fetchImage(image.url)));
      } catch (err) {
        imageFailures.push({ key: image.key, name: image.name, reason: shortReason(err) });
      }
    });
    const order = new Map(evidence.images.map((image, index) => [image.key, index]));
    prepared.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
  }

  const noLookups: ProvenanceResult = { matches: [], services: [], omitted: 0 };
  const base = { settings, ticket, evidence, applicant, images: prepared, imageFailures };
  const estimateUsd = willAskModel
    ? estimateCostUsd(settings.model, {
        imageTokens: prepared.reduce(
          (sum, image) => sum + imageTokens(image.modelWidth, image.modelHeight),
          0
        ),
        textChars:
          promptChars(buildPromptText({ ...base, provenance: noLookups })) +
          prepared.length * LIMITS.matchesPerQuery * MATCH_LINE_CHARS +
          SCHEMA_CHARS,
        maxOutputTokens: LIMITS.maxOutputTokens,
      })
    : 0;
  const budget = checkBudget(settings.monthlyCapUsd, monthSpend, estimateUsd);
  if (willAskModel && !budget.allowed) return { ok: false, message: budget.reason };

  await input.onProgress(
    prepared.length > 0
      ? `Checking ${prepared.length} image${prepared.length === 1 ? "" : "s"} against the lookup services...`
      : "No images to look up. Moving on..."
  );
  let provenance: ProvenanceResult;
  try {
    provenance = await (deps.lookups ?? runProvenance)(
      prepared,
      { settings, handles: evidence.handles, accountCreatedAtMs: applicant.accountCreatedAtMs },
      { db, now }
    );
  } catch (err) {
    logger.error(
      { evt: "investigate_artist_lookups_failed", problem: shortReason(err) },
      "[investigate-artist] lookup stage failed"
    );
    provenance = {
      matches: [],
      services: LOOKUP_SERVICES.map((service) => ({
        service: service.name,
        status: "failed" as const,
        detail: "the lookup stage stopped on an unexpected error",
        queries: 0,
        cacheHits: 0,
        matches: 0,
      })),
      omitted: 0,
    };
  }

  let analysis: InvestigationReport["analysis"];
  if (!willAskModel) {
    analysis = {
      kind: "skipped",
      message: "ANTHROPIC_API_KEY is not set, so the model was not asked.",
    };
  } else {
    await input.onProgress("Asking the model. This can take a few minutes...");
    try {
      analysis = await (deps.analyze ?? analyzeTicket)({ ...base, provenance });
    } catch (err) {
      logger.error(
        { evt: "investigate_artist_analysis_failed", problem: shortReason(err) },
        "[investigate-artist] model stage failed"
      );
      analysis = {
        kind: "error",
        message: "The model call failed unexpectedly.",
        usage: null,
        mayBeBilled: true,
      };
    }
  }

  const usage = analysis.kind === "skipped" || analysis.usage === null ? NO_USAGE : analysis.usage;
  const worstCase = analysis.kind === "error" && analysis.mayBeBilled;
  const runUsd = worstCase ? estimateUsd : costUsd(settings.model, usage);
  const lookupCount = provenance.services.reduce((sum, service) => sum + service.queries, 0);
  let monthUsd = monthSpend + runUsd;
  let ledgerSaved = true;
  try {
    recordRun(db, {
      guildId: input.guild.id,
      channelId: input.channel.id,
      invokedBy: input.invokedBy,
      model: settings.model,
      status: analysis.kind,
      usage,
      costUsd: runUsd,
      imageCount: prepared.length,
      lookupCount,
      nowMs: now(),
    });
    monthUsd = getMonthSpendUsd(db, now());
  } catch (err) {
    ledgerSaved = false;
    logger.error(
      { evt: "investigate_artist_ledger_failed", problem: shortReason(err), runUsd },
      "[investigate-artist] run was not recorded"
    );
  }

  // Counts and cost only: nothing from the ticket goes into the logs.
  logger.info(
    {
      evt: "investigate_artist_run",
      guildId: input.guild.id,
      channelId: input.channel.id,
      status: analysis.kind,
      images: prepared.length,
      imageFailures: imageFailures.length,
      matches: provenance.matches.length,
      lookups: lookupCount,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      runUsd,
      monthUsd,
      durationMs: now() - startedMs,
    },
    "[investigate-artist] run finished"
  );

  return {
    ok: true,
    report: {
      guildId: input.guild.id,
      channelId: input.channel.id,
      ticket,
      applicantVia: who.via,
      evidence,
      applicant,
      images: prepared.map((image) => ({ key: image.key, metadataNotes: image.metadataNotes })),
      imageFailures,
      provenance,
      analysis,
      cost: {
        model: settings.model,
        usage,
        runUsd,
        monthUsd,
        capUsd: settings.monthlyCapUsd,
        worstCase,
        ledgerSaved,
      },
    },
  };
}
