// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech Gatekeeper
 * Copyright (c) 2025 watchthelight (Bash) <admin@watchthelight.org>
 * License: LicenseRef-ANW-1.0
 * Repo: https://github.com/watchthelight/pawtropolis-tech
 */

import { db } from "./connection.js";
import { logger } from "../lib/logger.js";
import { env } from "../lib/env.js";

const TEST_GUILD = env.TEST_GUILD_ID ?? "1427677679280324730";
const TEST_REVIEWER_ROLE = env.TEST_REVIEWER_ROLE_ID ?? "896070888749940774";

function seedGuildConfig() {
  const upsert = db.prepare(`
    INSERT INTO guild_config (guild_id, reviewer_role_id)
    VALUES (?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET reviewer_role_id = excluded.reviewer_role_id,
      updated_at = datetime('now')
  `);
  upsert.run(TEST_GUILD, TEST_REVIEWER_ROLE);
}

function seedQuestions() {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO guild_question (guild_id, q_index, prompt, required)
    VALUES (?, ?, ?, 1)
  `);

  const questions = [
    "What is your age?",
    "How did you find this server?",
    "What tend to be your goals here?",
    "What does a furry mean to you?",
    "What is the password stated in our rules?",
  ];

  for (let i = 0; i < questions.length; i++) {
    insert.run(TEST_GUILD, i, questions[i]);
  }
}

function main() {
  seedGuildConfig();
  seedQuestions();
  logger.info({ guild: TEST_GUILD, reviewerRole: TEST_REVIEWER_ROLE }, "Seed complete");
}

main();
