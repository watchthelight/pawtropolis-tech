// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/events/modalPayloadLog.test.ts
 * WHAT: With VERBOSE_PAYLOADS=1 the router logs what was typed into a form,
 *       except for the forms that take an API key.
 * WHY: That debug line would write a key into the log file in plain text.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  wrap: vi.fn((_name: string, handler: unknown) => handler),
  isitreal: vi.fn(async () => {}),
  errorCard: vi.fn(async () => {}),
}));

vi.mock("../../src/lib/eventWrap.js", () => ({ wrapEvent: h.wrap }));

vi.mock("../../src/commands/config/isitreal.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/commands/config/isitreal.js")>()),
  routeIsitRealInteraction: h.isitreal,
}));

vi.mock("../../src/lib/errorCard.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/errorCard.js")>()),
  postErrorCard: h.errorCard,
}));

import { Collection, MessageFlags } from "discord.js";
import { registerInteractionCreate } from "../../src/events/interactionCreate.js";
import { logger } from "../../src/lib/logger.js";

type Handler = (interaction: unknown) => Promise<void>;

const SECRET = "sk-test-0123456789abcdef";
let nextId = 0;

function modalSubmit(customId: string, fields: Record<string, string>) {
  const no = () => false;
  return {
    id: `modal-log-${nextId++}`,
    customId,
    user: { id: "1000", username: "tester" },
    guildId: "2000",
    channelId: "3000",
    deferred: false,
    replied: false,
    fields: {
      fields: new Map(
        Object.entries(fields).map(([id, value]) => [id, { customId: id, value }] as const)
      ),
    },
    isChatInputCommand: no,
    isButton: no,
    isStringSelectMenu: no,
    isAutocomplete: no,
    isContextMenuCommand: no,
    isUserContextMenuCommand: no,
    isMessageContextMenuCommand: no,
    isMessageComponent: no,
    isModalSubmit: () => true,
    deferReply: vi.fn(async () => {}),
    reply: vi.fn(async () => {}),
    editReply: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
  };
}

function router(): Handler {
  const client = { on: vi.fn() };
  registerInteractionCreate(client as never, new Collection());
  return client.on.mock.calls[0]![1] as Handler;
}

describe("the verbose payload log", () => {
  const levels = ["debug", "info", "warn", "error"] as const;
  let saved: string | undefined;

  /** Everything that reached the logger, as one string. */
  const logged = () =>
    JSON.stringify(levels.flatMap((level) => vi.mocked(logger[level]).mock.calls));

  const events = () =>
    levels
      .flatMap((level) => vi.mocked(logger[level]).mock.calls)
      .map((call) => (call[0] as { evt?: string } | undefined)?.evt);

  beforeEach(() => {
    saved = process.env.VERBOSE_PAYLOADS;
    process.env.VERBOSE_PAYLOADS = "1";
    for (const level of levels) vi.spyOn(logger, level).mockImplementation(() => {});
    h.isitreal.mockClear();
    h.errorCard.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (saved === undefined) delete process.env.VERBOSE_PAYLOADS;
    else process.env.VERBOSE_PAYLOADS = saved;
  });

  it("logs what was typed into an ordinary form", async () => {
    await router()(modalSubmit("some:other:form", { note: "plain words" }));

    expect(events()).toContain("modal_field_values");
    expect(logged()).toContain("plain words");
  });

  it("leaves the values of an API key form out", async () => {
    await router()(modalSubmit("isitreal_modal_hive", { api_key: SECRET }));

    expect(h.isitreal).toHaveBeenCalledTimes(1);
    expect(events()).toContain("modal_fields");
    expect(events()).not.toContain("modal_field_values");
    expect(logged()).not.toContain(SECRET);
  });

  it("leaves the values of the /service-keys form out, all the way through its handler", async () => {
    // Not on the owner list, so the real handler answers with its refusal.
    const interaction = modalSubmit("svckeys:set:vision", { GOOGLE_VISION_API_KEY: SECRET });

    await router()(interaction);

    expect(interaction.reply).toHaveBeenCalledWith({
      content: "❌ This command is only available to the bot owner.",
      flags: MessageFlags.Ephemeral,
    });
    expect(h.errorCard).not.toHaveBeenCalled();
    expect(events()).not.toContain("modal_field_values");
    expect(events()).not.toContain("ix_route_miss");
    expect(logged()).not.toContain(SECRET);
  });

  it("logs no values at all when the flag is off", async () => {
    delete process.env.VERBOSE_PAYLOADS;

    await router()(modalSubmit("some:other:form", { note: "plain words" }));

    expect(events()).not.toContain("modal_field_values");
    expect(logged()).not.toContain("plain words");
  });
});
