// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/commands/updateDownload.test.ts
 * WHAT: Tests for the image download used by /update banner and /update avatar.
 * WHY: A stalled CDN response must not hang the command forever; the fetch carries a timeout signal.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadImage } from "../../src/commands/update.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("downloadImage", () => {
  it("passes an abort signal to fetch", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetchMock);

    const buf = await downloadImage("https://cdn.example.test/a.png");

    expect(buf).toEqual(Buffer.from([1, 2, 3]));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://cdn.example.test/a.png");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("rejects when the request is aborted by the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          })
      )
    );
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const c = new AbortController();
      queueMicrotask(() => c.abort(new DOMException("timed out", "TimeoutError")));
      return c.signal;
    });

    await expect(downloadImage("https://cdn.example.test/a.png")).rejects.toThrow("timed out");
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("no", { status: 404, statusText: "Not Found" })));
    await expect(downloadImage("https://cdn.example.test/a.png")).rejects.toThrow(
      "Failed to download image: Not Found"
    );
  });
});
