// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/sse.test.ts
 * WHAT: Unit tests for /api/sse GET handler.
 * WHY: Persistent stream powering live dashboard updates. The fan-out
 *      registration + heartbeat cadence is the only thing keeping the
 *      connection alive through Cloudflare/Nginx proxies; pin the 30s
 *      heartbeat tick AND the removeClient cleanup on stream cancel.
 *      Closes #00043.
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

const { mockAddClient, mockRemoveClient, mockGenerate } = vi.hoisted(() => ({
  mockAddClient: vi.fn(() => true),
  mockRemoveClient: vi.fn(),
  mockGenerate: vi.fn(() => "client-abc"),
}));

vi.mock("$lib/server/events/fan-out", () => ({
  addClient: mockAddClient,
  removeClient: mockRemoveClient,
  generateClientId: mockGenerate,
}));

const { GET } = await import("../../../web/src/routes/api/sse/+server.js");

const viewerUser = { id: "u1", tier: "viewer" } as const;

beforeEach(() => {
  vi.useFakeTimers();
  mockAddClient.mockReset();
  mockAddClient.mockReturnValue(true);
  mockRemoveClient.mockReset();
  mockGenerate.mockReset();
  mockGenerate.mockReturnValue("client-abc");
});

afterEach(() => {
  vi.useRealTimers();
});

function evt(user: typeof viewerUser | null) {
  return makeEvent({ user, method: "GET" });
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const { value, done } = await reader.read();
  if (done || !value) return "";
  return new TextDecoder().decode(value);
}

describe("GET /api/sse", () => {
  it("401 JSON when locals.user is absent", async () => {
    const res = await GET(evt(null));
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toMatch(/application\/json/);
    const json = await res.json();
    expect(json).toEqual({ success: false, error: "Unauthorized" });
    expect(mockAddClient).not.toHaveBeenCalled();
  });

  it("200 returns text/event-stream", async () => {
    const res = await GET(evt(viewerUser));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    await res.body!.cancel();
  });

  it("addClient called with id from generateClientId + user fields", async () => {
    const res = await GET(evt(viewerUser));
    expect(mockAddClient).toHaveBeenCalledTimes(1);
    const arg = mockAddClient.mock.calls[0][0];
    expect(arg).toMatchObject({
      id: "client-abc",
      userId: "u1",
      tier: "viewer",
    });
    expect(typeof arg.send).toBe("function");
    await res.body!.cancel();
  });

  it("stream closes immediately when addClient returns false", async () => {
    mockAddClient.mockReturnValueOnce(false);
    const res = await GET(evt(viewerUser));
    const reader = res.body!.getReader();
    const { done } = await reader.read();
    expect(done).toBe(true);
  });

  it("initial :heartbeat chunk emitted synchronously in start()", async () => {
    const res = await GET(evt(viewerUser));
    const reader = res.body!.getReader();
    const chunk = await readChunk(reader);
    expect(chunk).toBe(":heartbeat\n\n");
    await reader.cancel();
  });

  it("after 30s a second :heartbeat is emitted", async () => {
    const res = await GET(evt(viewerUser));
    const reader = res.body!.getReader();
    expect(await readChunk(reader)).toBe(":heartbeat\n\n"); // initial

    vi.advanceTimersByTime(30_000);
    expect(await readChunk(reader)).toBe(":heartbeat\n\n"); // periodic

    await reader.cancel();
  });

  it("reader.cancel() triggers removeClient with the same id", async () => {
    const res = await GET(evt(viewerUser));
    const reader = res.body!.getReader();
    await readChunk(reader); // drain initial heartbeat
    await reader.cancel();
    expect(mockRemoveClient).toHaveBeenCalledWith("client-abc");
  });
});
