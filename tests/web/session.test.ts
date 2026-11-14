// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/session.test.ts
 * WHAT: Tests for the dashboard session cookie codec.
 * WHY: A cookie that is not authenticated ciphertext must never yield a session;
 *      otherwise anyone can forge a tier by setting plain JSON.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { Cookies } from "@sveltejs/kit";

import { getSession, setSession, type SessionData } from "$lib/server/session";

const NAME = "pawtropolis_session";

function jar(initial?: string) {
  const store = new Map<string, string>();
  if (initial !== undefined) store.set(NAME, initial);
  return {
    store,
    cookies: {
      get: (n: string) => store.get(n),
      set: (n: string, v: string) => void store.set(n, v),
      delete: (n: string) => void store.delete(n),
    } as unknown as Cookies,
  };
}

const data: SessionData = {
  userId: "1",
  username: "u",
  globalName: null,
  avatar: null,
  banner: null,
  accentColor: null,
  avatarUrl: "https://example.test/a.png",
  bannerUrl: null,
  tier: "none" as SessionData["tier"],
  roles: [],
  accessToken: "a",
  refreshToken: "r",
  expiresAt: 1,
};

beforeAll(() => {
  process.env.SESSION_SECRET = "test-session-secret";
});

describe("getSession", () => {
  it("round-trips an encrypted cookie", () => {
    const { cookies, store } = jar();
    setSession(cookies, data);
    expect(store.get(NAME)).not.toContain("userId");
    expect(getSession(cookies)).toEqual(data);
  });

  it("rejects a plain JSON cookie", () => {
    const { cookies } = jar(JSON.stringify({ ...data, tier: "owner" }));
    expect(getSession(cookies)).toBeNull();
  });

  it("rejects tampered ciphertext", () => {
    const { cookies, store } = jar();
    setSession(cookies, data);
    const buf = Buffer.from(store.get(NAME)!, "base64");
    buf[buf.length - 1] ^= 1;
    store.set(NAME, buf.toString("base64"));
    expect(getSession(cookies)).toBeNull();
  });

  it("returns null when no cookie is set", () => {
    expect(getSession(jar().cookies)).toBeNull();
  });
});
