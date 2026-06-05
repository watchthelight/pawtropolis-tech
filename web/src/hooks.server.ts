import type { Handle, HandleServerError } from "@sveltejs/kit";
import { sequence } from "@sveltejs/kit/hooks";
import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/public";
import { getSession } from "$lib/server/session";
import { getPreferences } from "$lib/server/preferences";

// Side-effect: subscribe push sender to eventBus
import "$lib/server/push/push-sender";

// Sentry server-side init runs once at module load (server startup).
// Skipped silently if PUBLIC_SENTRY_DSN is unset, so dev/test environments
// without a DSN configured don't error out.
if (env.PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: env.PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
    serverName: "pawtropolis-web",
    environment: process.env.NODE_ENV || "production",
  });
}

const appHandle: Handle = async ({ event, resolve }) => {
  const session = getSession(event.cookies);

  if (session) {
    event.locals.user = {
      id: session.userId,
      username: session.username,
      globalName: session.globalName,
      avatarUrl: session.avatarUrl,
      bannerUrl: session.bannerUrl,
      accentColor: session.accentColor,
      tier: session.tier,
      roles: session.roles,
    };
  }

  // Read preference cookies for SSR theme injection (zero-flash)
  const prefs = getPreferences(event.cookies);

  const isObservatory = event.url.pathname === "/observatory";

  return resolve(event, {
    transformPageChunk: ({ html }) => {
      let out = html;
      // The public /observatory page is intentionally zero-JS and self-themed.
      // Strip the inline theme-preference script and skip the data-theme attr
      // so the dashboard tokens never leak into its Win95 chrome.
      if (isObservatory) {
        out = out.replace(/<script>\s*\(function \(\)[\s\S]*?paw-theme[\s\S]*?<\/script>/, "");
        return out;
      }

      // Build the inline style overrides (hue + sage personalisation + font).
      const styleParts: string[] = [];
      if (prefs.hue) styleParts.push(`--hue:${prefs.hue}`);
      if (prefs.sageH) styleParts.push(`--sage-h:${prefs.sageH}`);
      if (prefs.sageC) styleParts.push(`--sage-c:${prefs.sageC}`);
      if (prefs.fontStack) styleParts.push(`--font-head:${prefs.fontStack}`);

      const attrs = [`data-theme="${prefs.mode}"`];
      if (styleParts.length) attrs.push(`style="${styleParts.join(";")}"`);

      out = out.replace('<html lang="en">', `<html lang="en" ${attrs.join(" ")}>`);
      return out;
    },
  });
};

// Compose Sentry's handle wrapper with the app handle. Order matters:
// sentryHandle() must run first so it captures errors thrown by appHandle.
export const handle: Handle = sequence(Sentry.sentryHandle(), appHandle);

// Capture errors raised inside load functions and SSR rendering. Without this,
// thrown errors reach the user's browser but never make it to Sentry.
export const handleError: HandleServerError = Sentry.handleErrorWithSentry();
