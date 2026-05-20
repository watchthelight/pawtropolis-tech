// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/config.update.test.ts
 * WHAT: Unit tests for /api/config/update POST handler.
 * WHY: Two-layer authorization: outer admin gate plus a per-field tier
 *      check driven by CONFIG_FIELD_RULES. An admin can update channel
 *      fields but NOT senior-admin fields like silent_first_msg_days.
 *      Tests pin both layers so a regression that collapses them would
 *      silently widen privilege.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockCallBotApi } = vi.hoisted(() => ({ mockCallBotApi: vi.fn() }));

vi.mock("$lib/server/botApi", () => ({ callBotApi: mockCallBotApi }));

const { POST } = await import(
  "../../../web/src/routes/api/config/update/+server.js"
);

const adminUser = { id: "u1", tier: "admin" } as const;

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/config/update", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(
        makeEvent({
          user: null,
          body: { fields: { review_channel_id: "123456789012345678" } },
        }),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below admin", async () => {
    await expect(
      POST(
        makeEvent({
          user: { id: "u1", tier: "sm" },
          body: { fields: { review_channel_id: "123456789012345678" } },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("400 on invalid JSON", async () => {
    await expect(
      POST(makeEvent({ user: adminUser, rawBody: "x" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when fields is absent", async () => {
    await expect(
      POST(makeEvent({ user: adminUser, body: {} })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when fields is empty object", async () => {
    await expect(
      POST(makeEvent({ user: adminUser, body: { fields: {} } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 on unknown field key", async () => {
    await expect(
      POST(
        makeEvent({
          user: adminUser,
          body: { fields: { not_a_real_field: "x" } },
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("403 when admin attempts sa-only field (silent_first_msg_days)", async () => {
    await expect(
      POST(
        makeEvent({
          user: adminUser,
          body: { fields: { silent_first_msg_days: 30 } },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockCallBotApi).not.toHaveBeenCalled();
  });

  it("200 happy path forwards admin field to bot API", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(
      makeEvent({
        user: adminUser,
        body: { fields: { review_channel_id: "123456789012345678" } },
      }),
    );
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/config/update", {
      userId: "u1",
      tier: "admin",
      fields: { review_channel_id: "123456789012345678" },
    });
  });

  it("403 when bot error includes 'permission'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "insufficient permission on bot side",
    });
    const res = await POST(
      makeEvent({
        user: adminUser,
        body: { fields: { review_channel_id: "123456789012345678" } },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("502 when bot error includes 'unreachable'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Bot API unreachable",
    });
    const res = await POST(
      makeEvent({
        user: adminUser,
        body: { fields: { review_channel_id: "123456789012345678" } },
      }),
    );
    expect(res.status).toBe(502);
  });

  it("400 fallback on generic bot error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "rate limited",
    });
    const res = await POST(
      makeEvent({
        user: adminUser,
        body: { fields: { review_channel_id: "123456789012345678" } },
      }),
    );
    expect(res.status).toBe(400);
  });
});
