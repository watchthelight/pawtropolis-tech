// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/art.users.search.test.ts
 * WHAT: Unit tests for /api/art/users/search GET handler.
 * WHY: Combines URL query parsing, dual-path auth (sm OR SERVER_ARTIST
 *      role), and an env-var gate. The short-circuit on `q.length < 1`
 *      saves a DB roundtrip on every keystroke; pin that the query helper
 *      is NOT called in that case.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockSearchUsers } = vi.hoisted(() => ({ mockSearchUsers: vi.fn() }));

vi.mock("$lib/server/queries/art", () => ({
  searchUsers: mockSearchUsers,
}));

const { GET } = await import(
  "../../../web/src/routes/api/art/users/search/+server.js"
);

const SERVER_ARTIST = "896070888749940770";
const smStaff = { id: "u1", tier: "sm" as const, roles: [] };
const artistViewer = {
  id: "u2",
  tier: "viewer" as const,
  roles: [SERVER_ARTIST],
};
const plainViewer = { id: "u3", tier: "viewer" as const, roles: [] };

const ORIG_GUILD_ID = process.env.GUILD_ID;

beforeEach(() => {
  mockSearchUsers.mockReset();
  mockSearchUsers.mockReturnValue([]);
  process.env.GUILD_ID = "g1";
});

afterEach(() => {
  if (ORIG_GUILD_ID === undefined) delete process.env.GUILD_ID;
  else process.env.GUILD_ID = ORIG_GUILD_ID;
});

function evt(
  user: typeof smStaff | typeof artistViewer | typeof plainViewer | null,
  query: string,
) {
  return makeEvent({
    user: user ?? null,
    method: "GET",
    url: `http://localhost/api/art/users/search?${query}`,
  });
}

describe("GET /api/art/users/search", () => {
  it("401 when locals.user is absent", async () => {
    await expect(GET(evt(null, "q=alice"))).rejects.toMatchObject({
      status: 401,
    });
  });

  it("403 when viewer without SERVER_ARTIST role", async () => {
    await expect(GET(evt(plainViewer, "q=alice"))).rejects.toMatchObject({
      status: 403,
    });
  });

  it("200 allowed when sm staff", async () => {
    const res = await GET(evt(smStaff, "q=alice"));
    expect(res.status).toBe(200);
  });

  it("200 allowed when artist viewer", async () => {
    const res = await GET(evt(artistViewer, "q=alice"));
    expect(res.status).toBe(200);
  });

  it("throws when GUILD_ID env var is missing", async () => {
    delete process.env.GUILD_ID;
    await expect(GET(evt(smStaff, "q=alice"))).rejects.toThrow(/GUILD_ID/);
  });

  it("returns empty + skips DB when query is empty", async () => {
    const res = await GET(evt(smStaff, ""));
    const json = await res.json();
    expect(json).toEqual({ success: true, data: { users: [] } });
    expect(mockSearchUsers).not.toHaveBeenCalled();
  });

  it("passes excludeArtists=true when query param is 'true'", async () => {
    mockSearchUsers.mockReturnValueOnce([{ id: "a1", username: "alice" }]);
    const res = await GET(evt(smStaff, "q=alice&excludeArtists=true"));
    expect(res.status).toBe(200);
    expect(mockSearchUsers).toHaveBeenCalledWith("g1", "alice", true, 10);
    const json = await res.json();
    expect(json.data.users).toHaveLength(1);
  });

  it("defaults excludeArtists=false when param missing", async () => {
    await GET(evt(smStaff, "q=bob"));
    expect(mockSearchUsers).toHaveBeenCalledWith("g1", "bob", false, 10);
  });
});
