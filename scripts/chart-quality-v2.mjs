/**
 * scripts/chart-quality-v2.mjs
 *
 * Dual-axis weekly chart: distilled-LLM effort + reply-graph resonance.
 * Replaces _recon/chat-quality.html.
 *
 * Per week:
 *   - mean effort, mean resonance, 4-week rolling effort
 *   - count
 *   - top 3 "underrated" (high effort - low resonance)
 *   - top 3 "overrated" (high resonance - low effort)
 *
 * Sample text in tooltips is truncated to 60 chars per the privacy
 * decision in _recon/deepstorm-effort-rating.md §9.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const DB_PATH = 'data/data.db';
const OUT_DIR = '_recon';
const WEEK_S = 7 * 86400;
const EPOCH_TO_MONDAY = 4 * 86400;
const SAMPLE_TRUNC = 60;

const db = new Database(DB_PATH, { readonly: true });
db.pragma('journal_mode = WAL');

function weekStartOf(ts) { return Math.floor((ts - EPOCH_TO_MONDAY) / WEEK_S) * WEEK_S + EPOCH_TO_MONDAY; }
function trunc(s) { return (s || '').replace(/\s+/g, ' ').slice(0, SAMPLE_TRUNC); }

console.log('[load] joined effort + resonance + content...');
const rows = db.prepare(`
  SELECT eff.id, eff.created_at_s, eff.score AS effort, res.score AS resonance, r.content
  FROM general_messages_effort eff
  JOIN general_messages_resonance res ON res.id = eff.id
  JOIN general_messages_raw r ON r.id = eff.id
  ORDER BY eff.created_at_s
`).all();
console.log(`[rows] ${rows.length}`);

if (rows.length === 0) {
  console.error('[fatal] no scored messages — run score-effort-v1.mjs and score-resonance.mjs first');
  process.exit(1);
}

const buckets = new Map();
for (const r of rows) {
  const w = weekStartOf(r.created_at_s);
  let b = buckets.get(w);
  if (!b) { b = { rows: [] }; buckets.set(w, b); }
  b.rows.push(r);
}

function sampleExtremes(bucketRows) {
  const scored = bucketRows.map((r) => ({ ...r, gap: r.resonance - r.effort }));
  const overrated = [...scored].sort((a, b) => b.gap - a.gap).slice(0, 3);
  const underrated = [...scored].sort((a, b) => a.gap - b.gap).slice(0, 3);
  return {
    overrated: overrated.map((r) => ({ effort: +r.effort.toFixed(2), resonance: +r.resonance.toFixed(2), text: trunc(r.content) })),
    underrated: underrated.map((r) => ({ effort: +r.effort.toFixed(2), resonance: +r.resonance.toFixed(2), text: trunc(r.content) })),
  };
}

const weeks = [...buckets.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([weekStart, b]) => {
    const n = b.rows.length;
    const effortMean = b.rows.reduce((s, r) => s + r.effort, 0) / n;
    const resonanceMean = b.rows.reduce((s, r) => s + r.resonance, 0) / n;
    const lowEffortShare = b.rows.filter((r) => r.effort < 0.20).length / n;
    const samples = sampleExtremes(b.rows);
    return {
      weekStart,
      iso: new Date(weekStart * 1000).toISOString().slice(0, 10),
      count: n,
      effortMean: +effortMean.toFixed(4),
      resonanceMean: +resonanceMean.toFixed(4),
      lowEffortShare: +lowEffortShare.toFixed(4),
      samples,
    };
  });

// 4-week rolling mean effort (weighted by msg count)
const ROLL = 4;
for (let i = 0; i < weeks.length; i++) {
  const slice = weeks.slice(Math.max(0, i - ROLL + 1), i + 1);
  const sum = slice.reduce((s, w) => s + w.effortMean * w.count, 0);
  const cnt = slice.reduce((s, w) => s + w.count, 0);
  weeks[i].effortRolling = +(sum / cnt).toFixed(4);
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/chat-quality.json`, JSON.stringify({ generatedAt: new Date().toISOString(), version: 'v2', weeks }, null, 2));
console.log(`[wrote] ${OUT_DIR}/chat-quality.json — ${weeks.length} weeks`);

const minIso = weeks[0]?.iso ?? '—';
const maxIso = weeks.at(-1)?.iso ?? '—';
const totalMsgs = weeks.reduce((s, w) => s + w.count, 0);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>#general — chat quality v2 (effort + resonance)</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>
<style>
  :root {
    --bg: #0f1115;
    --fg: #e7e9ee;
    --muted: #8a8f9c;
    --grid: #1f232c;
    --effort: #f0b86e;
    --effort-roll: #ffd699;
    --resonance: #6ea7f0;
    --low: #ef6f6f;
  }
  html, body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .wrap { max-width: 1320px; margin: 24px auto; padding: 0 20px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  .meta { color: var(--muted); font-size: 12px; margin-bottom: 18px; }
  .meta b { color: var(--fg); font-weight: 600; }
  .legend { display: flex; gap: 18px; margin-bottom: 12px; font-size: 12px; color: var(--muted); flex-wrap: wrap; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend i { width: 14px; height: 2px; display: inline-block; }
  svg { display: block; width: 100%; height: 540px; }
  .axis text { fill: var(--muted); font-size: 11px; }
  .axis path, .axis line { stroke: var(--grid); }
  .grid line { stroke: var(--grid); stroke-dasharray: 2 3; }
  .tooltip {
    position: absolute; pointer-events: none; background: #1a1d24; color: var(--fg);
    border: 1px solid #2a2f3a; border-radius: 6px; padding: 10px 12px; font-size: 12px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4); display: none; max-width: 460px; line-height: 1.5;
  }
  .tooltip h4 { margin: 8px 0 4px; font-size: 11px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .tooltip .sample { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #c8ccd2; margin: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tooltip .nums { color: var(--muted); font-size: 10px; margin-right: 6px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>#general — chat quality v2: effort + resonance</h1>
  <div class="meta">
    <b>${weeks.length}</b> weeks &middot; <b>${minIso}</b> → <b>${maxIso}</b> &middot;
    <b>${totalMsgs.toLocaleString()}</b> human messages scored &middot;
    effort = LLM-distilled (Haiku 4.5 rubric → ridge over hand features + 384-d MiniLM embeddings, R²=0.68 on holdout) &middot;
    resonance = log1p(reply_count) / log1p(P95)
  </div>
  <div class="legend">
    <span><i style="background: var(--effort);"></i>weekly mean effort</span>
    <span><i style="background: var(--effort-roll); height: 3px;"></i>4-week rolling effort</span>
    <span><i style="background: var(--resonance);"></i>weekly mean resonance</span>
    <span><i style="background: var(--low);"></i>low-effort share (right axis)</span>
  </div>
  <svg id="chart"></svg>
  <div class="tooltip" id="tt"></div>
</div>

<script>
const data = ${JSON.stringify(weeks)};

const svg = d3.select('#chart');
const tt = d3.select('#tt');
const bbox = svg.node().getBoundingClientRect();
const margin = { top: 16, right: 56, bottom: 32, left: 48 };
const W = bbox.width - margin.left - margin.right;
const H = bbox.height - margin.top - margin.bottom;

const g = svg.append('g').attr('transform', \`translate(\${margin.left},\${margin.top})\`);

const x = d3.scaleTime()
  .domain(d3.extent(data, d => new Date(d.weekStart * 1000)))
  .range([0, W]);

const y  = d3.scaleLinear().domain([0, 1]).range([H, 0]);

g.append('g').attr('class', 'grid').call(d3.axisLeft(y).ticks(5).tickSize(-W).tickFormat(''));

g.append('g').attr('class', 'axis').attr('transform', \`translate(0,\${H})\`)
  .call(d3.axisBottom(x).ticks(d3.timeMonth.every(3)).tickFormat(d3.timeFormat('%b %Y')));

g.append('g').attr('class', 'axis').call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.1f')));
g.append('g').attr('class', 'axis').attr('transform', \`translate(\${W},0)\`).call(d3.axisRight(y).ticks(5).tickFormat(d3.format('.1f')));

const lineEffort = d3.line().x(d => x(new Date(d.weekStart*1000))).y(d => y(d.effortMean)).curve(d3.curveMonotoneX);
const lineEffortRoll = d3.line().x(d => x(new Date(d.weekStart*1000))).y(d => y(d.effortRolling)).curve(d3.curveMonotoneX);
const lineResonance = d3.line().x(d => x(new Date(d.weekStart*1000))).y(d => y(d.resonanceMean)).curve(d3.curveMonotoneX);

g.append('path').datum(data).attr('fill','none').attr('stroke','var(--effort)').attr('stroke-width',1.2).attr('opacity',0.5).attr('d', lineEffort);
g.append('path').datum(data).attr('fill','none').attr('stroke','var(--effort-roll)').attr('stroke-width',2.6).attr('d', lineEffortRoll);
g.append('path').datum(data).attr('fill','none').attr('stroke','var(--resonance)').attr('stroke-width',2.0).attr('opacity',0.85).attr('d', lineResonance);

g.selectAll('.lowdot').data(data).join('circle')
  .attr('class','lowdot')
  .attr('cx', d => x(new Date(d.weekStart*1000)))
  .attr('cy', d => y(d.lowEffortShare))
  .attr('r', 1.6).attr('fill','var(--low)').attr('opacity',0.5);

const bisect = d3.bisector(d => d.weekStart).left;
svg.on('mousemove', (ev) => {
  const [mx] = d3.pointer(ev, g.node());
  const t = x.invert(mx).getTime() / 1000;
  const i = Math.max(0, Math.min(data.length - 1, bisect(data, t)));
  const d = data[i];
  if (!d) return;
  const fmtSamples = (arr) => arr.map(s => \`<div class="sample"><span class="nums">e=\${s.effort.toFixed(2)} r=\${s.resonance.toFixed(2)}</span>\${s.text}</div>\`).join('');
  tt.style('display', 'block')
    .style('left', (ev.pageX + 12) + 'px')
    .style('top', (ev.pageY + 12) + 'px')
    .html(\`
      <b>\${d.iso}</b> &middot; n=\${d.count.toLocaleString()}<br/>
      effort \${d.effortMean.toFixed(2)} (rolling \${d.effortRolling.toFixed(2)}) &middot;
      resonance \${d.resonanceMean.toFixed(2)} &middot;
      low-effort \${(d.lowEffortShare*100).toFixed(0)}%
      <h4>overrated (high resonance, low effort)</h4>\${fmtSamples(d.samples.overrated)}
      <h4>underrated (high effort, low resonance)</h4>\${fmtSamples(d.samples.underrated)}
    \`);
}).on('mouseleave', () => tt.style('display', 'none'));
</script>
</body>
</html>`;

writeFileSync(`${OUT_DIR}/chat-quality.html`, html);
console.log(`[wrote] ${OUT_DIR}/chat-quality.html`);

db.close();
