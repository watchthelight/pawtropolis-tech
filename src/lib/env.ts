/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: MIT
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, "Missing DISCORD_TOKEN").default("test_token"),
  CLIENT_ID: z.string().min(1, "Missing CLIENT_ID").default("123456789012345678"),
  GUILD_ID: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DB_PATH: z.string().default("data/data.db"),

  // Sentry error tracking (optional)
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // Seed-only helpers (optional at runtime)
  TEST_GUILD_ID: z.string().optional(),
  TEST_REVIEWER_ROLE_ID: z.string().optional(),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // issue then exit
  const issues = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
   
  console.error(`Environment validation failed:\n${issues}`);
  process.exit(1);
}
export const env = parsed.data;
