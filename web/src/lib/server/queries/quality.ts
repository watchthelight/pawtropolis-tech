/**
 * web/src/lib/server/queries/quality.ts
 *
 * Read-only aggregations over the chat-quality tables that back the
 * /dashboard/quality page. All time-bound queries take a ResolvedRange and
 * scope their predicates to [startS, endS).
 *
 * Heavy queries (timeseries, leaderboards, overlay) iterate up to ~1M rows
 * but use covering indexes on created_at_s to keep latency in the
 * hundreds-of-ms range. Histograms use a single GROUP BY pass.
 *
 * Source-of-truth tables come from migration 069.
 */

import { db } from '$lib/server/db';
import type { ResolvedRange } from '$lib/shared/timeWindow';
import {
	OVERLAY_METRIC_KEYS,
	type AuthorRow,
	type BackfillStatus,
	type EffortBin,
	type OverlayMetricKey,
	type OverlayWeek,
	type QualityLeaderboards,
	type QualityOverview,
	type QualityWeekBucket,
} from '$lib/shared/quality-types';

export {
	OVERLAY_METRIC_KEYS,
	type AuthorRow,
	type BackfillStatus,
	type EffortBin,
	type OverlayMetricKey,
	type OverlayWeek,
	type QualityLeaderboards,
	type QualityOverview,
	type QualityWeekBucket,
};

const WEEK_S = 7 * 86400;
const EPOCH_TO_MONDAY = 4 * 86400; // 1970-01-01 was a Thursday → +4 days = Monday
const LOW_EFFORT_CUTOFF = 0.20;

// ─── Overview KPIs ──────────────────────────────────────────────────────────

export function getQualityOverview(_guildId: string, range: ResolvedRange): QualityOverview {
	const row = db().prepare(`
		SELECT
			COUNT(*)                         AS totalScored,
			AVG(eff.score)                   AS meanEffort,
			AVG(res.score)                   AS meanResonance,
			SUM(CASE WHEN eff.score < ? THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0) AS lowEffortShare,
			(SELECT COUNT(DISTINCT r.author_id)
			 FROM general_messages_raw r
			 WHERE r.created_at_s >= ? AND r.created_at_s < ? AND r.is_bot = 0) AS distinctAuthors
		FROM general_messages_effort eff
		JOIN general_messages_resonance res ON res.id = eff.id
		WHERE eff.created_at_s >= ? AND eff.created_at_s < ?
	`).get(LOW_EFFORT_CUTOFF, range.startS, range.endS, range.startS, range.endS) as {
		totalScored: number;
		meanEffort: number | null;
		meanResonance: number | null;
		lowEffortShare: number | null;
		distinctAuthors: number;
	};

	return {
		totalScored: row.totalScored ?? 0,
		distinctAuthors: row.distinctAuthors ?? 0,
		meanEffort: row.meanEffort ?? 0,
		meanResonance: row.meanResonance ?? 0,
		lowEffortShare: row.lowEffortShare ?? 0,
	};
}

// ─── Weekly time-series ─────────────────────────────────────────────────────

function weekStartOf(ts: number): number {
	return Math.floor((ts - EPOCH_TO_MONDAY) / WEEK_S) * WEEK_S + EPOCH_TO_MONDAY;
}

export function getQualityTimeseries(_guildId: string, range: ResolvedRange): QualityWeekBucket[] {
	// Aggregate weekly buckets in SQL — avoids materializing ~1M rows in JS.
	const rows = db().prepare(`
		SELECT
			(CAST((eff.created_at_s - ?) / ? AS INTEGER) * ? + ?) AS week_start,
			COUNT(*)                              AS n,
			SUM(eff.score)                        AS effort_sum,
			SUM(res.score)                        AS resonance_sum,
			SUM(CASE WHEN eff.score < ? THEN 1 ELSE 0 END) AS low_count
		FROM general_messages_effort eff
		JOIN general_messages_resonance res ON res.id = eff.id
		WHERE eff.created_at_s >= ? AND eff.created_at_s < ?
		GROUP BY week_start
		ORDER BY week_start
	`).all(
		EPOCH_TO_MONDAY, WEEK_S, WEEK_S, EPOCH_TO_MONDAY,
		LOW_EFFORT_CUTOFF,
		range.startS, range.endS
	) as { week_start: number; n: number; effort_sum: number; resonance_sum: number; low_count: number }[];

	const weeks = rows.map((r) => ({
		weekStart: r.week_start,
		iso: new Date(r.week_start * 1000).toISOString().slice(0, 10),
		count: r.n,
		meanEffort: +(r.effort_sum / r.n).toFixed(4),
		meanResonance: +(r.resonance_sum / r.n).toFixed(4),
		rolling4w: 0,
		lowEffortShare: +(r.low_count / r.n).toFixed(4),
	}));

	// 4-week rolling mean effort weighted by message count.
	const ROLL = 4;
	let rollingSum = 0;
	let rollingCount = 0;
	for (let i = 0; i < weeks.length; i++) {
		rollingSum += weeks[i].meanEffort * weeks[i].count;
		rollingCount += weeks[i].count;
		if (i >= ROLL) {
			rollingSum -= weeks[i - ROLL].meanEffort * weeks[i - ROLL].count;
			rollingCount -= weeks[i - ROLL].count;
		}
		weeks[i].rolling4w = +(rollingSum / rollingCount).toFixed(4);
	}

	return weeks;
}

