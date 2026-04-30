/**
 * scripts/chart-quality.mjs
 *
 * Reads general_messages_score, buckets by ISO week (Mon 00:00 UTC), and
 * writes:
 *   _recon/chat-quality.json  — { weeks: [{weekStart, count, mean, median, lowShare}, ...] }
 *   _recon/chat-quality.html  — self-contained D3 chart
 *
 * Open the HTML in a browser; user screenshots if needed.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const DB_PATH = 'data/data.db';
const OUT_DIR = '_recon';
const LOW_CUTOFF = 0.25;
const WEEK_S = 7 * 86400;
const EPOCH_TO_MONDAY = 4 * 86400; // unix epoch 1970-01-01 was a Thursday → +4 days = Mon

const db = new Database(DB_PATH, { readonly: true });
db.pragma('journal_mode = WAL');

function weekStartOf(ts) {
  return Math.floor((ts - EPOCH_TO_MONDAY) / WEEK_S) * WEEK_S + EPOCH_TO_MONDAY;
}

const rows = db.prepare(`SELECT created_at_s, score FROM general_messages_score ORDER BY created_at_s`).all();
console.log(`[load] ${rows.length} scored rows`);

const buckets = new Map(); // weekStart → { scores: [] }
for (const r of rows) {
  const w = weekStartOf(r.created_at_s);
  let b = buckets.get(w);
  if (!b) { b = { scores: [] }; buckets.set(w, b); }
  b.scores.push(r.score);
}

const weeks = [...buckets.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([weekStart, b]) => {
    const sorted = [...b.scores].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((s, x) => s + x, 0) / n;
    const median = n % 2 ? sorted[(n - 1) >> 1] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    const lowShare = sorted.filter((x) => x < LOW_CUTOFF).length / n;
    return {
      weekStart,
      iso: new Date(weekStart * 1000).toISOString().slice(0, 10),
      count: n,
      mean: +mean.toFixed(4),
      median: +median.toFixed(4),
      lowShare: +lowShare.toFixed(4),
    };
  });

// 4-week rolling mean (centered on the trailing edge)
const ROLL = 4;
for (let i = 0; i < weeks.length; i++) {
  const slice = weeks.slice(Math.max(0, i - ROLL + 1), i + 1);
  const sum = slice.reduce((s, w) => s + w.mean * w.count, 0);
  const cnt = slice.reduce((s, w) => s + w.count, 0);
  weeks[i].rollingMean = +(sum / cnt).toFixed(4);
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/chat-quality.json`, JSON.stringify({ generatedAt: new Date().toISOString(), weeks }, null, 2));
console.log(`[wrote] ${OUT_DIR}/chat-quality.json — ${weeks.length} weeks`);

const minIso = weeks[0]?.iso ?? '—';
const maxIso = weeks.at(-1)?.iso ?? '—';
const totalMsgs = weeks.reduce((s, w) => s + w.count, 0);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>#general — chat quality over time</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>
<style>
  :root {
    --bg: #0f1115;
    --fg: #e7e9ee;
    --muted: #8a8f9c;
    --grid: #1f232c;
    --accent: #f0b86e;
    --accent2: #6ea7f0;
    --low: #ef6f6f;
  }
  html, body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  .wrap { max-width: 1280px; margin: 24px auto; padding: 0 20px; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 4px; }
  .meta { color: var(--muted); font-size: 12px; margin-bottom: 24px; }
  .meta b { color: var(--fg); font-weight: 600; }
  .legend { display: flex; gap: 16px; margin-bottom: 12px; font-size: 12px; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend i { width: 12px; height: 2px; display: inline-block; }
  .legend i.dot { width: 8px; height: 8px; border-radius: 50%; }
  svg { display: block; width: 100%; height: 520px; }
  .axis text { fill: var(--muted); font-size: 11px; }
  .axis path, .axis line { stroke: var(--grid); }
  .grid line { stroke: var(--grid); stroke-dasharray: 2 3; }
  .tooltip {
    position: absolute; pointer-events: none; background: #1a1d24; color: var(--fg);
    border: 1px solid #2a2f3a; border-radius: 6px; padding: 8px 10px; font-size: 12px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4); display: none; white-space: nowrap;
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>#general — chat quality over time</h1>
  <div class="meta">
    <b>${weeks.length}</b> weekly buckets &middot;
    range <b>${minIso}</b> → <b>${maxIso}</b> &middot;
    <b>${totalMsgs.toLocaleString()}</b> human messages &middot;
    score = composite heuristic (length, unique-token ratio, alpha density, repeat penalty, low-effort wordlist)
  </div>
  <div class="legend">
    <span><i style="background: var(--accent);"></i>weekly mean</span>
    <span><i style="background: var(--accent2);"></i>4-week rolling mean</span>
    <span><i class="dot" style="background: var(--low);"></i>low-effort share (right axis)</span>
  </div>
  <svg id="chart"></svg>
  <div class="tooltip" id="tt"></div>
</div>

<script>
const data = ${JSON.stringify(weeks)};

const svg = d3.select('#chart');
const tt = d3.select('#tt');
const bbox = svg.node().getBoundingClientRect();
const margin = { top: 16, right: 56, bottom: 32, left: 44 };
const W = bbox.width - margin.left - margin.right;
const H = bbox.height - margin.top - margin.bottom;

const g = svg.append('g').attr('transform', \`translate(\${margin.left},\${margin.top})\`);

const x = d3.scaleTime()
  .domain(d3.extent(data, d => new Date(d.weekStart * 1000)))
  .range([0, W]);

const y = d3.scaleLinear().domain([0, 1]).range([H, 0]);
const yLow = d3.scaleLinear().domain([0, 1]).range([H, 0]);

g.append('g').attr('class', 'grid')
  .call(d3.axisLeft(y).ticks(5).tickSize(-W).tickFormat(''));

g.append('g').attr('class', 'axis')
  .attr('transform', \`translate(0,\${H})\`)
  .call(d3.axisBottom(x).ticks(d3.timeMonth.every(3)).tickFormat(d3.timeFormat('%b %Y')));

g.append('g').attr('class', 'axis')
  .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.1f')));

g.append('g').attr('class', 'axis')
  .attr('transform', \`translate(\${W},0)\`)
  .call(d3.axisRight(yLow).ticks(5).tickFormat(d3.format('.0%')));

const lineMean = d3.line()
  .x(d => x(new Date(d.weekStart * 1000)))
  .y(d => y(d.mean))
  .curve(d3.curveMonotoneX);

const lineRoll = d3.line()
  .x(d => x(new Date(d.weekStart * 1000)))
  .y(d => y(d.rollingMean))
  .curve(d3.curveMonotoneX);

g.append('path')
  .datum(data)
  .attr('fill', 'none')
  .attr('stroke', 'var(--accent)')
  .attr('stroke-width', 1.2)
  .attr('opacity', 0.55)
  .attr('d', lineMean);

g.append('path')
  .datum(data)
  .attr('fill', 'none')
  .attr('stroke', 'var(--accent2)')
  .attr('stroke-width', 2.4)
  .attr('d', lineRoll);

g.selectAll('.lowdot')
  .data(data)
  .join('circle')
  .attr('class', 'lowdot')
  .attr('cx', d => x(new Date(d.weekStart * 1000)))
  .attr('cy', d => yLow(d.lowShare))
  .attr('r', 1.6)
  .attr('fill', 'var(--low)')
  .attr('opacity', 0.6);

const bisect = d3.bisector(d => d.weekStart).left;
svg.on('mousemove', (ev) => {
  const [mx] = d3.pointer(ev, g.node());
  const t = x.invert(mx).getTime() / 1000;
  const i = Math.max(0, Math.min(data.length - 1, bisect(data, t)));
  const d = data[i];
  if (!d) return;
  tt.style('display', 'block')
    .style('left', (ev.pageX + 12) + 'px')
    .style('top', (ev.pageY + 12) + 'px')
    .html(\`<b>\${d.iso}</b><br/>mean: \${d.mean.toFixed(2)} (rolling \${d.rollingMean.toFixed(2)})<br/>median: \${d.median.toFixed(2)}<br/>low-effort: \${(d.lowShare*100).toFixed(0)}%<br/>n: \${d.count}\`);
}).on('mouseleave', () => tt.style('display', 'none'));
</script>
</body>
</html>`;

writeFileSync(`${OUT_DIR}/chat-quality.html`, html);
console.log(`[wrote] ${OUT_DIR}/chat-quality.html`);

db.close();
