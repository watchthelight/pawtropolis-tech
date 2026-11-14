// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/events/interactionTimeout.test.ts
 * WHAT: interactionCreate is registered with a timeout budget longer than the 10 s default.
 * WHY: Slow slash commands that already deferred were reported as event timeouts.
 */

import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ wrap: vi.fn((_n: string, handler: unknown) => handler) }));

vi.mock("../../src/lib/eventWrap.js", () => ({ wrapEvent: h.wrap }));

import { Collection } from "discord.js";
import { registerInteractionCreate } from "../../src/events/interactionCreate.js";

describe("registerInteractionCreate", () => {
  it("wraps the handler with a budget above the default event timeout", () => {
    const client = { on: vi.fn() };

    registerInteractionCreate(client as never, new Collection());

    const call = h.wrap.mock.calls.find((c) => c[0] === "interactionCreate");
    expect(call).toBeDefined();
    expect(call![2]).toBeGreaterThan(10_000);
  });
});
