// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/tickets/attachments.test.ts
 * WHAT: Ticket attachment mirror download behaviour.
 * WHY: A stalled download with no timeout hung the single mirror worker forever.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  update: vi.fn(),
  writeFile: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock("../../../src/db/db.js", () => ({
  db: {
    prepare: vi.fn((sql: string) => ({
      get: () => ({ total: 0 }),
      all: () => [],
      run: sql.includes("UPDATE ticket_attachment") ? h.update : vi.fn(),
    })),
  },
}));
vi.mock("../../../src/lib/logger.js", () => ({
  logger: { info: h.info, warn: h.warn, error: h.error, debug: vi.fn() },
}));
vi.mock("node:fs", () => ({ mkdirSync: vi.fn(), writeFileSync: h.writeFile }));
vi.mock("node:timers/promises", () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }));

import { enqueuePending } from "../../../src/features/tickets/attachments.js";

const item = {
  id: "att1",
  ticketId: "t1",
  filename: "a.png",
  size: 10,
  url: "https://cdn.example/a.png",
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ticket attachment mirror", () => {
  it("mirrors a successful download", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })
    );

    enqueuePending(item);

    await vi.waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
    expect(h.writeFile).toHaveBeenCalledTimes(1);
  });

  it("passes an abort signal and treats an aborted download as a failed mirror", async () => {
    const signals: unknown[] = [];
    const fetchMock = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
      signals.push(init?.signal);
      return Promise.reject(
        new DOMException("The operation was aborted due to timeout", "TimeoutError")
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    enqueuePending({ ...item, id: "att2" });

    await vi.waitFor(() =>
      expect(h.error).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentId: "att2" }),
        expect.stringContaining("giving up")
      )
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
    expect(h.update).not.toHaveBeenCalled();
  });
});
