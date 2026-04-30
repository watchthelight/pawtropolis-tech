/**
 * scripts/metrics-overlay.mjs
 *
 * Computes 10 weekly chat-quality metrics from #general and overlays them
 * on a single chart. Each metric is min-max rescaled to [0,1] across the
 * window so the lines share an axis; tooltip shows raw values.
 *
 * Metrics:
 *   1  effort_v1           — LLM-distilled (Haiku rubric)        [primary]
 *   2  heuristic_v0        — lexical-only baseline               [comparison]
 *   3  resonance           — log1p(reply_count) / log1p(P95)
 *   4  median_length       — median word count per message
 *   5  lexical_diversity   — log(unique_tokens) / log(total_tokens)  (root-TTR style)
 *   6  question_rate       — fraction of msgs containing '?'
 *   7  no_repeat_spam      — 1 − fraction with max-char-run ≥ 4
 *   8  no_lowlist_hit      — 1 − fraction with all tokens in lowlist (≤3 words)
 *   9  reply_rate          — fraction of msgs that are replies
 *  10  author_distribution — 1 − Gini(per-author message counts)
 *
 * Output:
 *   _recon/chat-quality-overlay.html
 *   _recon/chat-quality-overlay.json
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const DB_PATH = 'data/data.db';
const OUT_DIR = '_recon';
const WEEK_S = 7 * 86400;
const EPOCH_TO_MONDAY = 4 * 86400;

const lowlist = new Set(JSON.parse(readFileSync('scripts/lowlist.json', 'utf8')).tokens.map((t) => t.toLowerCase()));

const db = new Database(DB_PATH, { readonly: true });
db.pragma('journal_mode = WAL');

function weekStartOf(ts) { return Math.floor((ts - EPOCH_TO_MONDAY) / WEEK_S) * WEEK_S + EPOCH_TO_MONDAY; }

const URL_RE = /https?:\/\/\S+/g;
const MENTION_RE = /<@!?\d+>|<#\d+>|<@&\d+>/g;
const EMOJI_RE = /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu;
function tokensOf(s) { return s.toLowerCase().replace(URL_RE, ' ').replace(MENTION_RE, ' ').replace(EMOJI_RE, ' ').split(/\s+/).filter(Boolean); }
function maxCharRun(s) { let m = 1, c = 1; for (let i = 1; i < s.length; i++) { if (s[i] === s[i - 1] && /\S/.test(s[i])) { c++; if (c > m) m = c; } else c = 1; } return m; }

// Gini coefficient on a non-negative array.
// Returns 0 (perfect equality) to ~1 (one source dominates).
function gini(values) {
  const n = values.length;
  if (n === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  if (sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * sorted[i];
  return cum / (n * sum);
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

console.log('[load] joining all per-msg scores...');
const rows = db.prepare(`
  SELECT
    r.id, r.created_at_s, r.author_id, r.content, r.reply_to,
    s.score   AS heuristic,
    eff.score AS effort,
    res.score AS resonance
  FROM general_messages_raw r
  LEFT JOIN general_messages_score s     ON s.id   = r.id
  LEFT JOIN general_messages_effort eff  ON eff.id = r.id
  LEFT JOIN general_messages_resonance res ON res.id = r.id
  WHERE r.is_bot = 0
    AND length(r.content) > 0
  ORDER BY r.created_at_s
`).all();
console.log(`[rows] ${rows.length}`);

// bucket per week
const buckets = new Map();
for (const r of rows) {
  const w = weekStartOf(r.created_at_s);
  let b = buckets.get(w);
  if (!b) {
    b = {
      n: 0,
      sumEffort: 0, nEffort: 0,
      sumHeur: 0, nHeur: 0,
      sumResonance: 0, nResonance: 0,
      lengths: [],
      uniqueTokens: new Set(),
      totalTokens: 0,
      questions: 0,
      repeatSpam: 0,
      lowlistHits: 0,
      replies: 0,
      authorCounts: new Map(),
    };
    buckets.set(w, b);
  }
  b.n++;

  if (r.effort !== null) { b.sumEffort += r.effort; b.nEffort++; }
  if (r.heuristic !== null) { b.sumHeur += r.heuristic; b.nHeur++; }
  if (r.resonance !== null) { b.sumResonance += r.resonance; b.nResonance++; }

  const toks = tokensOf(r.content);
  b.lengths.push(toks.length);
  b.totalTokens += toks.length;
  for (const t of toks) b.uniqueTokens.add(t);

  if (r.content.includes('?')) b.questions++;
  if (maxCharRun(r.content) >= 4) b.repeatSpam++;
  if (toks.length > 0 && toks.length <= 3 && toks.every((t) => lowlist.has(t))) b.lowlistHits++;
  if (r.reply_to) b.replies++;

  b.authorCounts.set(r.author_id, (b.authorCounts.get(r.author_id) ?? 0) + 1);
}

const weeks = [...buckets.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([weekStart, b]) => {
    const med = median(b.lengths);
    const ttr = b.totalTokens > 0 ? Math.log1p(b.uniqueTokens.size) / Math.log1p(b.totalTokens) : 0;
    const giniAuthors = gini([...b.authorCounts.values()]);

    return {
      weekStart,
      iso: new Date(weekStart * 1000).toISOString().slice(0, 10),
      count: b.n,
      raw: {
        effort:              b.nEffort ? b.sumEffort / b.nEffort : 0,
        heuristic:           b.nHeur ? b.sumHeur / b.nHeur : 0,
        resonance:           b.nResonance ? b.sumResonance / b.nResonance : 0,
        median_length:       med,
        lexical_diversity:   ttr,
        question_rate:       b.questions / b.n,
        no_repeat_spam:      1 - b.repeatSpam / b.n,
        no_lowlist_hit:      1 - b.lowlistHits / b.n,
        reply_rate:          b.replies / b.n,
        author_distribution: 1 - giniAuthors,
      },
    };
  });

// rescale each metric to [0,1] using min-max across all weeks
const METRIC_KEYS = [
  'effort', 'heuristic', 'resonance',
  'median_length', 'lexical_diversity', 'question_rate',
  'no_repeat_spam', 'no_lowlist_hit', 'reply_rate', 'author_distribution',
];

const ranges = {};
for (const key of METRIC_KEYS) {
  const vals = weeks.map((w) => w.raw[key]);
  ranges[key] = { min: Math.min(...vals), max: Math.max(...vals) };
}

for (const w of weeks) {
  w.scaled = {};
  for (const key of METRIC_KEYS) {
    const { min, max } = ranges[key];
    w.scaled[key] = max > min ? (w.raw[key] - min) / (max - min) : 0.5;
  }
}

// ---- per-author leaderboards (top/bottom 10 by mean effort) ----

const MIN_MSGS_FOR_LEADERBOARD = 200; // drive-by users muddy the ranking
const authorAgg = new Map();
for (const r of rows) {
  if (r.effort === null) continue;
  let a = authorAgg.get(r.author_id);
  if (!a) {
    a = { id: r.author_id, n: 0, sumEffort: 0, sumResonance: 0, sumLen: 0, sample: '' };
    authorAgg.set(r.author_id, a);
  }
  a.n++;
  a.sumEffort += r.effort;
  if (r.resonance !== null) a.sumResonance += r.resonance;
  a.sumLen += tokensOf(r.content).length;
  if (!a.sample && r.content && r.content.length > 20 && r.content.length < 140) a.sample = r.content;
}

const authors = [...authorAgg.values()]
  .filter((a) => a.n >= MIN_MSGS_FOR_LEADERBOARD)
  .map((a) => ({
    id: a.id,
    msgs: a.n,
    mean_effort: +(a.sumEffort / a.n).toFixed(4),
    mean_resonance: +(a.sumResonance / a.n).toFixed(4),
    median_length: +(a.sumLen / a.n).toFixed(1),
    sample: (a.sample || '').replace(/\s+/g, ' ').slice(0, 90),
  }))
  .sort((a, b) => a.mean_effort - b.mean_effort);

const bottom10 = authors.slice(0, 10);
const top10 = authors.slice(-10).reverse();
console.log(`[authors] ${authors.length} qualifying (≥${MIN_MSGS_FOR_LEADERBOARD} msgs)`);

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/chat-quality-overlay.json`, JSON.stringify({
  generatedAt: new Date().toISOString(),
  metric_keys: METRIC_KEYS,
  ranges,
  weeks,
  leaderboards: { min_msgs: MIN_MSGS_FOR_LEADERBOARD, top10, bottom10 },
}, null, 2));
console.log(`[wrote] ${OUT_DIR}/chat-quality-overlay.json — ${weeks.length} weeks × ${METRIC_KEYS.length} metrics`);

// metric labels and colors
const METRIC_META = {
  effort:              { label: 'LLM effort (v1)',        color: '#f0b86e', desc: 'Distilled-LLM rubric (Haiku 4.5). R²=0.68.' },
  heuristic:           { label: 'Heuristic v0',           color: '#cf8d4a', desc: 'Lexical-only baseline (length, repeats, lowlist).' },
  resonance:           { label: 'Resonance',              color: '#6ea7f0', desc: 'log1p(reply_count) / log1p(P95).' },
  median_length:       { label: 'Median length',          color: '#9adb89', desc: 'Median word count per message.' },
  lexical_diversity:   { label: 'Lexical diversity',      color: '#5cc69d', desc: 'log(unique tokens) / log(total tokens), root-TTR style.' },
  question_rate:       { label: 'Question rate',          color: '#c79dee', desc: 'Fraction of messages containing "?".' },
  no_repeat_spam:      { label: 'Anti-spam (no repeats)', color: '#ef6f6f', desc: '1 − fraction with max-char-run ≥ 4 (looool, sameeee).' },
  no_lowlist_hit:      { label: 'Anti-throwaway',         color: '#ee9c5d', desc: '1 − fraction where all tokens (≤3 words) are in the lowlist.' },
  reply_rate:          { label: 'Reply rate',             color: '#6ed6e8', desc: 'Fraction of messages that are replies to others.' },
  author_distribution: { label: 'Author distribution',    color: '#ed7eb1', desc: '1 − Gini of per-author message counts. Higher = posting more distributed.' },
};

const minIso = weeks[0]?.iso ?? '—';
const maxIso = weeks.at(-1)?.iso ?? '—';
const totalMsgs = weeks.reduce((s, w) => s + w.count, 0);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>#general — chat quality, 10 metrics overlaid</title>
<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>
<style>
  :root { --bg:#0f1115; --fg:#e7e9ee; --muted:#8a8f9c; --grid:#1f232c; }
  html,body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
  .wrap{max-width:1400px;margin:24px auto;padding:0 20px;}
  h1{font-size:18px;font-weight:600;margin:0 0 4px;}
  .meta{color:var(--muted);font-size:12px;margin-bottom:14px;}
  .meta b{color:var(--fg);font-weight:600;}
  .legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:0 0 14px;font-size:12px;}
  .legend span{display:inline-flex;align-items:center;gap:6px;cursor:pointer;padding:3px 8px;border-radius:4px;transition:background 120ms;}
  .legend span:hover{background:#1c2028;}
  .legend span.dim{opacity:0.35;}
  .legend i{width:16px;height:3px;display:inline-block;border-radius:2px;}
  svg{display:block;width:100%;height:560px;}
  .axis text{fill:var(--muted);font-size:11px;}
  .axis path,.axis line{stroke:var(--grid);}
  .grid line{stroke:var(--grid);stroke-dasharray:2 3;}
  .metric-line{transition:stroke-width 120ms,opacity 120ms;}
  .metric-line.dim{opacity:0.15;}
  .metric-line.focus{stroke-width:3.2;}
  .tooltip{position:absolute;pointer-events:none;background:#1a1d24;color:var(--fg);
    border:1px solid #2a2f3a;border-radius:6px;padding:10px 12px;font-size:12px;
    box-shadow:0 4px 16px rgba(0,0,0,.4);display:none;line-height:1.55;min-width:280px;}
  .tooltip h4{margin:0 0 4px;font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em;}
  .tooltip .row{display:flex;justify-content:space-between;gap:14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;}
  .tooltip .row .name{color:var(--muted);}
  .tooltip .row .val{color:var(--fg);}
  .tooltip .swatch{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;vertical-align:middle;}
  .desc{color:var(--muted);font-size:11px;line-height:1.6;max-width:1300px;}
  table.leaderboard{border-collapse:collapse;width:100%;font-size:12px;margin-top:8px;}
  table.leaderboard th{text-align:left;font-weight:600;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--grid);padding:8px 10px;}
  table.leaderboard td{padding:8px 10px;border-bottom:1px solid var(--grid);vertical-align:top;}
  table.leaderboard td code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);font-size:11px;}
  table.leaderboard td.sample{color:#c8ccd2;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;max-width:480px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  table.leaderboard td:first-child{color:var(--muted);font-variant-numeric:tabular-nums;width:32px;}
</style>
</head>
<body>
<div class="wrap">
  <h1>#general — chat quality, 10 metrics overlaid</h1>
  <div class="meta">
    <b>${weeks.length}</b> weeks &middot; <b>${minIso}</b> → <b>${maxIso}</b> &middot;
    <b>${totalMsgs.toLocaleString()}</b> human messages &middot;
    each metric min-max-rescaled to [0,1] across the window so trend shapes share an axis &middot;
    tooltip shows raw values &middot;
    click legend to toggle a line; hover the chart to focus
  </div>
  <div class="legend" id="legend"></div>
  <svg id="chart"></svg>
  <div class="tooltip" id="tt"></div>
  <p class="desc" id="desc-active"></p>

  <h1 style="margin-top:32px;">Top 10 highest mean effort</h1>
  <div class="meta">authors with ≥${MIN_MSGS_FOR_LEADERBOARD} messages, ranked by mean effort score</div>
  <table class="leaderboard">
    <thead><tr><th>#</th><th>Author</th><th>Messages</th><th>Mean effort</th><th>Mean resonance</th><th>Avg length</th><th>Sample</th></tr></thead>
    <tbody>${top10.map((a, i) => `
      <tr><td>${i + 1}</td><td><code>${a.id}</code></td><td>${a.msgs.toLocaleString()}</td><td><b>${a.mean_effort.toFixed(3)}</b></td><td>${a.mean_resonance.toFixed(3)}</td><td>${a.median_length.toFixed(1)}</td><td class="sample">${a.sample || '—'}</td></tr>`).join('')}
    </tbody>
  </table>

  <h1 style="margin-top:24px;">Top 10 lowest mean effort</h1>
  <div class="meta">same threshold, ranked from lowest mean effort</div>
  <table class="leaderboard">
    <thead><tr><th>#</th><th>Author</th><th>Messages</th><th>Mean effort</th><th>Mean resonance</th><th>Avg length</th><th>Sample</th></tr></thead>
    <tbody>${bottom10.map((a, i) => `
      <tr><td>${i + 1}</td><td><code>${a.id}</code></td><td>${a.msgs.toLocaleString()}</td><td><b>${a.mean_effort.toFixed(3)}</b></td><td>${a.mean_resonance.toFixed(3)}</td><td>${a.median_length.toFixed(1)}</td><td class="sample">${a.sample || '—'}</td></tr>`).join('')}
    </tbody>
  </table>
</div>

<script>
const data = ${JSON.stringify(weeks)};
const META = ${JSON.stringify(METRIC_META)};
const KEYS = ${JSON.stringify(METRIC_KEYS)};

const svg = d3.select('#chart');
const tt = d3.select('#tt');
const bbox = svg.node().getBoundingClientRect();
const margin = { top: 16, right: 24, bottom: 32, left: 44 };
const W = bbox.width - margin.left - margin.right;
const H = bbox.height - margin.top - margin.bottom;

const g = svg.append('g').attr('transform', \`translate(\${margin.left},\${margin.top})\`);
const x = d3.scaleTime()
  .domain(d3.extent(data, d => new Date(d.weekStart * 1000)))
  .range([0, W]);
const y = d3.scaleLinear().domain([0, 1]).range([H, 0]);

g.append('g').attr('class','grid').call(d3.axisLeft(y).ticks(5).tickSize(-W).tickFormat(''));
g.append('g').attr('class','axis').attr('transform', \`translate(0,\${H})\`)
  .call(d3.axisBottom(x).ticks(d3.timeMonth.every(3)).tickFormat(d3.timeFormat('%b %Y')));
g.append('g').attr('class','axis')
  .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format('.1f')));

// build legend
const legend = d3.select('#legend');
const visible = Object.fromEntries(KEYS.map(k => [k, true]));
for (const k of KEYS) {
  const meta = META[k];
  const item = legend.append('span').attr('data-key', k);
  item.append('i').style('background', meta.color);
  item.append('span').text(meta.label);
  item.on('click', () => {
    visible[k] = !visible[k];
    item.classed('dim', !visible[k]);
    redraw();
  });
}

const lineGen = (key) => d3.line()
  .x(d => x(new Date(d.weekStart*1000)))
  .y(d => y(d.scaled[key]))
  .curve(d3.curveMonotoneX);

const paths = {};
for (const k of KEYS) {
  paths[k] = g.append('path')
    .datum(data)
    .attr('fill','none')
    .attr('stroke', META[k].color)
    .attr('stroke-width', 1.7)
    .attr('opacity', 0.85)
    .attr('class', \`metric-line metric-\${k}\`)
    .attr('d', lineGen(k));
}

function redraw() {
  for (const k of KEYS) {
    paths[k].style('display', visible[k] ? null : 'none');
  }
}

// hover
const bisect = d3.bisector(d => d.weekStart).left;
const hoverDot = g.append('g').style('display', 'none');

function focus(key) {
  for (const k of KEYS) paths[k].classed('dim', key && k !== key).classed('focus', key === k);
  d3.select('#desc-active').text(key ? \`\${META[key].label} — \${META[key].desc}\` : '');
}

svg.on('mousemove', (ev) => {
  const [mx, my] = d3.pointer(ev, g.node());
  const t = x.invert(mx).getTime() / 1000;
  const i = Math.max(0, Math.min(data.length - 1, bisect(data, t)));
  const d = data[i];
  if (!d) return;

  // find nearest line
  let bestKey = null, bestDist = Infinity;
  for (const k of KEYS) {
    if (!visible[k]) continue;
    const py = y(d.scaled[k]);
    const dist = Math.abs(py - my);
    if (dist < bestDist) { bestDist = dist; bestKey = k; }
  }
  focus(bestKey);

  const fmt = (v) => (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(3) : String(v));
  const rows = KEYS.map(k => {
    const swatch = \`<span class="swatch" style="background:\${META[k].color}"></span>\`;
    const focused = k === bestKey ? ' style="font-weight:600"' : '';
    return \`<div class="row"\${focused}><span class="name">\${swatch}\${META[k].label}</span><span class="val">\${fmt(d.raw[k])}</span></div>\`;
  }).join('');

  tt.style('display','block')
    .style('left', (ev.pageX + 12) + 'px')
    .style('top', (ev.pageY + 12) + 'px')
    .html(\`<h4>\${d.iso} &middot; n=\${d.count.toLocaleString()}</h4>\${rows}\`);
}).on('mouseleave', () => { tt.style('display','none'); focus(null); });
</script>
</body>
</html>`;

writeFileSync(`${OUT_DIR}/chat-quality-overlay.html`, html);
console.log(`[wrote] ${OUT_DIR}/chat-quality-overlay.html`);

console.log('\n[ranges]');
for (const k of METRIC_KEYS) console.log(`  ${k.padEnd(22)} ${ranges[k].min.toFixed(4)} → ${ranges[k].max.toFixed(4)}`);

db.close();
