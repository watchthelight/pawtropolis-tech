import type { HandleClientError } from "@sveltejs/kit";
import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/public";

// Sentry browser-side init runs once per page load. Skipped silently if
// PUBLIC_SENTRY_DSN is unset, so dev/test environments without a configured
// DSN don't error out.
//
// Replay strategy:
//   - replaysSessionSampleRate: 0   — never record routine sessions
//   - replaysOnErrorSampleRate: 1.0 — always record the seconds before/around
//                                     an error so we can see what the user did
//
// This keeps us inside the Sentry free tier (50 replays/month) since replays
// only fire when something actually breaks, not on every page view.
//
// NOTE on cookie consent: Phase 3.2 (PostHog) will introduce a consent gate
// in CookieConsent.svelte that defers BOTH PostHog AND Sentry replay until
// after the user accepts. For now, error reporting flows immediately because
// errors-only Sentry data has minimal privacy impact and the dashboard is
// staff-only (tier-gated). Replay payloads only get sent when an error is
// already firing.
if (env.PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: env.PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: import.meta.env.MODE,
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}

// Capture client-side errors (uncaught exceptions, errors thrown in load
// functions on the client) and forward them to Sentry. SvelteKit calls this
// hook automatically — no app code needs to invoke it directly.
export const handleError: HandleClientError = Sentry.handleErrorWithSentry();
