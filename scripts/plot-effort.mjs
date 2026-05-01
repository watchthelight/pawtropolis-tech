import Database from 'better-sqlite3';
import { createCanvas } from 'canvas';
import { writeFileSync } from 'node:fs';

const db = new Database('data/data.db', { readonly: true });
const rows = db.prepare(`
	SELECT week_start, count, effort, resonance
	FROM general_messages_overlay_weekly
	WHERE count >= 50
	ORDER BY week_start
`).all();
db.close();

console.log(`plotting ${rows.length} weeks`);

const W = 1600, H = 760;
const PAD = { top: 60, right: 40, bottom: 110, left: 70 };
const PW = W - PAD.left - PAD.right;
const PH = H - PAD.top - PAD.bottom;

const canvas = createCanvas(W, H);
const ctx = canvas.getContext('2d');

// Background
ctx.fillStyle = '#0a0a0f';
ctx.fillRect(0, 0, W, H);

// Title
ctx.fillStyle = '#e5e5e5';
ctx.font = 'bold 22px sans-serif';
ctx.fillText('Pawtropolis — Message Quality & Engagement per Week (2021 – 2026)', PAD.left, 30);

// Axes scales
const xs = rows.map((r) => r.week_start);
const x0 = Math.min(...xs), x1 = Math.max(...xs);
const yMax = 0.5;
const yMin = 0;

function xPx(x) { return PAD.left + ((x - x0) / (x1 - x0)) * PW; }
function yPx(y) { return PAD.top + (1 - (y - yMin) / (yMax - yMin)) * PH; }

// Y grid + labels
ctx.strokeStyle = '#1f1f2a';
ctx.lineWidth = 1;
ctx.fillStyle = '#9999a8';
ctx.font = '12px sans-serif';
for (let v = 0; v <= yMax + 0.001; v += 0.1) {
	const y = yPx(v);
	ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
	ctx.fillText(v.toFixed(1), 8, y + 4);
}

// X year labels
ctx.font = '13px sans-serif';
const yearTicks = [];
let curYear = 0;
for (const r of rows) {
	const y = new Date(r.week_start * 1000).getUTCFullYear();
	if (y !== curYear) { yearTicks.push({ year: y, x: r.week_start }); curYear = y; }
}
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

// 4-week rolling effort, ignoring weeks with no scored data.
const ROLL = 4;
const rollEffort = rows.map((_, i) => {
	const slice = rows.slice(Math.max(0, i - ROLL + 1), i + 1).filter((r) => r.effort > 0);
	if (!slice.length) return 0;
	const s = slice.reduce((a, r) => a + r.effort * r.count, 0);
	const c = slice.reduce((a, r) => a + r.count, 0);
	return c ? s / c : 0;
});

// Plot — break the line at zeros (unscored weeks) so they don't pull the chart down.
function plotLine(values, color, width, skipZero = true) {
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	let pen = false;
	ctx.beginPath();
	for (let i = 0; i < rows.length; i++) {
		const v = values[i];
		if (skipZero && (v === 0 || !Number.isFinite(v))) { pen = false; continue; }
		const x = xPx(rows[i].week_start), y = yPx(v);
		if (!pen) { ctx.moveTo(x, y); pen = true; } else { ctx.lineTo(x, y); }
	}
	ctx.stroke();
}

plotLine(rows.map((r) => r.effort), '#d4a368aa', 1);
plotLine(rollEffort, '#d4a368', 2.5);
plotLine(rows.map((r) => r.resonance), '#5b7fff', 2);

// Legend
const legend = [
	{ label: 'message quality (weekly)', color: '#d4a368aa' },
	{ label: 'message quality (4-week avg)', color: '#d4a368' },
	{ label: 'engagement (replies drawn)', color: '#5b7fff' }
];
let lx = PAD.left;
const legendY = H - 50;
ctx.font = '13px sans-serif';
for (const l of legend) {
	ctx.fillStyle = l.color;
	ctx.fillRect(lx, legendY, 18, 4);
	ctx.fillStyle = '#e5e5e5';
	ctx.fillText(l.label, lx + 24, legendY + 6);
	lx += ctx.measureText(l.label).width + 60;
}

// Annotations
const lastRoll = rollEffort[rollEffort.length - 1];
const firstRoll = rollEffort.find((v) => v > 0) ?? 0;
const trend = lastRoll - firstRoll;
const firstReso = rows.find((r) => r.resonance > 0)?.resonance ?? 0;
const lastReso = rows[rows.length - 1].resonance;
ctx.fillStyle = '#e5e5e5';
ctx.font = 'bold 14px sans-serif';
ctx.fillText(
	`Quality change: ${trend >= 0 ? '+' : ''}${trend.toFixed(3)} (${firstRoll.toFixed(3)} → ${lastRoll.toFixed(3)})   •   Engagement: ${firstReso.toFixed(2)} → ${lastReso.toFixed(2)}`,
	PAD.left, H - 16
);

writeFileSync('effort-over-time.png', canvas.toBuffer('image/png'));
console.log('wrote effort-over-time.png');
