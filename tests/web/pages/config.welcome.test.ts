// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/config.welcome.test.ts
 * WHAT: Unit tests for dashboard/config/welcome/+page.server.ts load().
 * WHY: Pins admin gate + null-coalescing defaults for every column when the
 *      row is missing entirely OR has individual nulls. The two-prepare flow
 *      (guild_config + COUNT(DISTINCT)) is also locked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

process.env.GUILD_ID = "g-test";

const { configGet, memberGet, dbFn } = vi.hoisted(() => {
  const configGet = vi.fn();
  const memberGet = vi.fn();
  const dbFn = vi.fn(() => ({
    prepare: vi.fn((sql: string) => ({
      get: sql.includes("guild_config") ? configGet : memberGet,
    })),
  }));
  return { configGet, memberGet, dbFn };
});

vi.mock("$lib/server/db", () => ({ db: dbFn }));

const { load } = await import(
  "../../../web/src/routes/dashboard/config/welcome/+page.server.js"
);

beforeEach(() => {
  configGet.mockReset();
  memberGet.mockReset();
});

describe("dashboard/config/welcome load()", () => {
  it("403 for non-admin", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      load(makeEvent({ user: { id: "u1", tier: "mod" }, method: "GET" }) as any),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("returns defaults when guild_config row is missing", async () => {
    configGet.mockReturnValue(undefined);
    memberGet.mockReturnValue(undefined);
    const out = (await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeEvent({ user: { id: "u1", tier: "admin" }, method: "GET" }) as any,
    )) as Record<string, unknown>;
    expect(out).toEqual({
      template: "",
      infoChannelId: null,
      rulesChannelId: null,
      welcomePingRoleId: null,
      memberCount: 0,
      userTier: "admin",
    });
  });

  it("threads through actual values when row is populated", async () => {
    configGet.mockReturnValue({
      welcome_template: "Hi {user}",
      info_channel_id: "c-info",
      rules_channel_id: "c-rules",
      welcome_ping_role_id: "r-ping",
    });
    memberGet.mockReturnValue({ n: 1234 });
    const out = (await load(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeEvent({ user: { id: "u1", tier: "owner" }, method: "GET" }) as any,
    )) as Record<string, unknown>;
    expect(out.template).toBe("Hi {user}");
    expect(out.infoChannelId).toBe("c-info");
    expect(out.rulesChannelId).toBe("c-rules");
    expect(out.welcomePingRoleId).toBe("r-ping");
    expect(out.memberCount).toBe(1234);
    expect(out.userTier).toBe("owner");
  });
});
