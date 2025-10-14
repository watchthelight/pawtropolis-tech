/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: MIT
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */
import "dotenv/config";
import { z } from "zod";
const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, "put your bot token in the .env dummy"),
  CLIENT_ID: z.string().min(1, "yeah and your client ID needs to be in there too"),
  GUILD_ID: z.string().optional(),
  NODE_ENV: z.enum(["development", "production"]).default("development"),
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