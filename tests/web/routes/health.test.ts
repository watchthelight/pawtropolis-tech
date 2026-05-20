// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/health.test.ts
 * WHAT: Unit tests for the /api/health GET endpoint.
 * WHY: Better Stack pings this on 3-minute intervals; anything other than
 *      HTTP 200 is treated as an outage. The 503 path on DB failure must
 *      stay correct or we'd page on every transient SQLite hiccup. The
 *      version field plumbing (BUILD_GIT_SHA) is the only thing telling
 *      ops what code is running -- guard the null fallback explicitly.
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbRef } = vi.hoisted(() => ({
  dbRef: { current: null as null | import("better-sqlite3").Database },
}));

vi.mock("$lib/server/db", () => ({
  db: () => dbRef.current!,
}));

const { makeDb } = await import("../_helpers/db.js");
const { GET } = await import("../../../web/src/routes/api/health/+server.js");

const ORIG_BUILD_SHA = process.env.BUILD_GIT_SHA;

beforeEach(() => {
  dbRef.current?.close();
  dbRef.current = makeDb();
});

afterEach(() => {
  if (ORIG_BUILD_SHA === undefined) delete process.env.BUILD_GIT_SHA;
  else process.env.BUILD_GIT_SHA = ORIG_BUILD_SHA;
});

afterAll(() => {
  dbRef.current?.close();
});

describe("GET /api/health", () => {
  it("200 with db:true on a working database", async () => {
    delete process.env.BUILD_GIT_SHA;
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.db).toBe(true);
    expect(json.version).toBeNull();
  });

  it("includes version from BUILD_GIT_SHA when set", async () => {
    process.env.BUILD_GIT_SHA = "abc1234";
    const res = await GET();
    const json = await res.json();
    expect(json.version).toBe("abc1234");
  });

  it("latencyMs is a non-negative integer", async () => {
    const res = await GET();
    const json = await res.json();
    expect(typeof json.latencyMs).toBe("number");
    expect(json.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("ts is an ISO timestamp", async () => {
    const res = await GET();
    const json = await res.json();
    expect(json.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("503 + status=degraded when db throws", async () => {
    // Close the DB so any prepare/query throws SqliteError.
    dbRef.current!.close();

    const res = await GET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.status).toBe("degraded");
    expect(json.db).toBe(false);
    expect(typeof json.dbError).toBe("string");
    expect(json.dbError.length).toBeGreaterThan(0);

    // Replace the closed instance so afterAll doesn't double-close.
    dbRef.current = makeDb();
  });
});
