// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/startup/readyPanicOrder.test.ts
 * WHAT: Panic state must be restored before the slow member-cache warm-up.
 * WHY: isPanicMode() reads an in-memory cache that is empty until loadPanicState()
 *      runs; loading it after a full member fetch left panic mode off after restarts.
 */

import { describe, expect, it, vi } from "vitest";
import { Events } from "discord.js";

const order = vi.hoisted(() => [] as string[]);

vi.mock("../../src/startup/schema.js", () => ({
  runSchemaSelfHeal: vi.fn(async () => {
    order.push("schema");
  }),
}));

vi.mock("../../src/features/panicStore.js", () => ({
  loadPanicState: vi.fn(() => {
    order.push("panic");
  }),
}));

import { registerReady } from "../../src/startup/ready.js";

describe("registerReady startup order", () => {
  it("loads panic state before fetching guild members", async () => {
    let handler: (() => Promise<void>) | undefined;
    const guild = {
      id: "g1",
      members: {
        fetch: vi.fn(() => {
          order.push("fetch");
          return new Promise(() => {});
        }),
      },
    };
    const client = {
      once: vi.fn((event: string, fn: () => Promise<void>) => {
        if (event === Events.ClientReady) handler = fn;
      }),
      guilds: { cache: new Map([["g1", guild]]) },
    };

    registerReady(client as never);
    void handler!();
    await vi.waitFor(() => expect(order).toContain("fetch"));

    expect(order).toEqual(["schema", "panic", "fetch"]);
  });
});
