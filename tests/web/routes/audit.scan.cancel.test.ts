// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/audit.scan.cancel.test.ts
 * WHAT: Unit tests for /api/audit/scan/cancel POST handler.
 * WHY: Admin-only operation that aborts an in-progress security scan; the
 *      tier gate (admin) is one promotion above the surrounding audit
 *      tier (sa), so a copy-paste mistake to lower the bar would unlock a
 *      privileged action. Pin it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockCallBotApi } = vi.hoisted(() => ({ mockCallBotApi: vi.fn() }));

vi.mock("$lib/server/botApi", () => ({ callBotApi: mockCallBotApi }));

const { POST } = await import(
  "../../../web/src/routes/api/audit/scan/cancel/+server.js"
);

const adminUser = { id: "u1", tier: "admin" } as const;
const validBody = { auditType: "members" };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/audit/scan/cancel", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(makeEvent({ user: null, body: validBody })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below admin (sm should not cancel scans)", async () => {
    await expect(
      POST(makeEvent({ user: { id: "u1", tier: "sm" }, body: validBody })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("403 when tier is jm (well below admin)", async () => {
    await expect(
      POST(makeEvent({ user: { id: "u1", tier: "jm" }, body: validBody })),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("400 on invalid JSON", async () => {
    await expect(
      POST(makeEvent({ user: adminUser, rawBody: "x" })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when auditType missing", async () => {
    await expect(
      POST(makeEvent({ user: adminUser, body: {} })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    const res = await POST(makeEvent({ user: adminUser, body: validBody }));
    expect(res.status).toBe(200);
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/audit/scan/cancel", {
      userId: "u1",
      tier: "admin",
      auditType: "members",
    });
  });

  it("404 when bot error includes 'not found'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "scan not found",
    });
    const res = await POST(makeEvent({ user: adminUser, body: validBody }));
    expect(res.status).toBe(404);
  });

  it("400 fallback on generic bot error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "validation failed",
    });
    const res = await POST(makeEvent({ user: adminUser, body: validBody }));
    expect(res.status).toBe(400);
  });
});
