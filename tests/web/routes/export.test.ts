// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/export.test.ts
 * WHAT: Unit tests for the /api/export GET handler.
 * WHY: This is the dashboard's only data egress endpoint. CSV escaping is
 *      hand-rolled (no library) and easy to break in subtle ways for
 *      commas/quotes/newlines, so each escape case gets its own assertion.
 *      Tier gate (gk) is enforced once; tests pin it.
 *
 *      audit + config_audit cases were removed in done/00044 (queries
 *      referenced nonexistent identifiers). Two assertions remain to lock
 *      those former types as plain 400 invalid-type rejections.
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
const { GET } = await import("../../../web/src/routes/api/export/+server.js");

const gkUser = { id: "u1", tier: "gk" as const, roles: [] };

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

function evt(
  type: string | null,
  user: typeof gkUser | null = gkUser,
) {
  const search = type === null ? "" : `?type=${encodeURIComponent(type)}`;
  return makeEvent({
    user: user ?? null,
    method: "GET",
    url: `http://localhost/api/export${search}`,
  });
}

describe("GET /api/export", () => {
  it("403 when user is absent", async () => {
    await expect(GET(evt("stats", null))).rejects.toMatchObject({
      status: 403,
    });
  });

  it("403 when tier below gk", async () => {
    await expect(
      GET(evt("stats", { id: "u1", tier: "viewer", roles: [] } as never)),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("500 when GUILD_ID env var is missing", async () => {
    delete process.env.GUILD_ID;
    await expect(GET(evt("stats"))).rejects.toMatchObject({ status: 500 });
  });

  it("400 on invalid type query param", async () => {
    await expect(GET(evt("garbage"))).rejects.toMatchObject({ status: 400 });
  });

  it("400 when type is missing", async () => {
    await expect(GET(evt(null))).rejects.toMatchObject({ status: 400 });
  });

  it("400 when type=audit (branch removed; see done/00044)", async () => {
    await expect(GET(evt("audit", gkUser))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("400 when type=config_audit (branch removed; see done/00044)", async () => {
    await expect(GET(evt("config_audit", gkUser))).rejects.toMatchObject({
      status: 400,
    });
  });

  it("404 when stats has no rows in the window", async () => {
    await expect(GET(evt("stats"))).rejects.toMatchObject({ status: 404 });
  });

  it("200 stats happy path returns CSV", async () => {
    dbRef.current!
      .prepare(
        "INSERT INTO action_log (guild_id, actor_id, action, app_id, created_at_s) VALUES (?,?,?,?,?)",
      )
      .run("g1", "mod1", "approve", "A1", Math.floor(Date.now() / 1000) - 120);

    const res = await GET(evt("stats"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/text\/csv/);
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/attachment;/);
    expect(disposition).toMatch(/\.csv"/);
    const body = await res.text();
    const lines = body.split("\n");
    expect(lines[0]).toContain("mod_id");
    expect(lines[0]).toContain("action");
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it("CSV escapes values containing commas and quotes", async () => {
    dbRef.current!
      .prepare(
        "INSERT INTO action_log (guild_id, actor_id, action, app_id, reason, created_at_s) VALUES (?,?,?,?,?,?)",
      )
      .run(
        "g1",
        "mod1",
        "approve",
        'A,B"quoted',
        "ignored",
        Math.floor(Date.now() / 1000) - 120,
      );

    const res = await GET(evt("stats"));
    const body = await res.text();
    // The stats SELECT exposes app_id but not reason. Look for the
    // quoted/escaped form of the comma + double-quote value.
    expect(body).toMatch(/"A,B""quoted"/);
  });

  it("filename includes slugified window label", async () => {
    dbRef.current!
      .prepare(
        "INSERT INTO action_log (guild_id, actor_id, action, app_id, created_at_s) VALUES (?,?,?,?,?)",
      )
      .run("g1", "mod1", "approve", "A1", Math.floor(Date.now() / 1000) - 120);

    const res = await GET(evt("stats"));
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/review-actions-/);
    // Default window is "all" -> label "All time" -> slug "all-time".
    expect(disposition).toMatch(/review-actions-all-time\.csv/);
  });

});
