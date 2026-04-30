/**
 * scripts/llm-label.mjs
 *
 * Labels the v0 gold set (general_messages_gold) with Claude Haiku 4.5 against
 * the effort rubric from _recon/deepstorm-effort-rating.md §8.
 *
 * Per message we send:
 *   - system block (cached): rubric + JSON schema
 *   - user block: CONTEXT (last 3 msgs) + TARGET
 *
 * Output → general_messages_label. Resumable: rows already labeled are skipped.
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import Database from 'better-sqlite3';

const DB_PATH = 'data/data.db';
const MODEL = 'claude-haiku-4-5-20251001';
const CONCURRENCY = 8;
const MAX_RETRIES = 3;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[fatal] ANTHROPIC_API_KEY missing from .env');
  process.exit(1);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS general_messages_label (
    id           TEXT PRIMARY KEY,
    density      REAL NOT NULL,
    specificity  REAL NOT NULL,
    sincerity    REAL NOT NULL,
    relevance    REAL NOT NULL,
    effort       REAL NOT NULL,
    rationale    TEXT NOT NULL,
    model        TEXT NOT NULL,
    in_tokens    INTEGER NOT NULL,
    out_tokens   INTEGER NOT NULL,
    cached_in    INTEGER NOT NULL DEFAULT 0,
    labeled_at_s INTEGER NOT NULL
  );
`);

const SYSTEM_PROMPT = `You are scoring the EFFORT visible in a single Discord chat message from a community server. You are NOT scoring whether the message is good, funny, or popular — only how much thought, specificity, and genuine engagement it shows.

Score 0–10 on EACH of four dimensions. Use the full 0–10 range. Don't cluster everything in the middle.

1. DENSITY — Is there information beyond pure reaction?
   "lol" = 0. "nice catch" = 1. "the migration assumes WAL, which breaks under MEMORY journal mode" = 9.

2. SPECIFICITY — Concrete things, named entities, real details vs generic filler.
   "yeah same" = 0. "yeah same here, my Ferro keeps jamming on the third arc weld" = 8.

3. SINCERITY — Genuine engagement vs performative copy-paste, copypasta, bait, or one-word reactions made for engagement-farming.
   Copypasta = 0. A direct earnest reply = 7+.

4. RELEVANCE — Does this message actually advance or respond to the prior 3 messages?
   Off-topic randomness = 1. Direct relevant reply = 8+.

You will receive:
  CONTEXT: up to 3 prior messages in the same channel, oldest first. May be empty.
  TARGET: the message to score.

Return ONLY this JSON, no prose, no code fences:
{"density": <0-10>, "specificity": <0-10>, "sincerity": <0-10>, "relevance": <0-10>, "rationale": "<one sentence, ≤120 chars>"}`;

function shortAuthor(id) { return 'u' + id.slice(-4); }
function fmtTs(ts) { return new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 16); }

function buildUserMessage(target, ctxJson) {
  const ctx = JSON.parse(ctxJson || '[]');
  let out = 'CONTEXT:\n';
  if (ctx.length === 0) {
    out += '(no prior messages)\n';
  } else {
    for (const m of ctx) {
      out += `[${fmtTs(m.ts)}] ${shortAuthor(m.author_id)}: ${m.content || '(empty)'}\n`;
    }
  }
  out += '\nTARGET:\n';
  out += `[${fmtTs(target.created_at_s)}] ${shortAuthor(target.author_id)}: ${target.content}\n`;
  return out;
}

async function labelOne(row) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const resp = await client.messages.create({
        model: MODEL,
        max_tokens: 200,
        temperature: 0,
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [{ role: 'user', content: buildUserMessage(row, row.ctx_json) }],
      });
      const text = resp.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim();
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
      const parsed = JSON.parse(cleaned);
      const effort = (parsed.density + parsed.specificity + parsed.sincerity + parsed.relevance) / 40;
      return {
        id: row.id,
        density: parsed.density,
        specificity: parsed.specificity,
        sincerity: parsed.sincerity,
        relevance: parsed.relevance,
        effort,
        rationale: String(parsed.rationale || '').slice(0, 200),
        in_tokens: resp.usage.input_tokens ?? 0,
        out_tokens: resp.usage.output_tokens ?? 0,
        cached_in: resp.usage.cache_read_input_tokens ?? 0,
      };
    } catch (e) {
      lastErr = e;
      const wait = 1000 * 2 ** (attempt - 1);
      console.warn(`[retry ${attempt}/${MAX_RETRIES}] ${row.id}: ${e.message}; sleeping ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

const todo = db.prepare(`
  SELECT g.id, r.created_at_s, r.author_id, r.content, c.ctx_json
  FROM general_messages_gold g
  JOIN general_messages_raw r ON r.id = g.id
  JOIN general_messages_ctx c ON c.id = g.id
  LEFT JOIN general_messages_label l ON l.id = g.id
  WHERE l.id IS NULL
  ORDER BY g.id
`).all();

console.log(`[todo] ${todo.length} messages to label`);
if (todo.length === 0) {
  console.log('[done] all gold rows already labeled');
  process.exit(0);
}

const insert = db.prepare(`
  INSERT OR REPLACE INTO general_messages_label
    (id, density, specificity, sincerity, relevance, effort, rationale, model, in_tokens, out_tokens, cached_in, labeled_at_s)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let done = 0;
let totIn = 0, totOut = 0, totCached = 0;
const t0 = Date.now();

async function worker(queue) {
  while (queue.length) {
    const row = queue.shift();
    try {
      const r = await labelOne(row);
      const now = Math.floor(Date.now() / 1000);
      insert.run(
        r.id, r.density, r.specificity, r.sincerity, r.relevance, r.effort,
        r.rationale, MODEL, r.in_tokens, r.out_tokens, r.cached_in, now
      );
      totIn += r.in_tokens; totOut += r.out_tokens; totCached += r.cached_in;
      done++;
      if (done % 25 === 0 || done === todo.length) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = done / elapsed;
        const eta = (todo.length - done) / rate;
        process.stdout.write(
          `\r[label] ${done}/${todo.length}  in=${totIn}  out=${totOut}  cached=${totCached}  ` +
          `${rate.toFixed(1)}/s  ETA ${Math.round(eta)}s    `
        );
      }
    } catch (e) {
      console.error(`\n[skip] ${row.id} after retries: ${e.message}`);
    }
  }
}

const queue = [...todo];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
process.stdout.write('\n');

// Cost estimate (Haiku 4.5: $1/M in, $5/M out, cached input is ~$0.10/M)
const fullIn = totIn - totCached;
const cost = (fullIn / 1e6) * 1.0 + (totCached / 1e6) * 0.10 + (totOut / 1e6) * 5.0;
console.log(`[cost] ~$${cost.toFixed(3)} (in=${fullIn} full, ${totCached} cached, out=${totOut})`);

const stats = db.prepare(`SELECT COUNT(*) c, AVG(effort) avg, MIN(effort) lo, MAX(effort) hi FROM general_messages_label`).get();
console.log(`[stats] labeled=${stats.c}  effort mean=${stats.avg?.toFixed(3)}  min=${stats.lo?.toFixed(3)}  max=${stats.hi?.toFixed(3)}`);

db.close();
