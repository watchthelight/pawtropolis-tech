/**
 * Pawtropolis Tech -- tests/features/research/helpers.ts
 * WHAT: What the research tests share: a throwaway archive database, a stand-in
 *       for the embedding model and a small effort model.
 * WHY: Nothing in the suite may load the real model (90 MB, seconds of CPU) or
 *      touch a real database. The stand-ins are simple enough to work out every
 *      expected score by hand.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  HAND_FEATURE_COUNT,
  VECTOR_SIZE,
  type EffortModel,
} from "../../../src/features/research/effortModel.js";
import type { Embedder } from "../../../src/features/research/embedder.js";

export const GUILD = "guild-1";
export const CHANNEL = "channel-general";

export interface TestMessage {
  id: string;
  at: number;
  content?: string;
  author?: string;
  bot?: boolean;
  deleted?: boolean;
  replyTo?: string;
  editedAt?: number;
  attachment?: boolean;
  embed?: boolean;
  channel?: string;
  guild?: string;
}

/** Creates a database with the bot's schema and the guild's general channel set. */
export function createArchiveDb(file: string): void {
  const db = new Database(file);
  // 223 statements: without these two lines each one waits for the disk.
  db.pragma("synchronous = OFF");
  db.exec(`BEGIN;\n${readFileSync(path.join("tests", "fixtures", "schema.sql"), "utf8")}\nCOMMIT;`);
  db.prepare("INSERT INTO guild_config (guild_id, general_channel_id) VALUES (?, ?)").run(
    GUILD,
    CHANNEL
  );
  db.close();
}

/** Runs statements on the archive database, the way the bot would change it. */
export function changeArchive(file: string, sql: string, ...params: unknown[]): void {
  const db = new Database(file);
  db.prepare(sql).run(...params);
  db.close();
}

export function addMessages(file: string, messages: TestMessage[]): void {
  const db = new Database(file);
  const insert = db.prepare(
    `INSERT INTO messages_archive (message_id, guild_id, channel_id, author_id, author_name,
       author_is_bot, content, attachments_json, embeds_json, reply_to_id, is_edited, is_deleted,
       created_at_s, edited_at_s)
     VALUES (?, ?, ?, ?, 'someone', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const m of messages) {
    insert.run(
      m.id,
      m.guild ?? GUILD,
      m.channel ?? CHANNEL,
      m.author ?? "author-1",
      m.bot ? 1 : 0,
      m.content ?? "some words here",
      m.attachment ? '["https://cdn.example/a.png"]' : null,
      m.embed ? '[{"type":"rich"}]' : null,
      m.replyTo ?? null,
      m.editedAt ? 1 : 0,
      m.deleted ? 1 : 0,
      m.at,
      m.editedAt ?? null
    );
  }
  db.close();
}

/** The vector the stand-in model gives a text: all weight on one place, picked by its length. */
function fakeVector(text: string): Float32Array {
  const vector = new Float32Array(VECTOR_SIZE);
  vector[text.length % VECTOR_SIZE] = 1;
  return vector;
}

/**
 * A stand-in embedder. Two texts of the same length get the same vector
 * (cosine 1), two of different length get vectors at right angles (cosine 0).
 */
export function fakeEmbedder(): { embedder: Embedder; calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    embedder: {
      async embed(texts) {
        calls.push([...texts]);
        return texts.map(fakeVector);
      },
    },
  };
}

/** Index of has_question among the hand features. */
const HAS_QUESTION = 13;

/**
 * effort = 0.5 + 0.25 when the message has a question mark
 *              - 0.25 * cosine(message, context)
 */
export function tinyModel(): EffortModel {
  const inputs = HAND_FEATURE_COUNT + 1 + VECTOR_SIZE + VECTOR_SIZE;
  const weights = new Array<number>(inputs + 1).fill(0);
  weights[0] = 0.5;
  weights[1 + HAS_QUESTION] = 0.25;
  weights[1 + HAND_FEATURE_COUNT] = -0.25;
  return {
    version: "tiny",
    means: new Array<number>(inputs).fill(0),
    stds: new Array<number>(inputs).fill(1),
    weights,
  };
}
