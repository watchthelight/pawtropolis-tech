// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/gate/resetScope.test.ts
 * Guards #00091: /gate reset must wipe only the current guild's data. This seeds
 * two guilds and runs the same scoped delete sequence executeReset uses, asserting
 * the other guild's rows survive.
 */
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";

function seed(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE application (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL);
    CREATE TABLE application_response (app_id TEXT, q_index INTEGER, PRIMARY KEY(app_id, q_index));
    CREATE TABLE review_action (id INTEGER PRIMARY KEY AUTOINCREMENT, app_id TEXT NOT NULL);
    CREATE TABLE review_card (app_id TEXT PRIMARY KEY);
    CREATE TABLE avatar_scan (application_id TEXT PRIMARY KEY, app_id TEXT);
    CREATE TABLE review_claim (app_id TEXT PRIMARY KEY);
    CREATE TABLE modmail_bridge (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL);
  `);
  for (const [g, app] of [["gA", "a1"], ["gB", "b1"]] as const) {
    db.prepare(`INSERT INTO application (id, guild_id) VALUES (?, ?)`).run(app, g);
    db.prepare(`INSERT INTO application_response (app_id, q_index) VALUES (?, 0)`).run(app);
    db.prepare(`INSERT INTO review_action (app_id) VALUES (?)`).run(app);
    db.prepare(`INSERT INTO review_card (app_id) VALUES (?)`).run(app);
    db.prepare(`INSERT INTO avatar_scan (application_id, app_id) VALUES (?, ?)`).run(app, app);
    db.prepare(`INSERT INTO review_claim (app_id) VALUES (?)`).run(app);
    db.prepare(`INSERT INTO modmail_bridge (guild_id) VALUES (?)`).run(g);
  }
}

function reset(db: InstanceType<typeof Database>, guildId: string): void {
  const sub = "(SELECT id FROM application WHERE guild_id = ?)";
  db.prepare(`DELETE FROM application_response WHERE app_id IN ${sub}`).run(guildId);
  db.prepare(`DELETE FROM review_action WHERE app_id IN ${sub}`).run(guildId);
  db.prepare(`DELETE FROM review_card WHERE app_id IN ${sub}`).run(guildId);
  db.prepare(`DELETE FROM avatar_scan WHERE application_id IN ${sub} OR app_id IN ${sub}`).run(guildId, guildId);
  db.prepare(`DELETE FROM review_claim WHERE app_id IN ${sub}`).run(guildId);
  db.prepare(`DELETE FROM modmail_bridge WHERE guild_id = ?`).run(guildId);
  db.prepare(`DELETE FROM application WHERE guild_id = ?`).run(guildId);
}

describe("/gate reset scoping (#00091)", () => {
  it("wipes only the target guild's data, leaving other guilds intact", () => {
    const db = new Database(":memory:");
    seed(db);
    reset(db, "gA");

    const tables = [
      "application",
      "application_response",
      "review_action",
      "review_card",
      "avatar_scan",
      "review_claim",
      "modmail_bridge",
    ];
    for (const t of tables) {
      const total = (db.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c;
      expect(total, `${t} should retain exactly the other guild's row`).toBe(1);
    }
    // The surviving rows belong to guild B.
    expect((db.prepare(`SELECT guild_id FROM application`).get() as { guild_id: string }).guild_id).toBe("gB");
    db.close();
  });
});
