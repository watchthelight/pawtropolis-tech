// Shared types + constants for the Quality dashboard. Lives outside
// $lib/server/ so client components can import it without tripping
// SvelteKit's server-only guard.

export interface QualityOverview {
	totalScored: number;
	distinctAuthors: number;
	meanEffort: number;
	meanResonance: number;
	lowEffortShare: number;
}

export interface QualityWeekBucket {
	weekStart: number;
	iso: string;
	count: number;
	meanEffort: number;
	meanResonance: number;
	rolling4w: number;
	lowEffortShare: number;
}

export interface EffortBin {
	binStart: number;
	binEnd: number;
	count: number;
}

export interface AuthorRow {
	id: string;
	display: string;
	username: string | null;
	inGuild: boolean;
	msgs: number;
	meanEffort: number;
	meanResonance: number;
	composite: number;
	drag: number;
}

export interface QualityLeaderboards {
	minMsgs: number;
	topEffort: AuthorRow[];
	workhorses: AuthorRow[];
	drains: AuthorRow[];
}

export const OVERLAY_METRIC_KEYS = [
	'effort', 'heuristic', 'resonance',
	'median_length', 'lexical_diversity', 'question_rate',
	'no_repeat_spam', 'no_lowlist_hit', 'reply_rate', 'author_distribution',
] as const;

export type OverlayMetricKey = typeof OVERLAY_METRIC_KEYS[number];

export interface OverlayWeek {
	weekStart: number;
	iso: string;
	count: number;
	raw: Record<OverlayMetricKey, number>;
}

export interface BackfillStatus {
	totalRaw: number;
	embedded: number;
	scoredEffort: number;
	scoredResonance: number;
	oldestRawTs: number | null;
	newestRawTs: number | null;
	pendingCtx: number;
	pendingEmbed: number;
	pendingEffort: number;
}
