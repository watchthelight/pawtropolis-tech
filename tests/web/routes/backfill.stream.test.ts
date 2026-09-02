// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/backfill.stream.test.ts
 * WHAT: Unit tests for /api/backfill/stream GET handler.
 * WHY: Owner-only SSE feed of backfill progress. The hashed channels guard
 *      prevents emitting noisy `channels` events when nothing changed; pin
 *      that the same channels payload between ticks emits the row exactly
 *      once, and the same goes for an unchanged stats payload. The 3s tick +
 *      25s heartbeat cadence is also pinned so a cleanup-on-cancel regression
 *      would surface.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockStats, mockChannels, mockCounts } = vi.hoisted(() => ({
  mockStats: vi.fn(),
  mockChannels: vi.fn(),
  mockCounts: vi.fn(),
}));

vi.mock("$lib/server/queries/backfill", () => ({
  getBackfillStats: mockStats,
  getBackfillChannels: mockChannels,
  getArchiveCounts: mockCounts,
}));

const { GET } = await import(
  "../../../web/src/routes/api/backfill/stream/+server.js"
);

const ownerUser = { id: "u1", tier: "owner" } as const;

beforeEach(() => {
  vi.useFakeTimers();
  mockStats.mockReset();
  mockStats.mockReturnValue({ totalMessages: 100 });
  mockChannels.mockReset();
  mockChannels.mockReturnValue([]);
  mockCounts.mockReset();
  mockCounts.mockReturnValue({ archived: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

function evt(user: typeof ownerUser | null) {
  return makeEvent({ user, method: "GET" });
}

const decoder = new TextDecoder();

async function pullN(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  n: number,
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) out.push(decoder.decode(value));
  }
  return out;
}

describe("GET /api/backfill/stream", () => {
  it("403 JSON when locals.user is absent", async () => {
    const res = await GET(evt(null));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json).toEqual({ success: false, error: "forbidden" });
    expect(mockStats).not.toHaveBeenCalled();
  });

  it("403 when tier below owner (admin)", async () => {
    const res = await GET(evt({ id: "u1", tier: "admin" } as never));
    expect(res.status).toBe(403);
  });

  it("200 returns text/event-stream with no-cache + no-transform", async () => {
    const res = await GET(evt(ownerUser));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    await res.body!.cancel();
  });

  it("initial chunks include :ok + stats event + channels event (first hash)", async () => {
    mockChannels.mockReturnValue([
      { channelId: "c1", status: "pending", messagesFetched: 0, reactionsFetched: 0 },
    ]);
    const res = await GET(evt(ownerUser));
    const reader = res.body!.getReader();
    const chunks = await pullN(reader, 3);
    expect(chunks[0]).toBe(":ok\n\n");
    expect(chunks[1]).toContain("event: stats");
    expect(chunks[2]).toContain("event: channels");
    expect(mockStats).toHaveBeenCalledTimes(1);
    expect(mockChannels).toHaveBeenCalledTimes(1);
    await reader.cancel();
  });

  it("after one tick a changed stats payload is emitted", async () => {
    const res = await GET(evt(ownerUser));
    const reader = res.body!.getReader();
    // Drain initial: :ok + stats + channels (hash changed from "" to "[]")
    await pullN(reader, 3);

    mockStats.mockReturnValue({ totalMessages: 150 });
    vi.advanceTimersByTime(3000);
    // Second tick: stats only (channels hash unchanged).
    const second = await pullN(reader, 1);
    expect(second[0]).toContain("event: stats");
    expect(second[0]).toContain("150");
    expect(mockStats).toHaveBeenCalledTimes(2);
    await reader.cancel();
  });

  it("same channels hash between ticks emits channels event only on the first tick", async () => {
    // Channels list is stable across both ticks.
    mockChannels.mockReturnValue([
      { channelId: "c1", status: "pending", messagesFetched: 0, reactionsFetched: 0 },
    ]);
    const res = await GET(evt(ownerUser));
    const reader = res.body!.getReader();
    // Initial: :ok + stats + channels
    const initial = await pullN(reader, 3);
    expect(initial.filter((c) => c.includes("event: channels"))).toHaveLength(1);

    mockStats.mockReturnValue({ totalMessages: 101 });
    vi.advanceTimersByTime(3000);
    // Second tick: only stats; the channels hash hasn't changed.
    const second = await pullN(reader, 1);
    expect(second[0]).toContain("event: stats");
    expect(second[0]).not.toContain("event: channels");
    await reader.cancel();
  });

  it("different channels between ticks emits channels event again", async () => {
    mockChannels.mockReturnValueOnce([
      { channelId: "c1", status: "pending", messagesFetched: 0, reactionsFetched: 0 },
    ]);
    const res = await GET(evt(ownerUser));
    const reader = res.body!.getReader();
    await pullN(reader, 3); // initial

    mockChannels.mockReturnValueOnce([
      { channelId: "c1", status: "done", messagesFetched: 50, reactionsFetched: 10 },
    ]);
    mockStats.mockReturnValue({ totalMessages: 150 });
    vi.advanceTimersByTime(3000);
    const after = await pullN(reader, 2);
    expect(after.some((c) => c.includes("event: stats"))).toBe(true);
    expect(after.some((c) => c.includes("event: channels"))).toBe(true);
    await reader.cancel();
  });

  it("unchanged stats between ticks are not re-sent; after 25s only the :heartbeat arrives", async () => {
    const res = await GET(evt(ownerUser));
    const reader = res.body!.getReader();
    await pullN(reader, 3); // initial

    // Advance 25s: 8 ticks poll the queries but emit nothing because nothing
    // changed, so the next chunk on the wire is the heartbeat.
    vi.advanceTimersByTime(25_000);
    const chunks = await pullN(reader, 1);
    expect(chunks[0]).toContain(":heartbeat");
    expect(mockStats).toHaveBeenCalledTimes(9);
    await reader.cancel();
  });

  it("after cancel both intervals clear: query helpers not called again", async () => {
    const res = await GET(evt(ownerUser));
    const reader = res.body!.getReader();
    await pullN(reader, 3); // initial
    await reader.cancel();

    const statsCallsBefore = mockStats.mock.calls.length;
    vi.advanceTimersByTime(5_000);
    expect(mockStats.mock.calls.length).toBe(statsCallsBefore);
  });
});
