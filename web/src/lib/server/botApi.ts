/**
 * Bot Dashboard API client.
 * Sends authenticated requests to the bot's Fastify API (port 3003).
 * All mutations flow through here — the dashboard never writes to SQLite directly.
 */

const BOT_API_URL = process.env.BOT_API_URL || 'http://localhost:3003';
const BOT_API_SECRET = process.env.BOT_API_SECRET || '';

const REQUEST_TIMEOUT_MS = 10_000;

export interface BotApiSuccess<T = Record<string, unknown>> {
	success: true;
	data: T;
}

export interface BotApiError {
	success: false;
	error: string;
}

export type BotApiResponse<T = Record<string, unknown>> = BotApiSuccess<T> | BotApiError;

/**
 * Call a bot API endpoint with authentication.
 *
 * @param path - API path (e.g. "/api/review/claim")
 * @param body - Request body (userId, tier, and action-specific fields)
 * @returns Typed bot API response
 */
export async function callBotApi<T = Record<string, unknown>>(
	path: string,
	body: Record<string, unknown>
): Promise<BotApiResponse<T>> {
	if (!BOT_API_SECRET) {
		return { success: false, error: 'BOT_API_SECRET not configured' };
	}

	const url = `${BOT_API_URL}${path}`;

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Dashboard-Secret': BOT_API_SECRET
			},
			body: JSON.stringify(body),
			signal: controller.signal
		});

		clearTimeout(timeout);

		if (res.status === 401) {
			return { success: false, error: 'Bot API authentication failed' };
		}

		let json: unknown;
		try {
			json = await res.json();
		} catch {
			return { success: false, error: `Bot API returned non-JSON response (HTTP ${res.status})` };
		}

		return json as BotApiResponse<T>;
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			return { success: false, error: 'Bot API request timed out' };
		}
		return { success: false, error: 'Bot API unreachable' };
	}
}
