#!/usr/bin/env node
// Reads general_messages_overlay_weekly and writes a PNG per metric to charts/.
// Run after build-overlay-weekly.mjs (or after merge-processed.sh on EC2).
//
// Usage:
//   node scripts/generate-charts.mjs                # uses data/data.db
//   DB_PATH=data/data.db.processed-snapshot node scripts/generate-charts.mjs

import Database from 'better-sqlite3';
import { createCanvas } from 'canvas';
import { writeFileSync, mkdirSync } from 'node:fs';

const DB_PATH = process.env.DB_PATH || 'data/data.db';
const OUT_DIR = process.env.OUT_DIR || 'charts';
mkdirSync(OUT_DIR, { recursive: true });

const db = new Database(DB_PATH, { readonly: true });
const rows = db.prepare(`
	SELECT week_start, count, effort, heuristic, resonance,
	       median_length, lexical_diversity, question_rate,
	       no_repeat_spam, no_lowlist_hit, reply_rate, author_distribution
	FROM general_messages_overlay_weekly
	WHERE count >= 100
	ORDER BY week_start
`).all();
db.close();

if (!rows.length) { console.error('no overlay rows; run build-overlay-weekly.mjs first'); process.exit(1); }
console.log(`source: ${DB_PATH}`);
console.log(`weeks:  ${rows.length}  (${new Date(rows[0].week_start * 1000).toISOString().slice(0,10)} → ${new Date(rows[rows.length-1].week_start * 1000).toISOString().slice(0,10)})`);

const W = 1400, H = 600;
const PAD = { top: 60, right: 40, bottom: 90, left: 80 };
const PW = W - PAD.left - PAD.right;
const PH = H - PAD.top - PAD.bottom;

const ROLL = 4;

function rolling(values, weights) {
	return values.map((_, i) => {
		const slice = values.slice(Math.max(0, i - ROLL + 1), i + 1);
		const ws = weights.slice(Math.max(0, i - ROLL + 1), i + 1);
		let s = 0, c = 0;
		for (let k = 0; k < slice.length; k++) {
			if (slice[k] === 0 || !Number.isFinite(slice[k])) continue;
			s += slice[k] * ws[k]; c += ws[k];
		}
		return c ? s / c : 0;
	});
}

