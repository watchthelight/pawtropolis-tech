/**
 * Pawtropolis Tech -- src/features/research/run.ts
 * WHAT: One run of the chat research job. It compares the archive with the
 *       score file, scores what is new or edited, removes the scores of what
 *       is gone, counts replies and rebuilds the weeks that changed.
 * WHY: The first pipeline was seven scripts on seven cron lines, each with its
 *      own idea of what was left to do, and it read "new" off a table that it
 *      filled itself. This one has a single rule: after a run, the score file
 *      says what the archive says. So a run can stop anywhere, be started
 *      twice or miss a week, and the next one puts it right.
 *
 *      A normal run looks at the last three days only, which costs a few
 *      milliseconds of reading. Once a day a full pass goes over the whole
 *      channel in slices of thirty days and catches what the short window
 *      cannot see: a message deleted or edited long after it was posted, a
 *      reply to an old message, and the 95th percentile that resonance is
 *      measured against.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Archive, ArchiveRow, ArchiveText } from "./archive.js";
import { predictEffort, type EffortModel } from "./effortModel.js";
import type { Embedder } from "./embedder.js";
import { DEFAULT_REPLY_P95, WEEK_S, weekStartOf, type Score, type Store } from "./store.js";
import {
  contextText,
  handFeatures,
  heuristicScore,
  isFiller,
  lexicalDensity,
  novelty,
  substantiveness,
} from "./text.js";
import { summarizeWeek, type WeekMessage } from "./weekly.js";

const DAY_S = 86400;
/** How far back a normal run looks. */
export const WINDOW_S = 3 * DAY_S;
const SLICE_S = 30 * DAY_S;
const CHUNK_SIZE = 256;
const CONTEXT_SIZE = 3;
/** A message may carry a time slightly ahead of this machine's clock. */
const CLOCK_SLACK_S = 3600;
/** 09:00 UTC is the quietest hour of the server. */
const FULL_PASS_HOUR_UTC = 9;

type RunMode = "window" | "full" | "range";

export interface RunOptions {
  archive: Archive;
  store: Store;
  model: EffortModel;
  lowlist: ReadonlySet<string>;
  fillerBank: ReadonlySet<string>;
  /** What the series is made from. Checked against the score file. */
  identity: Record<string, string>;
  /** Asked for only when there is something to score. */
  embedder: () => Promise<Embedder>;
  nowS: number;
  /** "auto" is a window run, or a full pass when one is due. */
  mode: RunMode | "auto";
  /** Range mode: the part of the channel to work on. */
  fromS?: number;
  toS?: number;
  /** false leaves reply counts and weeks alone (for parts that are merged later). */
  finalize?: boolean;
  /** The most messages one run scores. 0 means no limit. */
  maxMessages?: number;
}

export interface RunResult {
  mode: RunMode;
  scored: number;
  removed: number;
  /** Messages that still wait for a score because the run reached its limit. */
  pending: number;
  replyUpdates: number;
  weeksBuilt: number;
  replyP95: number;
  total: number;
}

/** True when no full pass has finished since the last 09:00 UTC. */
export function fullPassDue(lastFullS: number | null, nowS: number): boolean {
  if (lastFullS === null) return true;
  const today = Math.floor(nowS / DAY_S) * DAY_S + FULL_PASS_HOUR_UTC * 3600;
  return lastFullS < (nowS >= today ? today : today - DAY_S);
}

const numberOrNull = (value: string | null): number | null =>
  value === null ? null : Number(value);

