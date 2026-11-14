/**
 * Pawtropolis Tech -- src/features/artistInvestigation/budget.ts
 * WHAT: Token pricing, per-run cost, the monthly total and the cap check for
 *       /investigate-artist.
 * WHY: The org API budget is fixed, so the command has to know what a run will
 *      cost before it starts and refuse once the month's tracked spend would pass
 *      the cap. Costs here are estimates from published prices; the Claude
 *      Console is the billing record.
 * DOCS:
 *  - https://platform.claude.com/docs/en/about-claude/pricing (read 2026-11-14)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import type { Database } from "better-sqlite3";

/** USD per million tokens. */
interface ModelPrice {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

interface PriceEntry {
  base: ModelPrice;
  /** Some models charge more once the prompt passes a size. */
  longPrompt?: { overTokens: number; price: ModelPrice };
}

const PRICES: Record<string, PriceEntry> = {
  "claude-fable-5-2": { base: { input: 8, output: 40, cacheWrite: 10, cacheRead: 0.2 } },
  "claude-opus-5-5": { base: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 } },
  "claude-sonnet-5-5": { base: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 } },
  "claude-haiku-5-5": {
    base: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
    longPrompt: {
      overTokens: 100_000,
      price: { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 },
    },
  },
};

/** A model this table does not know is billed at the highest known rate, so the cap errs on the safe side. */
const FALLBACK_MODEL = "claude-fable-5-2";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const NO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

function priceFor(model: string, promptTokens: number): { price: ModelPrice; known: boolean } {
  const id = Object.keys(PRICES).find((known) => model === known || model.startsWith(`${known}-`));
  const entry = PRICES[id ?? FALLBACK_MODEL] as PriceEntry;
  const price =
    entry.longPrompt && promptTokens > entry.longPrompt.overTokens
      ? entry.longPrompt.price
      : entry.base;
  return { price, known: id !== undefined };
}

export function isPriceKnown(model: string): boolean {
  return priceFor(model, 0).known;
}

export function costUsd(model: string, usage: TokenUsage): number {
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const { price } = priceFor(model, promptTokens);
  return (
    (usage.inputTokens * price.input +
      usage.outputTokens * price.output +
      usage.cacheWriteTokens * price.cacheWrite +
      usage.cacheReadTokens * price.cacheRead) /
    1_000_000
  );
}

/** The API bills an image by 28 px patches of the size it is sent at. */
export function imageTokens(width: number, height: number): number {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

export interface RunEstimateInput {
  imageTokens: number;
  /** Characters of prompt text: system prompt, transcript and lookup results. */
  textChars: number;
  maxOutputTokens: number;
}

/**
 * Worst-case cost of a run before it starts: every image at full size, text at
 * three characters a token, and the whole output allowance used.
 */
export function estimateCostUsd(model: string, input: RunEstimateInput): number {
  const inputTokens = input.imageTokens + Math.ceil(input.textChars / 3) + 1_500;
  return costUsd(model, { ...NO_USAGE, inputTokens, outputTokens: input.maxOutputTokens });
}

/** Unix seconds at the start of the UTC calendar month containing `nowMs`. */
export function monthStartS(nowMs: number): number {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000;
}

export function getMonthSpendUsd(db: Database, nowMs: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total FROM artist_investigation_run WHERE created_at_s >= ?`
    )
    .get(monthStartS(nowMs)) as { total: number };
  return row.total;
}

export type BudgetDecision = { allowed: true } | { allowed: false; reason: string };

export function checkBudget(
  capUsd: number,
  monthSpendUsd: number,
  estimateUsd: number
): BudgetDecision {
  if (monthSpendUsd + estimateUsd <= capUsd) return { allowed: true };
  return {
    allowed: false,
    reason:
      `Monthly cap reached. Tracked spend this month is ${formatUsd(monthSpendUsd)} and this run could cost up to ` +
      `${formatUsd(estimateUsd)}, which would pass the ${formatUsd(capUsd)} cap (INVESTIGATE_MONTHLY_CAP_USD). ` +
      `The total resets at the start of next month (UTC).`,
  };
}

export interface RunRecord {
  guildId: string;
  channelId: string;
  invokedBy: string;
  model: string;
  status: string;
  usage: TokenUsage;
  costUsd: number;
  imageCount: number;
  lookupCount: number;
  nowMs: number;
}

export function recordRun(db: Database, run: RunRecord): void {
  db.prepare(
    `INSERT INTO artist_investigation_run
       (guild_id, channel_id, invoked_by, model, status, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, cost_usd, image_count, lookup_count, created_at_s)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    run.guildId,
    run.channelId,
    run.invokedBy,
    run.model,
    run.status,
    run.usage.inputTokens,
    run.usage.outputTokens,
    run.usage.cacheReadTokens,
    run.usage.cacheWriteTokens,
    run.costUsd,
    run.imageCount,
    run.lookupCount,
    Math.floor(run.nowMs / 1000)
  );
}

export function formatUsd(amount: number): string {
  if (amount > 0 && amount < 0.01) return "under $0.01";
  return `$${amount.toFixed(2)}`;
}

export function formatTokens(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

export interface FooterInput {
  model: string;
  usage: TokenUsage;
  runUsd: number;
  monthUsd: number;
  capUsd: number;
}

/** Cost line for the response footer: this run, then the month against the cap. */
export function formatFooter(input: FooterInput): string {
  const inTokens =
    input.usage.inputTokens + input.usage.cacheReadTokens + input.usage.cacheWriteTokens;
  const parts = [
    `Run: ${formatUsd(input.runUsd)} (${formatTokens(inTokens)} in / ${formatTokens(input.usage.outputTokens)} out, ${input.model})`,
    `Month: ${formatUsd(input.monthUsd)} of ${formatUsd(input.capUsd)} cap`,
  ];
  if (!isPriceKnown(input.model))
    parts.push("no price on file for this model, cost shown at the highest known rate");
  parts.push("estimated from published prices");
  return parts.join(" · ");
}