function plotMetric(metric) {
	const { key, title, subtitle, color, yMin, yMax } = metric;
	const values = rows.map((r) => r[key]);
	const weights = rows.map((r) => r.count);
	const roll = rolling(values, weights);

	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext('2d');

	// Background
	ctx.fillStyle = '#0a0a0f';
	ctx.fillRect(0, 0, W, H);

	// Title
	ctx.fillStyle = '#e5e5e5';
	ctx.font = 'bold 20px sans-serif';
	ctx.fillText(title, PAD.left, 30);
	ctx.fillStyle = '#9999a8';
	ctx.font = '13px sans-serif';
	ctx.fillText(subtitle, PAD.left, 50);

	// Axes
	const xs = rows.map((r) => r.week_start);
	const x0 = Math.min(...xs), x1 = Math.max(...xs);
	const yLo = yMin ?? 0;
	const yHi = yMax ?? Math.max(...values.filter((v) => v > 0)) * 1.15;

	const xPx = (x) => PAD.left + ((x - x0) / (x1 - x0)) * PW;
	const yPx = (y) => PAD.top + (1 - (y - yLo) / (yHi - yLo)) * PH;

	// Y grid
	ctx.strokeStyle = '#1f1f2a';
	ctx.lineWidth = 1;
	ctx.fillStyle = '#9999a8';
	ctx.font = '12px sans-serif';
	const tickStep = (yHi - yLo) / 5;
	for (let i = 0; i <= 5; i++) {
		const v = yLo + tickStep * i;
		const y = yPx(v);
		ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
		const label = v < 1 ? v.toFixed(2) : v.toFixed(1);
		ctx.fillText(label, 10, y + 4);
	}

	// Year labels
	const yearTicks = [];
	let curYear = 0;
	for (const r of rows) {
		const y = new Date(r.week_start * 1000).getUTCFullYear();
		if (y !== curYear) { yearTicks.push({ year: y, x: r.week_start }); curYear = y; }
	}
	ctx.font = '13px sans-serif';
	for (const t of yearTicks) {
		const x = xPx(t.x);
		ctx.strokeStyle = '#1f1f2a';
		ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, H - PAD.bottom); ctx.stroke();
		ctx.fillStyle = '#9999a8';
		const label = String(t.year);
		const lw = ctx.measureText(label).width;
		const lx = Math.max(PAD.left + 4, Math.min(W - PAD.right - lw - 4, x - lw / 2));
		ctx.fillText(label, lx, H - PAD.bottom + 22);
	}

	// Lines
	function drawLine(vals, col, width, dashes = false) {
		ctx.strokeStyle = col;
		ctx.lineWidth = width;
		if (dashes) ctx.setLineDash([4, 3]); else ctx.setLineDash([]);
		let pen = false;
		ctx.beginPath();
		for (let i = 0; i < rows.length; i++) {
			const v = vals[i];
			if (v === 0 || !Number.isFinite(v)) { pen = false; continue; }
			const x = xPx(rows[i].week_start), y = yPx(v);
			if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
		}
		ctx.stroke();
		ctx.setLineDash([]);
	}

	drawLine(values, color + '99', 1);          // weekly raw, faint
	drawLine(roll,   color,         2.5);       // 4-week rolling, bold

	// Trend annotation
	const firstRoll = roll.find((v) => v > 0) ?? 0;
	const lastRoll = roll[roll.length - 1];
	const delta = lastRoll - firstRoll;
	const pct = firstRoll > 0 ? (delta / firstRoll) * 100 : 0;
	ctx.fillStyle = '#e5e5e5';
	ctx.font = 'bold 13px sans-serif';
	const trendStr = `${firstRoll.toFixed(3)} → ${lastRoll.toFixed(3)}   (${delta >= 0 ? '+' : ''}${delta.toFixed(3)}, ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
	ctx.fillText(`Trend: ${trendStr}`, PAD.left, H - 18);

	// Legend
	ctx.font = '12px sans-serif';
	const legY = H - 50;
	ctx.fillStyle = color + '99';
	ctx.fillRect(W - PAD.right - 220, legY, 18, 4);
	ctx.fillStyle = '#e5e5e5';
	ctx.fillText('weekly', W - PAD.right - 196, legY + 6);
	ctx.fillStyle = color;
	ctx.fillRect(W - PAD.right - 130, legY, 18, 4);
	ctx.fillStyle = '#e5e5e5';
	ctx.fillText('4-week avg', W - PAD.right - 106, legY + 6);

	const out = `${OUT_DIR}/${key}.png`;
	writeFileSync(out, canvas.toBuffer('image/png'));
	console.log(`  ${out.padEnd(40)} (${firstRoll.toFixed(3)} → ${lastRoll.toFixed(3)})`);
}

const METRICS = [
	{ key: 'effort',              title: 'Message Quality (effort score)',  subtitle: 'LLM-distilled effort per message — 24 hand features + cosine + 768-dim embedding deltas.', color: '#d4a368', yMin: 0,   yMax: 0.5 },
	{ key: 'resonance',           title: 'Engagement (replies drawn)',       subtitle: 'How much each message draws replies. Normalized log1p(reply_count).',                color: '#5b7fff', yMin: 0,   yMax: 0.5 },
	{ key: 'heuristic',           title: 'Heuristic Quality (v0)',           subtitle: 'Fast pre-LLM signal — sanity baseline against the trained effort model.',           color: '#9c64ff', yMin: 0,   yMax: 1 },
	{ key: 'lexical_diversity',   title: 'Lexical Diversity',                subtitle: 'log(unique tokens) / log(total tokens) per week. Falls when vocabulary narrows.',  color: '#65d4a3', yMin: 0.7, yMax: 0.95 },
	{ key: 'median_length',       title: 'Median Message Length (tokens)',   subtitle: 'Median token count per message per week.',                                          color: '#e89060', yMin: 0,   yMax: 5 },
	{ key: 'reply_rate',          title: 'Reply Rate',                       subtitle: 'Share of messages that are replies to another message.',                            color: '#5bb8ff', yMin: 0,   yMax: 0.7 },
	{ key: 'question_rate',       title: 'Question Rate',                    subtitle: 'Share of messages containing a "?".',                                               color: '#d96bb0', yMin: 0,   yMax: 0.4 },
	{ key: 'no_repeat_spam',      title: 'Anti-Spam Score',                  subtitle: '1 − share of messages with 4+ char runs (e.g. "aaaa", "!!!!"). Higher = cleaner.',  color: '#ffb84d', yMin: 0.85, yMax: 1 },
	{ key: 'no_lowlist_hit',      title: 'Anti-Throwaway Score',             subtitle: '1 − share of short messages matching the lowlist (e.g. "lol", "k").',                color: '#ff7355', yMin: 0.85, yMax: 1 },
	{ key: 'author_distribution', title: 'Author Distribution',              subtitle: '1 − Gini of per-author message counts. Higher = healthier spread of contributors.',  color: '#bdb265', yMin: 0,   yMax: 1 },
];

console.log(`writing ${METRICS.length} charts to ${OUT_DIR}/`);
for (const m of METRICS) plotMetric(m);

// ── Combined dashboard ──
{
	const canvas = createCanvas(2000, 800);
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = '#0a0a0f';
	ctx.fillRect(0, 0, 2000, 800);
	ctx.fillStyle = '#e5e5e5';
	ctx.font = 'bold 28px sans-serif';
	ctx.fillText('Pawtropolis — Quality Snapshot', 40, 50);
	ctx.fillStyle = '#9999a8';
	ctx.font = '14px sans-serif';
	ctx.fillText(`${rows.length} weeks  •  ${new Date(rows[0].week_start * 1000).toISOString().slice(0,10)} → ${new Date(rows[rows.length-1].week_start * 1000).toISOString().slice(0,10)}  •  generated ${new Date().toISOString().slice(0,16).replace('T',' ')}Z`, 40, 75);

	// Yearly summary table
	const yearMap = new Map();
	for (const r of rows) {
		const y = new Date(r.week_start * 1000).getUTCFullYear();
		let bucket = yearMap.get(y);
		if (!bucket) { bucket = {}; for (const m of METRICS) bucket[m.key] = { sum: 0, n: 0 }; bucket.count = 0; yearMap.set(y, bucket); }
		bucket.count += r.count;
		for (const m of METRICS) {
			if (r[m.key] === 0 || !Number.isFinite(r[m.key])) continue;
			bucket[m.key].sum += r[m.key]; bucket[m.key].n += 1;
		}
	}
	const years = [...yearMap.keys()].sort();
	const cellW = 130, cellH = 28;
	const tx = 40, ty = 110;
	ctx.fillStyle = '#e5e5e5';
	ctx.font = 'bold 14px sans-serif';
	ctx.fillText('Year', tx, ty);
	for (let i = 0; i < METRICS.length; i++) ctx.fillText(METRICS[i].key, tx + 80 + i * cellW, ty);
	ctx.fillText('Msgs', tx + 80 + METRICS.length * cellW, ty);
	ctx.font = '13px sans-serif';
	for (let r = 0; r < years.length; r++) {
		const y = years[r];
		const yy = ty + (r + 1) * cellH;
		ctx.fillStyle = '#1f1f2a';
		if (r % 2 === 0) ctx.fillRect(tx - 6, yy - 18, 80 + (METRICS.length + 1) * cellW, cellH - 4);
		ctx.fillStyle = '#e5e5e5';
		ctx.fillText(String(y), tx, yy);
		const b = yearMap.get(y);
		for (let i = 0; i < METRICS.length; i++) {
			const m = METRICS[i]; const o = b[m.key];
			const v = o.n ? o.sum / o.n : 0;
			ctx.fillStyle = m.color;
			ctx.fillText(v.toFixed(3), tx + 80 + i * cellW, yy);
		}
		ctx.fillStyle = '#9999a8';
		ctx.fillText(b.count.toLocaleString(), tx + 80 + METRICS.length * cellW, yy);
	}

	// 5x2 grid of mini charts (combined visual)
	const gx0 = 40, gy0 = ty + (years.length + 2) * cellH;
	const gw = 380, gh = 200, hgap = 16, vgap = 50;
	for (let i = 0; i < METRICS.length; i++) {
		const m = METRICS[i];
		const col = i % 5, row = Math.floor(i / 5);
		const x0 = gx0 + col * (gw + hgap);
		const y0 = gy0 + row * (gh + vgap);

		ctx.fillStyle = '#e5e5e5';
		ctx.font = 'bold 13px sans-serif';
		ctx.fillText(m.key, x0, y0 - 8);

		const values = rows.map((r) => r[m.key]);
		const weights = rows.map((r) => r.count);
		const roll = rolling(values, weights);
		const yLo = m.yMin ?? 0;
		const yHi = m.yMax ?? Math.max(...values.filter((v) => v > 0)) * 1.15;
		const xs = rows.map((r) => r.week_start);
		const xLo = Math.min(...xs), xHi = Math.max(...xs);
		const xp = (x) => x0 + ((x - xLo) / (xHi - xLo)) * gw;
		const yp = (y) => y0 + (1 - (y - yLo) / (yHi - yLo)) * gh;
		ctx.strokeStyle = '#222230';
		ctx.lineWidth = 1;
		ctx.strokeRect(x0, y0, gw, gh);
		ctx.strokeStyle = m.color;
		ctx.lineWidth = 1.6;
		let pen = false; ctx.beginPath();
		for (let k = 0; k < rows.length; k++) {
			const v = roll[k];
			if (v === 0 || !Number.isFinite(v)) { pen = false; continue; }
			const x = xp(rows[k].week_start), y = yp(v);
			if (!pen) { ctx.moveTo(x, y); pen = true; } else ctx.lineTo(x, y);
		}
		ctx.stroke();

		// Mini trend
		const firstRoll = roll.find((v) => v > 0) ?? 0;
		const lastRoll = roll[roll.length - 1];
		const pct = firstRoll > 0 ? ((lastRoll - firstRoll) / firstRoll) * 100 : 0;
		ctx.fillStyle = pct >= 0 ? '#7fd99f' : '#ff7773';
		ctx.font = 'bold 11px sans-serif';
		ctx.fillText(`${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`, x0 + gw - 56, y0 + 14);
	}

	const out = `${OUT_DIR}/_dashboard.png`;
	writeFileSync(out, canvas.toBuffer('image/png'));
	console.log(`  ${out.padEnd(40)} (combined)`);
}

console.log('done');
