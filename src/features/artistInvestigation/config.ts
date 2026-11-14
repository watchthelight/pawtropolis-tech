/**
 * Pawtropolis Tech -- src/features/artistInvestigation/config.ts
 * WHAT: IDs, limits and env-backed settings for /investigate-artist.
 * WHY: The live server still opens 2D artist tickets with Ticket Tool, so the
 *      command has to recognize those channels as well as first-party tickets.
 *      Every number that bounds cost or load lives here so it can be read in one place.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { getBuildInfo } from "../../lib/buildInfo.js";
import { env } from "../../lib/env.js";

const PROD_GUILD_ID = "896070888594759740";

/** First-party ticket type key and the channel name prefix both ticket systems use. */
export const ARTIST_TICKET_TYPE_KEY = "2d-artist";
export const ARTIST_TICKET_NAME_PREFIX = "2d-artist-";

/** Ticket Tool, the third-party bot that creates the live verification tickets. */
export const TICKET_TOOL_BOT_ID = "557628352828014614";

/** Where Ticket Tool posts Created/Closed/Deleted lines and transcripts for 2D artist tickets. */
const PROD_ARTIST_LOG_CHANNEL_ID = "1420410266432307264";
/** Staff forum thread listing users who were refused verification. */
const PROD_VERIFY_BLACKLIST_THREAD_ID = "1504254437126963302";

export function getArtistLogChannelId(guildId: string): string | null {
  return guildId === PROD_GUILD_ID ? PROD_ARTIST_LOG_CHANNEL_ID : null;
}

export function getVerifyBlacklistThreadId(guildId: string): string | null {
  return guildId === PROD_GUILD_ID ? PROD_VERIFY_BLACKLIST_THREAD_ID : null;
}

export const LIMITS = {
  /** Ticket history is read 100 messages a page. 30 pages is far past any real ticket. */
  maxHistoryPages: 30,
  /** Transcript characters sent to the model. Older text is dropped first. */
  transcriptChars: 48_000,
  /** One message is trimmed to this many characters in the transcript. */
  messageChars: 1_800,
  /** Largest file the command will download. Discord's own cap is higher for boosted servers. */
  maxImageBytes: 26 * 1024 * 1024,
  /** Refuse to decode anything larger than this many pixels. */
  maxInputPixels: 80_000_000,
  /** Long edge of the copy sent to the model. Larger images are billed the same after the API resizes them. */
  modelLongEdge: 1568,
  /** Long edge of the copy sent to lookup services. Keeps uploads under every service's size cap. */
  lookupLongEdge: 1024,
  imageFetchTimeoutMs: 20_000,
  lookupTimeoutMs: 25_000,
  /** Whole provenance stage. Whatever has not finished by then is reported as incomplete. */
  provenanceBudgetMs: 150_000,
  analysisTimeoutMs: 240_000,
  /**
   * Output cap for the model call, thinking included. Also the worst case used
   * by the budget guard. A cut-off answer is thrown away, so this leaves room.
   */
  maxOutputTokens: 20_000,
  /** Images downloaded and decoded at the same time. */
  imageConcurrency: 4,
  /** Matches kept per image and service after sorting by similarity. */
  matchesPerQuery: 6,
  /** Pages of the Ticket Tool log read when looking for earlier tickets. */
  logPages: 5,
  /** Pages of the Verify Blacklist thread read. */
  blacklistPages: 5,
  cacheTtlSeconds: 7 * 24 * 60 * 60,
} as const;

export interface InvestigationSettings {
  anthropicApiKey: string | null;
  anthropicWorkspaceId: string | null;
  model: string;
  monthlyCapUsd: number;
  maxImages: number;
  sauceNaoApiKey: string | null;
  e621Login: string | null;
  e621ApiKey: string | null;
  userAgent: string;
}

/** Lookup services ask automated clients to say who they are and where to complain. */
function defaultUserAgent(): string {
  return `pawtropolis-tech/${getBuildInfo().version} (https://github.com/watchthelight/pawtropolis-tech)`;
}

export function getSettings(): InvestigationSettings {
  return {
    anthropicApiKey: env.ANTHROPIC_API_KEY || null,
    anthropicWorkspaceId: env.ANTHROPIC_WORKSPACE_ID || null,
    model: env.INVESTIGATE_MODEL,
    monthlyCapUsd: env.INVESTIGATE_MONTHLY_CAP_USD,
    maxImages: env.INVESTIGATE_MAX_IMAGES,
    sauceNaoApiKey: env.SAUCENAO_API_KEY || null,
    e621Login: env.E621_LOGIN || null,
    e621ApiKey: env.E621_API_KEY || null,
    userAgent: env.PROVENANCE_USER_AGENT || defaultUserAgent(),
  };
}
