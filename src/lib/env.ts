/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: MIT
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, "Missing DISCORD_TOKEN"),
  CLIENT_ID: z.string().min(1, "Missing CLIENT_ID"),
  GUILD_ID: z.string().optional(),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  DB_PATH: z.string().default("data/data.db"),

  // Seed-only helpers (optional at runtime)
  TEST_GUILD_ID: z.string().optional(),
  TEST_REVIEWER_ROLE_ID: z.string().optional(),
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // issue then exit
  const issues = parsed.error.issues.map((i) => `- ${i.path.join(".")}: ${i.message}`).join("\n");
  // eslint-disable-next-line no-console
  console.error(`Environment validation failed:\n${issues}`);
  process.exit(1);
}
export const env = parsed.data;