export async function runResearch(options: RunOptions): Promise<RunResult> {
  const { archive, store, model, lowlist, fillerBank, nowS } = options;
  const limit = options.maxMessages ?? 0;
  store.assertIdentity(options.identity);

  const mode: RunMode =
    options.mode !== "auto"
      ? options.mode
      : fullPassDue(numberOrNull(store.getMeta("last_full_s")), nowS)
        ? "full"
        : "window";
  const finalize = options.finalize === false ? "none" : mode === "window" ? "window" : "full";

  const endS = nowS + CLOCK_SLACK_S;
  const channelStartS = Math.min(archive.firstMessageAt() ?? endS, store.firstScoreAt() ?? endS);
  const fromS =
    mode === "window"
      ? nowS - WINDOW_S
      : mode === "full"
        ? channelStartS
        : (options.fromS ?? channelStartS);
  const toS = mode === "range" ? Math.min(options.toS ?? endS, endS) : endS;

  let replyP95 = numberOrNull(store.getMeta("reply_p95")) ?? DEFAULT_REPLY_P95;
  let scored = 0;
  let removed = 0;
  let pending = 0;
  let replyUpdates = 0;

  // Weeks whose row no longer matches their scores. The list is kept in the
  // score file, so a run that dies before it rebuilt them leaves them to the next.
  const dirtyWeeks = new Set<number>(
    (store.getMeta("dirty_weeks") ?? "").split(",").filter(Boolean).map(Number)
  );
  let dirtySaved = dirtyWeeks.size;
  const saveDirtyWeeks = (): void => {
    if (dirtyWeeks.size === dirtySaved) return;
    store.setMeta("dirty_weeks", [...dirtyWeeks].join(","));
    dirtySaved = dirtyWeeks.size;
  };

  async function scoreChunk(chunk: ArchiveRow[]): Promise<Score[]> {
    const firstS = chunk[0]?.createdAtS ?? 0;
    const lastS = chunk.at(-1)?.createdAtS ?? 0;
    const timeline: ArchiveText[] = [
      ...archive.lastBefore(firstS, CONTEXT_SIZE),
      ...archive.texts(firstS, lastS + 1),
    ];
    const position = new Map(timeline.map((message, i) => [message.messageId, i]));

    const targets: { text: ArchiveText; context: string[] }[] = [];
    for (const row of chunk) {
      const at = position.get(row.messageId) ?? -1;
      const text = timeline[at];
      // Deleted or emptied since the list of work was made: the next run sees that.
      if (!text || text.content.length === 0) continue;
      // The context is what was said before this second, as in the first pipeline.
      let end = at;
      while (end > 0 && timeline[end - 1]?.createdAtS === text.createdAtS) end--;
      const context = timeline.slice(Math.max(0, end - CONTEXT_SIZE), end).map((m) => m.content);
      targets.push({ text, context });
    }
    if (targets.length === 0) return [];

    const embedder = await options.embedder();
    const vectors = await embedder.embed([
      ...targets.map((t) => t.text.content),
      ...targets.map((t) => contextText(t.context)),
    ]);

    return targets.map(({ text, context }, i) => {
      const target = vectors[i]!;
      const around = vectors[targets.length + i]!;
      const hand = handFeatures(
        {
          content: text.content,
          hasAttachment: text.hasAttachment,
          hasEmbed: text.hasEmbed,
          isReply: text.replyToId !== null,
          context,
        },
        lowlist
      );
      const nov = novelty(target, around);
      const notFiller = isFiller(text.content, fillerBank) ? 0 : 1;
      const density = lexicalDensity(text.content);
      return {
        messageId: text.messageId,
        createdAtS: text.createdAtS,
        authorId: text.authorId,
        contentRev: text.contentRev,
        effort: predictEffort(model, hand, target, around),
        heuristic: heuristicScore(text.content, text.hasAttachment, text.hasEmbed, lowlist),
        novelty: nov,
        notFiller,
        lexicalDensity: density,
        substantiveness: substantiveness(nov, notFiller, density),
      };
    });
  }

  /** Brings the scores of one stretch of time in line with the archive. */
  async function syncSlice(sliceFromS: number, sliceToS: number): Promise<ArchiveRow[]> {
    const rows = archive.rows(sliceFromS, sliceToS);
    const stored = new Map(store.keysInRange(sliceFromS, sliceToS).map((k) => [k.messageId, k]));
    const scorable = new Map<string, ArchiveRow>();
    for (const row of rows) {
      if (!row.isDeleted && !row.isBot && row.hasText) scorable.set(row.messageId, row);
    }

    const gone = [...stored.values()].filter((key) => !scorable.has(key.messageId));
    if (gone.length > 0) {
      store.deleteScores(gone);
      removed += gone.length;
      for (const key of gone) dirtyWeeks.add(weekStartOf(key.createdAtS));
    }

    // `rows` is oldest first, so the work is too.
    const wanted = [...scorable.values()].filter(
      (row) => stored.get(row.messageId)?.contentRev !== row.contentRev
    );
    const room = limit > 0 ? Math.max(0, limit - scored) : wanted.length;
    const work = wanted.slice(0, room);
    pending += wanted.length - work.length;

    for (let start = 0; start < work.length; start += CHUNK_SIZE) {
      const scores = await scoreChunk(work.slice(start, start + CHUNK_SIZE));
      store.upsertScores(scores);
      scored += scores.length;
      for (const score of scores) dirtyWeeks.add(weekStartOf(score.createdAtS));
      saveDirtyWeeks();
    }
    saveDirtyWeeks();
    return rows;
  }

  function applyReplyCounts(
    rangeFromS: number,
    rangeToS: number,
    replies: ReadonlyMap<string, number>
  ): void {
    const updates = [];
    for (const key of store.keysInRange(rangeFromS, rangeToS)) {
      const replyCount = replies.get(key.messageId) ?? 0;
      if (replyCount !== key.replyCount) {
        updates.push({ messageId: key.messageId, createdAtS: key.createdAtS, replyCount });
        dirtyWeeks.add(weekStartOf(key.createdAtS));
      }
    }
    if (updates.length === 0) return;
    saveDirtyWeeks();
    store.setReplyCounts(updates, replyP95);
    replyUpdates += updates.length;
  }

  const slices: [number, number][] = [];
  for (let start = fromS; start < toS; start += SLICE_S) {
    slices.push([start, Math.min(start + SLICE_S, toS)]);
  }

  const windowReplies = new Map<string, number>();
  for (const [sliceFromS, sliceToS] of slices) {
    const rows = await syncSlice(sliceFromS, sliceToS);
    if (finalize !== "window") continue;
    for (const row of rows) {
      if (row.isDeleted || row.replyToId === null) continue;
      windowReplies.set(row.replyToId, (windowReplies.get(row.replyToId) ?? 0) + 1);
    }
  }

  if (finalize === "window") {
    // A reply is newer than what it answers, so for a message inside the window
    // every reply is inside it too. Replies to older messages wait for the full pass.
    applyReplyCounts(fromS, toS, windowReplies);
  } else if (finalize === "full") {
    const replies = archive.replyCounts();
    for (let start = channelStartS; start < endS; start += SLICE_S) {
      applyReplyCounts(start, Math.min(start + SLICE_S, endS), replies);
    }
    const measured = store.replyP95();
    if (measured !== replyP95 || store.getMeta("reply_p95") === null) {
      store.rescaleResonance(measured);
      store.setMeta("reply_p95", String(measured));
      replyP95 = measured;
    }
    // A week whose row counts other messages than it has scores is rebuilt too.
    // That is how the weeks of a merged history come into being.
    const have = store.weekCounts();
    const want = store.scoreCountsByWeek();
    for (const [weekStart, count] of want)
      if (have.get(weekStart) !== count) dirtyWeeks.add(weekStart);
    for (const weekStart of have.keys()) if (!want.has(weekStart)) dirtyWeeks.add(weekStart);
  }

  let weeksBuilt = 0;
  if (finalize !== "none") {
    for (const weekStart of [...dirtyWeeks].sort((a, b) => a - b)) {
      const texts = new Map(
        archive.texts(weekStart, weekStart + WEEK_S).map((text) => [text.messageId, text])
      );
      const messages: WeekMessage[] = [];
      for (const score of store.scoresInRange(weekStart, weekStart + WEEK_S)) {
        const text = texts.get(score.messageId);
        if (!text) continue;
        messages.push({
          content: text.content,
          authorId: score.authorId,
          isReply: text.replyToId !== null,
          score,
        });
      }
      const week = summarizeWeek(weekStart, messages, lowlist);
      if (week) store.upsertWeek(week, nowS);
      else store.deleteWeek(weekStart);
      weeksBuilt++;
    }
    store.setMeta("dirty_weeks", "");
  }

  const total = store.countScores();
  store.setMeta("total", String(total));
  store.setMeta("pending", String(pending));
  store.setMeta("last_run_s", String(nowS));
  if (finalize === "full" && mode === "full" && pending === 0) {
    store.setMeta("last_full_s", String(nowS));
  }

  return { mode, scored, removed, pending, replyUpdates, weeksBuilt, replyP95, total };
}
