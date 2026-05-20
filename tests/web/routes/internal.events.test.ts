// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/internal.events.test.ts
 * WHAT: Unit tests for /api/internal/events POST handler.
 * WHY: Bot-to-dashboard webhook receiver. The secret check is the only
 *      gate -- a regression that accepts missing or wrong secrets would
 *      let any caller inject arbitrary SSE events into every dashboard
 *      session. The 64 KB body cap also matters: it stops a hostile caller
 *      from forcing the dashboard to read megabytes of garbage before
 *      validation.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockPublish } = vi.hoisted(() => ({ mockPublish: vi.fn() }));

vi.mock("$lib/server/events/bus", () => ({
  eventBus: { publish: mockPublish },
}));

// Set the secret BEFORE importing the handler -- the handler caches it on
// first read, so a later env mutation wouldn't take effect.
process.env.INTERNAL_SECRET = "test-internal-secret-do-not-log";

const { POST } = await import(
  "../../../web/src/routes/api/internal/events/+server.js"
);

const SECRET = "test-internal-secret-do-not-log";
const validEvent = {
  type: "review:claimed",
  timestamp: 1_700_000_000_000,
  payload: { appId: "abc" },
};

function evt(opts: {
  secret?: string;
  body?: unknown;
  rawBody?: string;
  contentLength?: string;
} = {}) {
  const headers: Record<string, string> = {};
  if (opts.secret !== undefined) headers["x-internal-secret"] = opts.secret;
  if (opts.contentLength !== undefined) headers["content-length"] = opts.contentLength;
  return makeEvent({
    user: null,
    method: "POST",
    headers,
    body: opts.body ?? validEvent,
    rawBody: opts.rawBody,
  });
}

beforeEach(() => {
  mockPublish.mockReset();
});

describe("POST /api/internal/events", () => {
  it("401 when x-internal-secret header is absent", async () => {
    const res = await POST(evt({}));
    expect(res.status).toBe(401);
  });

  it("401 when secret is wrong", async () => {
    const res = await POST(evt({ secret: "nope" }));
    expect(res.status).toBe(401);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("413 when content-length exceeds 64 KB", async () => {
    const res = await POST(
      evt({ secret: SECRET, contentLength: String(64 * 1024 + 1) }),
    );
    expect(res.status).toBe(413);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("400 on invalid JSON body", async () => {
    const res = await POST(evt({ secret: SECRET, rawBody: "not-json" }));
    expect(res.status).toBe(400);
  });

  it("400 when event type missing", async () => {
    const res = await POST(
      evt({
        secret: SECRET,
        body: { timestamp: 123, payload: {} },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400 when type is missing the required colon", async () => {
    const res = await POST(
      evt({
        secret: SECRET,
        body: { ...validEvent, type: "noprefix" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400 when timestamp is not a finite number", async () => {
    const res = await POST(
      evt({
        secret: SECRET,
        body: { ...validEvent, timestamp: "yesterday" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400 when timestamp is NaN", async () => {
    const res = await POST(
      evt({
        secret: SECRET,
        body: { ...validEvent, timestamp: NaN },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400 when payload field is absent", async () => {
    const res = await POST(
      evt({
        secret: SECRET,
        body: { type: validEvent.type, timestamp: validEvent.timestamp },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("200 happy path publishes event to bus", async () => {
    const res = await POST(evt({ secret: SECRET }));
    expect(res.status).toBe(200);
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith(validEvent);
  });
});
