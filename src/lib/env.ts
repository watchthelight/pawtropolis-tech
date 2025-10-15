/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: MIT
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Load .env from project root and allow override of existing env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(root, ".env"), override: true });

const raw = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN?.trim(),
  CLIENT_ID: process.env.CLIENT_ID?.trim(),
  GUILD_ID: process.env.GUILD_ID?.trim(),
  NODE_ENV: process.env.NODE_ENV?.trim(),
  DB_PATH: process.env.DB_PATH?.trim(),
  SENTRY_DSN: process.env.SENTRY_DSN?.trim(),
  SENTRY_ENVIRONMENT: process.env.SENTRY_ENVIRONMENT?.trim(),
  SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE?.trim(),
  LOG_LEVEL: process.env.LOG_LEVEL?.trim(),
  TEST_GUILD_ID: process.env.TEST_GUILD_ID?.trim(),
  TEST_REVIEWER_ROLE_ID: process.env.TEST_REVIEWER_ROLE_ID?.trim(),
};

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, "Missing DISCORD_TOKEN"),
  CLIENT_ID: z.string().min(1, "Missing CLIENT_ID"),
  GUILD_ID: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DB_PATH: z.string().default("data/data.db"),

  // Sentry error tracking (optional)
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // Optional log level
  LOG_LEVEL: z.string().optional(),

  // Seed-only helpers (optional at runtime)
  TEST_GUILD_ID: z.string().optional(),
  TEST_REVIEWER_ROLE_ID: z.string().optional(),
});

const parsed = schema.safeParse(raw);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
  // eslint-disable-next-line no-console
  console.error(`Environment validation failed:\n${issues}`);
  process.exit(1);
}
export const env = parsed.data;