// ─── Effort distribution histogram ──────────────────────────────────────────

const BIN_COUNT = 20;

export function getEffortDistribution(_guildId: string, range: ResolvedRange): EffortBin[] {
	const rows = db().prepare(`
		SELECT
			CAST(score * ? AS INTEGER) AS bin,
			COUNT(*)                   AS n
		FROM general_messages_effort
		WHERE created_at_s >= ? AND created_at_s < ?
		GROUP BY bin
		ORDER BY bin
	`).all(BIN_COUNT, range.startS, range.endS) as { bin: number; n: number }[];

	const out: EffortBin[] = [];
	const counts = new Map(rows.map((r) => [Math.min(BIN_COUNT - 1, r.bin), r.n]));
	for (let i = 0; i < BIN_COUNT; i++) {
		out.push({ binStart: i / BIN_COUNT, binEnd: (i + 1) / BIN_COUNT, count: counts.get(i) ?? 0 });
	}
	return out;
}

// ─── Author leaderboards ────────────────────────────────────────────────────

export function getEffortLeaderboards(
	_guildId: string,
	range: ResolvedRange,
	minMsgs = 200,
): QualityLeaderboards {
	const rows = db().prepare(`
		SELECT
			r.author_id                                              AS id,
			COUNT(*)                                                 AS msgs,
			AVG(eff.score)                                           AS meanEffort,
			AVG(res.score)                                           AS meanResonance,
			COALESCE(u.display, r.author_id)                         AS display,
			u.username                                               AS username,
			COALESCE(u.in_guild, 0)                                  AS in_guild
		FROM general_messages_raw r
		JOIN general_messages_effort eff    ON eff.id = r.id
		JOIN general_messages_resonance res ON res.id = r.id
		LEFT JOIN user_names u              ON u.id = r.author_id
		WHERE r.created_at_s >= ? AND r.created_at_s < ? AND r.is_bot = 0
		GROUP BY r.author_id
		HAVING msgs >= ?
	`).all(range.startS, range.endS, minMsgs) as Array<{
		id: string;
		msgs: number;
		meanEffort: number;
		meanResonance: number;
		display: string;
		username: string | null;
		in_guild: number;
	}>;

	const authors: AuthorRow[] = rows.map((a) => {
		const composite = +(a.meanEffort * Math.log10(a.msgs)).toFixed(4);
		const drag = +((1 - a.meanEffort) * Math.log10(a.msgs)).toFixed(4);
		return {
			id: a.id,
			display: a.display,
			username: a.username,
			inGuild: !!a.in_guild,
			msgs: a.msgs,
			meanEffort: +a.meanEffort.toFixed(4),
			meanResonance: +a.meanResonance.toFixed(4),
			composite,
			drag,
		};
	});

	const topEffort = [...authors].sort((a, b) => b.meanEffort - a.meanEffort).slice(0, 10);
	const workhorses = [...authors].sort((a, b) => b.composite - a.composite).slice(0, 10);
	const drains = [...authors].sort((a, b) => b.drag - a.drag).slice(0, 10);

	return { minMsgs, topEffort, workhorses, drains };
}

// ─── 10-metric overlay ──────────────────────────────────────────────────────

const URL_RE = /https?:\/\/\S+/g;
const MENTION_RE = /<@!?\d+>|<#\d+>|<@&\d+>/g;
const EMOJI_RE = /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu;

function tokensOf(s: string): string[] {
	return s.toLowerCase().replace(URL_RE, ' ').replace(MENTION_RE, ' ').replace(EMOJI_RE, ' ').split(/\s+/).filter(Boolean);
}

function maxCharRun(s: string): number {
	let m = 1, c = 1;
	for (let i = 1; i < s.length; i++) {
		if (s[i] === s[i - 1] && /\S/.test(s[i])) { c++; if (c > m) m = c; } else c = 1;
	}
	return m;
}

