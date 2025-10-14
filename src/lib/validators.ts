/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: MIT
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import { z } from "zod";

export const Snowflake = z.string().regex(/^\d{15,20}$/, "Invalid snowflake");

export const Hours = z.coerce.number().int().min(0, "Must be >= 0");

export const HttpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//.test(u), "Must be http(s) URL");

export const ConfigKey = z.enum([
  "review_channel_id",
  "gate_channel_id",
  "unverified_channel_id",
  "general_channel_id",
  "accepted_role_id",
  "reviewer_role_id",
  "reapply_cooldown_hours",
  "min_account_age_hours",
  "min_join_age_hours",
  "image_search_url_template",
]);
