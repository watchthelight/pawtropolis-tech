// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/audit.scan.start.test.ts
 * WHAT: Unit tests for /api/audit/scan/start POST handler.
 * WHY: Admin-only, with an explicit auditType allowlist of "members" |
 *      "nsfw". The allowlist guard is the only thing preventing arbitrary
 *      strings from being relayed to the bot; pin it. The 403 mapping on
 *      bot-side "permission" errors is also unique to this route.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockCallBotApi } = vi.hoisted(() => ({ mockCallBotApi: vi.fn() }));

vi.mock("$lib/server/botApi", () => ({ callBotApi: mockCallBotApi }));

const { POST } = await import(
  "../../../web/src/routes/api/audit/scan/start/+server.js"
);

const adminUser = { id: "u1", tier: "admin" } as const;
const membersBody = { auditType: "members" };
const nsfwBody = { auditType: "nsfw", scope: { since: "2026-01-01" } };

beforeEach(() => {
  mockCallBotApi.mockReset();
});

describe("POST /api/audit/scan/start", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(makeEvent({ user: null, body: membersBody })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below admin (sm)", async () => {
    await expect(
      POST(makeEvent({ user: { id: "u1", tier: "sm" }, body: membersBody })),
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

  it("400 when auditType not in allowlist", async () => {
    await expect(
      POST(makeEvent({ user: adminUser, body: { auditType: "junk" } })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("200 happy path for auditType=members forwards scope undefined", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    await POST(makeEvent({ user: adminUser, body: membersBody }));
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/audit/scan/start", {
      userId: "u1",
      tier: "admin",
      auditType: "members",
      scope: undefined,
    });
  });

  it("200 happy path for auditType=nsfw forwards scope object", async () => {
    mockCallBotApi.mockResolvedValueOnce({ success: true, data: {} });
    await POST(makeEvent({ user: adminUser, body: nsfwBody }));
    expect(mockCallBotApi).toHaveBeenCalledWith("/api/audit/scan/start", {
      userId: "u1",
      tier: "admin",
      auditType: "nsfw",
      scope: { since: "2026-01-01" },
    });
  });

  it("403 when bot error includes 'permission'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "permission denied on bot side",
    });
    const res = await POST(makeEvent({ user: adminUser, body: membersBody }));
    expect(res.status).toBe(403);
  });

  it("400 fallback on generic bot error", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "scan already in progress",
    });
    const res = await POST(makeEvent({ user: adminUser, body: membersBody }));
    expect(res.status).toBe(400);
  });
});
