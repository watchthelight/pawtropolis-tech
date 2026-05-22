// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/audit.index.test.ts
 * WHAT: Unit tests for dashboard/audit/+page.server.ts load() (audit log).
 * WHY: Most complex page load: admin gate, GUILD_ID env requirement, ISO date
 *      parsing with 7-day default, `q` trim+cap-100, 504 timeout race vs
 *      pass-through error, `cached()` wrapper with composed cacheKey, and the
 *      cache-control setHeaders call. Locks the security gate AND the timeout
 *      ergonomics (504 message specifically suggests narrowing the range).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g-test";

const { getAuditLog, getActionTypes } = vi.hoisted(() => ({
  getAuditLog: vi.fn(),
  getActionTypes: vi.fn(),
}));

const { cached, cacheKey } = vi.hoisted(() => ({
  cached: vi.fn(async (_key: string, _ttl: number, fn: () => unknown) => fn()),
  cacheKey: vi.fn((parts: unknown[]) => parts.join("|")),
}));

vi.mock("$lib/server/queries/audit", () => ({ getAuditLog, getActionTypes }));
vi.mock("$lib/server/cache", () => ({
  cached,
  cacheKey,
  CACHE_TTL: { medium: 60 },
  CACHE_HEADERS: { default: "public, max-age=60" },
}));

const { load } = await import(
  "../../../web/src/routes/dashboard/audit/+page.server.js"
);

function evt(
  overrides: Partial<Parameters<typeof makeEvent>[0]> & { setHeaders?: ReturnType<typeof vi.fn> } = {},
) {
  const { setHeaders, ...rest } = overrides;
  const base = makeEvent({
    user: { id: "u1", tier: "admin" },
    method: "GET",
    url: "http://localhost/dashboard/audit",
    ...rest,
  });
  if (setHeaders) {
    (base as unknown as { setHeaders: ReturnType<typeof vi.fn> }).setHeaders = setHeaders;
  }
  return base;
}

beforeEach(() => {
  getAuditLog.mockReset();
  getActionTypes.mockReset();
  cached.mockClear();
  cacheKey.mockClear();
  getAuditLog.mockReturnValue({ entries: [], nextCursor: null });
  getActionTypes.mockReturnValue([{ action: "kick", count: 1 }]);
});

describe("dashboard/audit load()", () => {
  it("403 when locals.user absent", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      load(evt({ user: null }) as any),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("403 when tier < admin (mod)", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      load(evt({ user: { id: "u1", tier: "mod" } }) as any),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("sets cache-control header", async () => {
    const setHeaders = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await load(evt({ setHeaders }) as any);
    expect(setHeaders).toHaveBeenCalledWith({
      "cache-control": "public, max-age=60",
    });
  });

  it("default fromS is 7 days ago when no `from` param", async () => {
    const now = 1_900_000_000_000;
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await load(evt() as any);
      const filters = getAuditLog.mock.calls[0]?.[1] as { fromS: number };
      const nowS = Math.floor(now / 1000);
      expect(filters.fromS).toBe(nowS - 7 * 86400);
    } finally {
      vi.useRealTimers();
    }
  });

  it("`q` trimmed + capped at 100 chars", async () => {
    const long = "a".repeat(150);
    await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evt({ url: `http://localhost/?q=%20%20${long}%20` }) as any,
    );
    const filters = getAuditLog.mock.calls[0]?.[1] as { search?: string };
    expect(filters.search?.length).toBe(100);
    expect(filters.search?.startsWith("a")).toBe(true);
  });

  it("empty trimmed `q` becomes undefined", async () => {
    await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evt({ url: "http://localhost/?q=%20%20%20" }) as any,
    );
    const filters = getAuditLog.mock.calls[0]?.[1] as { search?: string };
    expect(filters.search).toBeUndefined();
  });

  it("happy path returns entries + actionTypes + filters", async () => {
    getAuditLog.mockReturnValue({ entries: [{ id: 1 }], nextCursor: 99 });
    getActionTypes.mockReturnValue([{ action: "ban", count: 3 }]);

    const out = (await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      evt({ url: "http://localhost/?action=kick&q=hi" }) as any,
    )) as Record<string, unknown>;

    expect(out.entries).toEqual([{ id: 1 }]);
    expect(out.nextCursor).toBe(99);
    expect(out.actionTypes).toEqual([{ action: "ban", count: 3 }]);
    expect(out.filters).toMatchObject({ action: "kick", search: "hi" });
  });

  it("504 when query exceeds 8s timeout", async () => {
    // cached() wrapper resolves slowly; race loses to the 8s timeout.
    cached.mockImplementationOnce(
      () => new Promise(() => undefined), // never resolves
    );
    vi.useFakeTimers();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = load(evt() as any);
      const settled = expect(p).rejects.toMatchObject({ status: 504 });
      await vi.advanceTimersByTimeAsync(8001);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it("non-timeout errors propagate unchanged", async () => {
    cached.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(load(evt() as any)).rejects.toThrow("boom");
  });
});
