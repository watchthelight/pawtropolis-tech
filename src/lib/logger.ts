/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: MIT
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
  base: undefined,
  // Pino hooks to send errors to Sentry
  hooks: {
    logMethod(args, method) {
      // Dynamically import Sentry to avoid circular dependencies
      const level = (this as pino.Logger).level;

      // Send errors and fatal logs to Sentry
      if (level === "error" || level === "fatal") {
        // Check if first arg is an error object
        const firstArg = args[0];
        if (firstArg && typeof firstArg === "object" && "err" in firstArg) {
          // Import Sentry asynchronously to send error
          import("./sentry.js").then(({ captureException, isSentryEnabled }) => {
            if (isSentryEnabled()) {
              const err = (firstArg as { err: Error }).err;
              const msg = args[1] as string | undefined;
              captureException(err, { message: msg, level });
            }
          }).catch(() => {
            // Silently fail if Sentry module isn't loaded yet
          });
        }
      }

      return method.apply(this, args);
    },
  },
});
