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
    logMethod(args, method, level) {
      const levelValue =
        typeof level === "number" ? level : pino.levels.values[level as keyof typeof pino.levels.values] ?? 0;
      if (levelValue >= pino.levels.values.error) {
        const firstArg = args[0];
        const errorCandidate =
          firstArg instanceof Error
            ? firstArg
            : firstArg && typeof firstArg === "object" && "err" in firstArg
              ? (firstArg as { err?: unknown }).err
              : undefined;

        if (errorCandidate instanceof Error) {
          const message = typeof args[1] === "string" ? args[1] : undefined;
          const label =
            typeof level === "string"
              ? level
              : pino.levels.labels[levelValue as keyof typeof pino.levels.labels] ?? "error";

          import("./sentry.js")
            .then(({ captureException, isSentryEnabled }) => {
              if (isSentryEnabled()) {
                captureException(errorCandidate, { message, level: label });
              }
            })
            .catch(() => undefined);
        }
      }

      return method.apply(this, args);
    },
  },
});