function gini(values: number[]): number {
	const n = values.length;
	if (n === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const sum = sorted.reduce((s, v) => s + v, 0);
	if (sum === 0) return 0;
	let cum = 0;
	for (let i = 0; i < n; i++) cum += (2 * (i + 1) - n - 1) * sorted[i];
	return cum / (n * sum);
}

function median(arr: number[]): number {
	if (!arr.length) return 0;
	const s = [...arr].sort((a, b) => a - b);
	const n = s.length;
	return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export function getMetricsOverlay(
	_guildId: string,
	range: ResolvedRange,
	_lowlistTokens: Set<string>,
): OverlayWeek[] {
	// Reads from precomputed weekly table (filled by scripts/build-overlay-weekly.mjs).
	// Falls back to empty array if the table is missing — first-deploy graceful degrade.
	try {
		const rows = db().prepare(`
			SELECT
				week_start, count,
				effort, heuristic, resonance,
				median_length, lexical_diversity, question_rate,
				no_repeat_spam, no_lowlist_hit, reply_rate, author_distribution
			FROM general_messages_overlay_weekly
			WHERE week_start >= ? AND week_start < ?
			ORDER BY week_start
		`).all(range.startS, range.endS) as Array<{
			week_start: number;
			count: number;
			effort: number;
			heuristic: number;
			resonance: number;
			median_length: number;
			lexical_diversity: number;
			question_rate: number;
			no_repeat_spam: number;
			no_lowlist_hit: number;
			reply_rate: number;
			author_distribution: number;
		}>;

		return rows.map((r) => ({
			weekStart: r.week_start,
			iso: new Date(r.week_start * 1000).toISOString().slice(0, 10),
			count: r.count,
			raw: {
				effort:              r.effort,
				heuristic:           r.heuristic,
				resonance:           r.resonance,
				median_length:       r.median_length,
				lexical_diversity:   r.lexical_diversity,
				question_rate:       r.question_rate,
				no_repeat_spam:      r.no_repeat_spam,
				no_lowlist_hit:      r.no_lowlist_hit,
				reply_rate:          r.reply_rate,
				author_distribution: r.author_distribution,
			},
		}));
	} catch {
		return [];
	}
}

// ─── Backfill / pipeline status ─────────────────────────────────────────────

export function getBackfillStatus(_guildId: string): BackfillStatus {
	const d = db();
	const totalRaw = (d.prepare(`SELECT COUNT(*) AS c FROM general_messages_raw`).get() as { c: number }).c;
	const totalCtx = (d.prepare(`SELECT COUNT(*) AS c FROM general_messages_ctx`).get() as { c: number }).c;
	const embedded = (d.prepare(`SELECT COUNT(*) AS c FROM general_messages_embed`).get() as { c: number }).c;
	const scoredEffort = (d.prepare(`SELECT COUNT(*) AS c FROM general_messages_effort`).get() as { c: number }).c;
	const scoredResonance = (d.prepare(`SELECT COUNT(*) AS c FROM general_messages_resonance`).get() as { c: number }).c;
	const oldest = d.prepare(`SELECT created_at_s AS ts FROM general_messages_raw ORDER BY created_at_s ASC LIMIT 1`).get() as { ts: number } | undefined;
	const newest = d.prepare(`SELECT created_at_s AS ts FROM general_messages_raw ORDER BY created_at_s DESC LIMIT 1`).get() as { ts: number } | undefined;

	const pendingCtx = Math.max(0, totalRaw - totalCtx);

	const eligibleForEmbed = (d.prepare(`
		SELECT COUNT(*) AS c
		FROM general_messages_ctx c
		JOIN general_messages_raw r ON r.id = c.id
		WHERE r.is_bot = 0 AND length(r.content) > 0
	`).get() as { c: number }).c;

	const embeddedEligible = (d.prepare(`
		SELECT COUNT(*) AS c
		FROM general_messages_embed e
		JOIN general_messages_ctx c ON c.id = e.id
		JOIN general_messages_raw r ON r.id = e.id
		WHERE r.is_bot = 0 AND length(r.content) > 0
	`).get() as { c: number }).c;

	const pendingEmbed = Math.max(0, eligibleForEmbed - embeddedEligible);

	const pendingEffort = (d.prepare(`
		SELECT COUNT(*) AS c
		FROM general_messages_embed e
		LEFT JOIN general_messages_effort eff ON eff.id = e.id
		WHERE eff.id IS NULL
	`).get() as { c: number }).c;

	return {
		totalRaw,
		embedded,
		scoredEffort,
		scoredResonance,
		oldestRawTs: oldest?.ts ?? null,
		newestRawTs: newest?.ts ?? null,
		pendingCtx,
		pendingEmbed,
		pendingEffort,
	};
}
