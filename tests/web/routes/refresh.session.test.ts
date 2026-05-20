// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/refresh.session.test.ts
 * WHAT: Unit tests for /api/refresh-session GET handler.
 * WHY: Re-fetches the user from Discord with the stored access token,
 *      detects tier from current member roles, and rewrites the session
 *      cookie if anything changed. Errors are silently swallowed
 *      (token expiry must NOT log the user out). The catch-all is the
 *      most-likely-to-break path; pin it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g1";

const { mockFetchUser, mockFetchMember, mockGetSession, mockSetSession } =
  vi.hoisted(() => ({
    mockFetchUser: vi.fn(),
    mockFetchMember: vi.fn(),
    mockGetSession: vi.fn(),
    mockSetSession: vi.fn(),
  }));

vi.mock("$lib/server/discord", () => ({
  fetchUser: mockFetchUser,
  fetchGuildMember: mockFetchMember,
  avatarUrl: (u: { id: string; avatar: string | null }, _size: number) =>
    u.avatar ? `https://cdn/${u.id}/${u.avatar}.png` : `https://cdn/default`,
  bannerUrl: (_u: unknown, _size: number) => null,
}));
vi.mock("$lib/server/session", () => ({
  getSession: mockGetSession,
  setSession: mockSetSession,
}));

const { GET } = await import(
  "../../../web/src/routes/api/refresh-session/+server.js"
);

const GK_ROLE = "896070888762535969";
const baseSession = {
  userId: "u1",
  username: "alice",
  globalName: "Alice",
  avatar: "av-hash",
  banner: null,
  accentColor: 0xff0000,
  avatarUrl: "https://cdn/u1/av-hash.png",
  bannerUrl: null,
  tier: "gk",
  roles: [GK_ROLE],
  accessToken: "tok",
  refreshToken: "rtok",
  expiresAt: Date.now() + 3_600_000,
};

beforeEach(() => {
  mockFetchUser.mockReset();
  mockFetchMember.mockReset();
  mockGetSession.mockReset();
  mockSetSession.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function evt() {
  return makeEvent({ user: null, method: "GET" });
}

describe("GET /api/refresh-session", () => {
  it("returns { changed: false } when no session in cookies", async () => {
    mockGetSession.mockReturnValueOnce(null);
    const res = await GET(evt());
    const json = await res.json();
    expect(json).toEqual({ changed: false });
    expect(mockFetchUser).not.toHaveBeenCalled();
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it("changed=false when fetched profile matches session", async () => {
    mockGetSession.mockReturnValueOnce(baseSession);
    mockFetchUser.mockResolvedValueOnce({
      id: "u1",
      global_name: "Alice",
      avatar: "av-hash",
      banner: null,
      accent_color: 0xff0000,
    });
    mockFetchMember.mockResolvedValueOnce({ roles: [GK_ROLE] });
    const res = await GET(evt());
    const json = await res.json();
    expect(json.changed).toBe(false);
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it("changed=true when accent color changed; setSession called", async () => {
    mockGetSession.mockReturnValueOnce(baseSession);
    mockFetchUser.mockResolvedValueOnce({
      id: "u1",
      global_name: "Alice",
      avatar: "av-hash",
      banner: null,
      accent_color: 0x00ff00,
    });
    mockFetchMember.mockResolvedValueOnce({ roles: [GK_ROLE] });
    const res = await GET(evt());
    const json = await res.json();
    expect(json.changed).toBe(true);
    expect(json.accentColor).toBe(0x00ff00);
    expect(mockSetSession).toHaveBeenCalledTimes(1);
  });

  it("changed=true when global name changed", async () => {
    mockGetSession.mockReturnValueOnce(baseSession);
    mockFetchUser.mockResolvedValueOnce({
      id: "u1",
      global_name: "AliceNew",
      avatar: "av-hash",
      banner: null,
      accent_color: 0xff0000,
    });
    mockFetchMember.mockResolvedValueOnce({ roles: [GK_ROLE] });
    const res = await GET(evt());
    const json = await res.json();
    expect(json.changed).toBe(true);
    expect(json.globalName).toBe("AliceNew");
    expect(mockSetSession).toHaveBeenCalled();
  });

  it("changed=true when avatar URL changed (different avatar hash)", async () => {
    mockGetSession.mockReturnValueOnce(baseSession);
    mockFetchUser.mockResolvedValueOnce({
      id: "u1",
      global_name: "Alice",
      avatar: "new-hash",
      banner: null,
      accent_color: 0xff0000,
    });
    mockFetchMember.mockResolvedValueOnce({ roles: [GK_ROLE] });
    const res = await GET(evt());
    const json = await res.json();
    expect(json.changed).toBe(true);
    expect(json.avatarUrl).toBe("https://cdn/u1/new-hash.png");
  });

  it("tierChanged=true when member returns role producing a new tier", async () => {
    mockGetSession.mockReturnValueOnce({ ...baseSession, tier: "viewer" });
    mockFetchUser.mockResolvedValueOnce({
      id: "u1",
      global_name: "Alice",
      avatar: "av-hash",
      banner: null,
      accent_color: 0xff0000,
    });
    // GATEKEEPER role id (real one) -> detectTier returns "gk"
    mockFetchMember.mockResolvedValueOnce({
      roles: ["896070888762535969"],
    });
    const res = await GET(evt());
    const json = await res.json();
    expect(json.tierChanged).toBe(true);
    expect(json.tier).toBe("gk");
    expect(mockSetSession).toHaveBeenCalledTimes(1);
  });

  it("fetchGuildMember rejection: tier falls back to session value", async () => {
    mockGetSession.mockReturnValueOnce(baseSession);
    mockFetchUser.mockResolvedValueOnce({
      id: "u1",
      global_name: "Alice",
      avatar: "av-hash",
      banner: null,
      accent_color: 0xff0000,
    });
    mockFetchMember.mockRejectedValueOnce(new Error("not in guild"));
    const res = await GET(evt());
    const json = await res.json();
    expect(json.changed).toBe(false);
    expect(json.tier).toBe("gk");
    expect(mockSetSession).not.toHaveBeenCalled();
  });

  it("fetchUser rejection: outer catch returns changed:false", async () => {
    mockGetSession.mockReturnValueOnce(baseSession);
    mockFetchUser.mockRejectedValueOnce(new Error("token expired"));
    mockFetchMember.mockResolvedValueOnce({ roles: [GK_ROLE] });
    const res = await GET(evt());
    const json = await res.json();
    expect(json).toEqual({ changed: false });
    expect(mockSetSession).not.toHaveBeenCalled();
  });
});
