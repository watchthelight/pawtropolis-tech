import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Lowlist for the metrics overlay. Loaded once from the canonical
// scripts/lowlist.json shipped with the bot.
let lowlistTokens: Set<string> | null = null;

export function getQualityLowlistTokens(): Set<string> {
	if (lowlistTokens) return lowlistTokens;

	const lowlistPath = resolve(process.cwd(), '../scripts/lowlist.json');
	try {
		const raw = JSON.parse(readFileSync(lowlistPath, 'utf8'));
		lowlistTokens = new Set((raw.tokens ?? []).map((t: string) => t.toLowerCase()));
	} catch {
		// Empty lowlist makes "no_lowlist_hit" compute as 1.0 for every week.
		lowlistTokens = new Set();
	}
	return lowlistTokens;
}
