// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/welcome.mentionables.test.ts
 * WHAT: Unit tests for /api/welcome/mentionables GET handler.
 * WHY: The welcome editor renders selectable channel/role chips from this
 *      payload. Wrong channel type filter -> users see voice channels and
 *      categories that render as garbage in messages. The role filter must
 *      drop @everyone (mentioning everyone is the most-noticed misfire).
 *      Tests pin the type allowlist (0/5/15/16) and the @everyone exclusion.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { dbRef } = vi.hoisted(() => ({
  dbRef: { current: null as null | import("better-sqlite3").Database },
}));

vi.mock("$lib/server/db", () => ({
  db: () => dbRef.current!,
}));

const { makeDb } = await import("../_helpers/db.js");
const { GET } = await import(
  "../../../web/src/routes/api/welcome/mentionables/+server.js"
);

const adminUser = {
  id: "u1",
  tier: "admin" as const,
  roles: [],
};

const ORIG_GUILD_ID = process.env.GUILD_ID;

beforeEach(() => {
  dbRef.current?.close();
  dbRef.current = makeDb();
  process.env.GUILD_ID = "g1";
});

afterEach(() => {
  if (ORIG_GUILD_ID === undefined) delete process.env.GUILD_ID;
  else process.env.GUILD_ID = ORIG_GUILD_ID;
});

afterAll(() => {
  dbRef.current?.close();
});

function evt(overrides: Partial<Parameters<typeof makeEvent>[0]> = {}) {
  return makeEvent({ user: adminUser, method: "GET", ...overrides });
}

describe("GET /api/welcome/mentionables", () => {
  it("401 when locals.user is absent", async () => {
    await expect(GET(evt({ user: null }))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("403 when tier below admin", async () => {
    await expect(
      GET(evt({ user: { id: "u1", tier: "mod", roles: [] } })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("throws when GUILD_ID env var is missing", async () => {
    delete process.env.GUILD_ID;
    await expect(GET(evt())).rejects.toThrow(/GUILD_ID/);
  });

  it("200 with empty channels + roles when DB has none", async () => {
    const res = await GET(evt());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ success: true, data: { channels: [], roles: [] } });
  });

  it("only returns linkable channel types (0/5/15/16); excludes voice + category", async () => {
    const db = dbRef.current!;
    const insert = db.prepare(
      "INSERT INTO channel_cache (guild_id, channel_id, name, type, parent_id, updated_at_s) VALUES (?,?,?,?,?,0)",
    );
    // linkable
    insert.run("g1", "c0", "general", 0, null);
    insert.run("g1", "c5", "announcements", 5, null);
    insert.run("g1", "c15", "forum", 15, null);
    insert.run("g1", "c16", "media", 16, null);
    // not linkable
    insert.run("g1", "c2", "voice-lobby", 2, null);
    insert.run("g1", "c4", "voice-cat", 4, null);
    insert.run("g1", "c13", "stage", 13, null);
    // wrong guild
    insert.run("g2", "c99", "other-guild", 0, null);

    const res = await GET(evt());
    const json = await res.json();
    const ids = json.data.channels.map((c: { id: string }) => c.id).sort();
    expect(ids).toEqual(["c0", "c15", "c16", "c5"]);
  });

  it("excludes @everyone from roles and maps mentionable 1 -> true", async () => {
    const db = dbRef.current!;
    db.prepare(
      "INSERT INTO role_cache (guild_id, role_id, name, color, position, mentionable, managed, updated_at_s) VALUES (?,?,?,?,?,?,0,0)",
    ).run("g1", "r1", "@everyone", 0, 0, 0);
    db.prepare(
      "INSERT INTO role_cache (guild_id, role_id, name, color, position, mentionable, managed, updated_at_s) VALUES (?,?,?,?,?,?,0,0)",
    ).run("g1", "r2", "Mod", 0xff00ff, 50, 1);

    const res = await GET(evt());
    const json = await res.json();
    const names = json.data.roles.map((r: { name: string }) => r.name);
    expect(names).not.toContain("@everyone");
    expect(names).toContain("Mod");
    const mod = json.data.roles.find((r: { id: string }) => r.id === "r2");
    expect(mod.mentionable).toBe(true);
  });
});
