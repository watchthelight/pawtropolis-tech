// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/commands/service-keys.test.ts
 * WHAT: Tests for /service-keys and its form: who may use them, when a key is
 *       stored, and what is said and logged along the way.
 * WHY: The command handles API keys. Three things must hold in every path:
 *      only an ID on the owner list gets past either handler, a key is stored
 *      only after its service accepted it, and no key ever shows up in a reply
 *      or a log line.
 * NOTE: The .env writer is replaced, so the repo's own .env is never touched.
 *       The services' test calls are replaced too: nothing leaves the machine.
 */
import {
  MessageFlags,
  PermissionFlagsBits,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalBuilder,
  type ModalSubmitInteraction,
  type User,
} from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/lib/owner.js", () => ({ isOwner: vi.fn(() => false) }));
vi.mock("../../src/lib/envFile.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/envFile.js")>()),
  hostEnvPath: vi.fn(() => "/host/.env"),
  applyEnvChanges: vi.fn(),
}));
vi.mock("../../src/features/googleVision.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/features/googleVision.js")>()),
  visionPausedUntil: vi.fn(() => 0),
}));

import { data, execute, handleServiceKeysModal } from "../../src/commands/service-keys.js";
import { visionPausedUntil } from "../../src/features/googleVision.js";
import { KEY_SERVICES, type KeyTest } from "../../src/features/serviceKeys.js";
import { applyEnvChanges, type EnvChanges } from "../../src/lib/envFile.js";
import { logger } from "../../src/lib/logger.js";
import { isOwner } from "../../src/lib/owner.js";
import { createTestCommandContext } from "../utils/contextFactory.js";
import { createMockInteraction, createMockUser } from "../utils/discordMocks.js";

const OWNER_ID = "400000000000000008";
const OTHER_ID = "400000000000000001";
const NAMES = ["GOOGLE_VISION_API_KEY", "SAUCENAO_API_KEY", "E621_LOGIN", "E621_API_KEY"] as const;
const VISION_KEY = "AIzaSy-vision-secret-000111222";
const SAUCE_KEY = "sauce-secret-333444555666777";
const E621_KEY = "e621-secret-888999000aaa";
const SECRETS = [VISION_KEY, SAUCE_KEY, E621_KEY];
const REFUSAL = {
  content: "❌ This command is only available to the bot owner.",
  flags: MessageFlags.Ephemeral,
};
const EPHEMERAL = { flags: MessageFlags.Ephemeral };
const NO_MENTIONS = { parse: [] };

const saved = new Map<string, string | undefined>();
const tests = new Map<
  string,
  ReturnType<typeof vi.fn<(values: Record<string, string>) => Promise<KeyTest>>>
>();

const mockUser = (id: string) => createMockUser({ id } as Partial<User>);

function command(sub: string, service: string | null = null, userId = OWNER_ID) {
  const interaction = createMockInteraction({
    user: mockUser(userId),
    options: { getSubcommand: sub, getString: { service } },
  } as Parameters<typeof createMockInteraction>[0]);
  return { interaction, ctx: createTestCommandContext(interaction) };
}

function form(serviceId: string, fields: Record<string, string>, userId = OWNER_ID) {
  const interaction = {
    id: "modal-123",
    customId: `svckeys:set:${serviceId}`,
    user: mockUser(userId),
    guildId: "300000000000000001",
    deferred: false,
    replied: false,
    fields: {
      getTextInputValue: vi.fn((id: string) => {
        const value = fields[id];
        if (value === undefined) throw new Error(`no field ${id}`);
        return value;
      }),
    },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockImplementation(async function (this: { deferred: boolean }) {
      this.deferred = true;
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as ModalSubmitInteraction;
  return { interaction, ctx: createTestCommandContext(interaction) };
}

type Replier = Pick<ChatInputCommandInteraction, "reply" | "editReply" | "followUp">;

/** Everything the handler said, in any way, as one string. */
const said = (interaction: Replier) =>
  JSON.stringify([
    vi.mocked(interaction.reply).mock.calls,
    vi.mocked(interaction.editReply).mock.calls,
    vi.mocked(interaction.followUp).mock.calls,
  ]);

/** Everything that reached the logger, as one string. */
const logged = () =>
  JSON.stringify(
    (["debug", "info", "warn", "error"] as const).flatMap(
      (level) => vi.mocked(logger[level]).mock.calls
    )
  );

const loggedEvents = () =>
  (["debug", "info", "warn", "error"] as const)
    .flatMap((level) => vi.mocked(logger[level]).mock.calls)
    .map((call) => (call[0] as { evt?: string }).evt);

function edited(interaction: Replier): string {
  const call = vi.mocked(interaction.editReply).mock.calls.at(-1);
  if (!call) throw new Error("editReply was not called");
  return (call[0] as { content: string }).content;
}

function expectNoSecrets(interaction: Replier) {
  for (const secret of SECRETS) {
    expect(said(interaction)).not.toContain(secret);
    expect(logged()).not.toContain(secret);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isOwner).mockImplementation((id) => id === OWNER_ID);
  vi.mocked(visionPausedUntil).mockReturnValue(0);
  // Like the real writer, minus the file.
  vi.mocked(applyEnvChanges).mockImplementation((_path: string, changes: EnvChanges) => {
    for (const [name, value] of Object.entries(changes)) {
      if (value === null) delete process.env[name];
      else process.env[name] = value;
    }
  });
  for (const name of NAMES) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  for (const service of KEY_SERVICES) {
    tests.set(service.id, vi.spyOn(service, "test").mockResolvedValue({ ok: true }));
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const name of NAMES) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const testOf = (id: string) => {
  const spy = tests.get(id);
  if (!spy) throw new Error(`no service ${id}`);
  return spy;
};

describe("/service-keys: the command definition", () => {
  const json = data.toJSON();
  const sub = (name: string) => {
    const found = json.options?.find((option) => option.name === name);
    if (!found) throw new Error(`no subcommand ${name}`);
    return found as unknown as {
      description: string;
      options?: { name: string; required?: boolean; choices?: { name: string; value: string }[] }[];
    };
  };

  it("is a guild command that members without Administrator do not see", () => {
    expect(json.name).toBe("service-keys");
    expect(json.dm_permission).toBe(false);
    expect(json.default_member_permissions).toBe(String(PermissionFlagsBits.Administrator));
  });

  it("has the four subcommands", () => {
    expect(json.options?.map((option) => option.name)).toEqual(["status", "set", "clear", "test"]);
  });

  it("offers every service as a choice, and only those", () => {
    const choices = KEY_SERVICES.map((service) => ({ name: service.name, value: service.id }));
    for (const name of ["set", "clear", "test"]) {
      expect(sub(name).options?.[0]?.name).toBe("service");
      expect(sub(name).options?.[0]?.choices).toEqual(choices);
    }
  });

  it("needs a service to set or clear, and tests all of them without one", () => {
    expect(sub("set").options?.[0]?.required).toBe(true);
    expect(sub("clear").options?.[0]?.required).toBe(true);
    expect(sub("test").options?.[0]?.required).toBe(false);
    expect(sub("status").options ?? []).toEqual([]);
  });

  it("takes no key as a command option, where Discord would keep it in the command text", () => {
    const names = (json.options ?? []).flatMap((option) =>
      ((option as { options?: { name: string }[] }).options ?? []).map((o) => o.name)
    );
    expect(names.every((name) => name === "service")).toBe(true);
  });
});

describe("/service-keys: who may run it", () => {
  it.each([
    ["status", null],
    ["set", "vision"],
    ["clear", "vision"],
    ["test", null],
  ])("refuses %s for anyone who is not an owner", async (sub, service) => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    const { interaction, ctx } = command(sub, service, OTHER_ID);

    await execute(ctx);

    expect(isOwner).toHaveBeenCalledWith(OTHER_ID);
    expect(interaction.reply).toHaveBeenCalledTimes(1);
    expect(interaction.reply).toHaveBeenCalledWith(REFUSAL);
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(applyEnvChanges).not.toHaveBeenCalled();
    expect(testOf("vision")).not.toHaveBeenCalled();
    expect(process.env.GOOGLE_VISION_API_KEY).toBe(VISION_KEY);
  });

  it("does not let Administrator stand in for the owner list", async () => {
    const { interaction, ctx } = command("status", null, OTHER_ID);
    (interaction as { memberPermissions?: unknown }).memberPermissions = {
      has: () => true,
    };

    await execute(ctx);

    expect(interaction.reply).toHaveBeenCalledWith(REFUSAL);
  });
});

describe("/service-keys status", () => {
  it("answers privately", async () => {
    const { interaction, ctx } = command("status");

    await execute(ctx);

    expect(interaction.deferReply).toHaveBeenCalledWith(EPHEMERAL);
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(vi.mocked(interaction.editReply).mock.calls[0]![0]).toMatchObject({
      allowedMentions: NO_MENTIONS,
    });
  });

  it("says what is missing and what that costs when nothing is stored", async () => {
    const { interaction, ctx } = command("status");

    await execute(ctx);

    const text = edited(interaction);
    expect(text).toContain("**Google Vision:** no key. Avatars are not scanned");
    expect(text).toContain("**SauceNAO:** no key. `/investigate-artist` skips the SauceNAO lookup");
    expect(text).toContain("**e621:** no key. `/investigate-artist` skips the e621 lookup");
  });

  it("says which keys are stored and never shows one", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    process.env.SAUCENAO_API_KEY = SAUCE_KEY;
    process.env.E621_LOGIN = "pawbot";
    process.env.E621_API_KEY = E621_KEY;
    const { interaction, ctx } = command("status");

    await execute(ctx);

    const text = edited(interaction);
    expect(text).toContain("**Google Vision:** key stored.");
    expect(text).toContain("**SauceNAO:** key stored.");
    expect(text).toContain("**e621:** key stored.");
    expect(text).not.toContain("pawbot");
    expectNoSecrets(interaction);
  });

  it("names the missing half of a two-part key", async () => {
    process.env.E621_LOGIN = "pawbot";
    const { interaction, ctx } = command("status");

    await execute(ctx);

    expect(edited(interaction)).toContain("**e621:** incomplete, missing: API key.");
  });

  it("says when the avatar scans are paused", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    vi.mocked(visionPausedUntil).mockReturnValue(1_800_000_000_000);
    const { interaction, ctx } = command("status");

    await execute(ctx);

    expect(edited(interaction)).toContain("Scans are paused until <t:1800000000:t>");
  });

  it("makes no test call and changes nothing", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    const { ctx } = command("status");

    await execute(ctx);

    for (const service of KEY_SERVICES) expect(testOf(service.id)).not.toHaveBeenCalled();
    expect(applyEnvChanges).not.toHaveBeenCalled();
  });
});

describe("/service-keys set", () => {
  function shownForm(interaction: ChatInputCommandInteraction) {
    const call = vi.mocked(interaction.showModal).mock.calls[0];
    if (!call) throw new Error("no form was shown");
    return (call[0] as ModalBuilder).toJSON();
  }

  it("opens a form as the first answer, with no defer before it", async () => {
    const { interaction, ctx } = command("set", "vision");

    await execute(ctx);

    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    const modal = shownForm(interaction);
    expect(modal.custom_id).toBe("svckeys:set:vision");
    expect(modal.title).toBe("Google Vision: enter the key");
  });

  it("asks for one short required field per part of the key", async () => {
    const { interaction, ctx } = command("set", "e621");

    await execute(ctx);

    const inputs = shownForm(interaction).components.map((row) => row.components[0]!);
    expect(inputs.map((input) => input.custom_id)).toEqual(["E621_LOGIN", "E621_API_KEY"]);
    expect(inputs.map((input) => input.label)).toEqual(["Account name", "API key"]);
    for (const input of inputs) {
      expect(input.style).toBe(TextInputStyle.Short);
      expect(input.required).toBe(true);
    }
  });

  it("never puts a stored key into the form", async () => {
    process.env.E621_LOGIN = "pawbot";
    process.env.E621_API_KEY = E621_KEY;
    const { interaction, ctx } = command("set", "e621");

    await execute(ctx);

    const modal = shownForm(interaction);
    for (const row of modal.components) {
      expect(row.components[0]!.value).toBeUndefined();
      expect(row.components[0]!.placeholder).toBeUndefined();
    }
    expect(JSON.stringify(modal)).not.toContain(E621_KEY);
  });

  it("stores and tests nothing by itself", async () => {
    const { ctx } = command("set", "saucenao");

    await execute(ctx);

    expect(testOf("saucenao")).not.toHaveBeenCalled();
    expect(applyEnvChanges).not.toHaveBeenCalled();
  });

  it("answers privately when the service is not one it knows", async () => {
    const { interaction, ctx } = command("set", "nope");

    await execute(ctx);

    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({ content: "Unknown service.", ...EPHEMERAL });
  });
});

describe("/service-keys clear", () => {
  it("removes the key from the file and the running bot", async () => {
    process.env.SAUCENAO_API_KEY = SAUCE_KEY;
    const { interaction, ctx } = command("clear", "saucenao");

    await execute(ctx);

    expect(interaction.deferReply).toHaveBeenCalledWith(EPHEMERAL);
    expect(applyEnvChanges).toHaveBeenCalledTimes(1);
    expect(applyEnvChanges).toHaveBeenCalledWith("/host/.env", { SAUCENAO_API_KEY: null });
    expect(process.env.SAUCENAO_API_KEY).toBeUndefined();
    expect(edited(interaction)).toContain("**SauceNAO: key removed.**");
    expect(edited(interaction)).toContain("skips the SauceNAO lookup");
    expect(loggedEvents()).toContain("service_key_cleared");
    expectNoSecrets(interaction);
  });

  it("removes both parts of a two-part key, also when only one is there", async () => {
    process.env.E621_LOGIN = "pawbot";
    const { ctx } = command("clear", "e621");

    await execute(ctx);

    expect(applyEnvChanges).toHaveBeenCalledWith("/host/.env", {
      E621_LOGIN: null,
      E621_API_KEY: null,
    });
  });

  it("leaves the other services' keys alone", async () => {
    process.env.SAUCENAO_API_KEY = SAUCE_KEY;
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    const { ctx } = command("clear", "saucenao");

    await execute(ctx);

    expect(process.env.GOOGLE_VISION_API_KEY).toBe(VISION_KEY);
  });

  it("does not touch the file when there is nothing to remove", async () => {
    const { interaction, ctx } = command("clear", "vision");

    await execute(ctx);

    expect(applyEnvChanges).not.toHaveBeenCalled();
    expect(edited(interaction)).toBe("Google Vision has no key stored.");
  });

  it("answers privately with a trace when the file cannot be written", async () => {
    process.env.SAUCENAO_API_KEY = SAUCE_KEY;
    vi.mocked(applyEnvChanges).mockImplementation(() => {
      throw Object.assign(new Error("EACCES: permission denied, open '/host/.env.1.tmp'"), {
        code: "EACCES",
      });
    });
    const { interaction, ctx } = command("clear", "saucenao");

    await expect(execute(ctx)).resolves.toBeUndefined();

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content:
        "Something went wrong. `/service-keys status` shows what is stored now. Trace: `test-trace-123`",
      ...EPHEMERAL,
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "service_keys_failed", code: "EACCES", phase: "clear" }),
      expect.any(String)
    );
    expect(process.env.SAUCENAO_API_KEY).toBe(SAUCE_KEY);
    expectNoSecrets(interaction);
  });
});

describe("/service-keys test", () => {
  it("tries every stored key with the stored values and skips the rest", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    process.env.E621_LOGIN = "pawbot";
    process.env.E621_API_KEY = E621_KEY;
    const { interaction, ctx } = command("test");

    await execute(ctx);

    expect(testOf("vision")).toHaveBeenCalledWith({ GOOGLE_VISION_API_KEY: VISION_KEY });
    expect(testOf("e621")).toHaveBeenCalledWith({ E621_LOGIN: "pawbot", E621_API_KEY: E621_KEY });
    expect(testOf("saucenao")).not.toHaveBeenCalled();
    const text = edited(interaction);
    expect(text).toContain("**Google Vision:** accepted.");
    expect(text).toContain("**SauceNAO:** no key stored, nothing to test.");
    expect(text).toContain("**e621:** accepted.");
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        evt: "service_key_test",
        outcome: { vision: "accepted", saucenao: "no_key", e621: "accepted" },
      }),
      expect.any(String)
    );
    expectNoSecrets(interaction);
  });

  it("tests one service when one is named", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    process.env.SAUCENAO_API_KEY = SAUCE_KEY;
    const { interaction, ctx } = command("test", "saucenao");

    await execute(ctx);

    expect(testOf("saucenao")).toHaveBeenCalledTimes(1);
    expect(testOf("vision")).not.toHaveBeenCalled();
    expect(edited(interaction)).toBe(
      "**Key test**\n**SauceNAO:** accepted. The test used one search of the account's daily allowance."
    );
  });

  it("does not test half of a two-part key", async () => {
    process.env.E621_API_KEY = E621_KEY;
    const { interaction, ctx } = command("test", "e621");

    await execute(ctx);

    expect(testOf("e621")).not.toHaveBeenCalled();
    expect(edited(interaction)).toContain("**e621:** no key stored, nothing to test.");
  });

  it("passes on what the service answered, without the key", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    testOf("vision").mockResolvedValue({
      ok: false,
      reason: `HTTP 403: billing is off for the project of ${VISION_KEY}`,
    });
    const { interaction, ctx } = command("test", "vision");

    await execute(ctx);

    expect(edited(interaction)).toBe(
      "**Key test**\n**Google Vision:** failed. HTTP 403: billing is off for the project of [key]"
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "service_key_test", outcome: { vision: "failed" } }),
      expect.any(String)
    );
    // Google's answer can name the project. It goes to the owner, not to the log.
    expect(logged()).not.toContain("billing");
    expectNoSecrets(interaction);
  });

  it("changes nothing, whatever the outcome", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    testOf("vision").mockResolvedValue({ ok: false, reason: "HTTP 400" });
    const { ctx } = command("test");

    await execute(ctx);

    expect(applyEnvChanges).not.toHaveBeenCalled();
    expect(process.env.GOOGLE_VISION_API_KEY).toBe(VISION_KEY);
  });

  it("answers privately with a trace when a test call breaks", async () => {
    process.env.GOOGLE_VISION_API_KEY = VISION_KEY;
    testOf("vision").mockRejectedValue(new Error(`boom with ${VISION_KEY} inside`));
    const { interaction, ctx } = command("test", "vision");

    await expect(execute(ctx)).resolves.toBeUndefined();

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ ...EPHEMERAL, content: expect.stringContaining("test-trace-123") })
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        evt: "service_keys_failed",
        phase: "test_vision",
        errMessage: "boom with [key] inside",
      }),
      expect.any(String)
    );
    expectNoSecrets(interaction);
  });
});

describe("the key form", () => {
  it("refuses anyone who is not an owner, before reading a field", async () => {
    const { interaction, ctx } = form("vision", { GOOGLE_VISION_API_KEY: VISION_KEY }, OTHER_ID);

    await handleServiceKeysModal(ctx);

    expect(isOwner).toHaveBeenCalledWith(OTHER_ID);
    expect(interaction.reply).toHaveBeenCalledWith(REFUSAL);
    expect(interaction.deferReply).not.toHaveBeenCalled();
    expect(interaction.fields.getTextInputValue).not.toHaveBeenCalled();
    expect(testOf("vision")).not.toHaveBeenCalled();
    expect(applyEnvChanges).not.toHaveBeenCalled();
    expectNoSecrets(interaction);
  });

  it("stores a key the service accepted, and says so privately", async () => {
    const { interaction, ctx } = form("vision", { GOOGLE_VISION_API_KEY: `  ${VISION_KEY}\n` });

    await handleServiceKeysModal(ctx);

    expect(interaction.deferReply).toHaveBeenCalledWith(EPHEMERAL);
    expect(testOf("vision")).toHaveBeenCalledWith({ GOOGLE_VISION_API_KEY: VISION_KEY });
    expect(applyEnvChanges).toHaveBeenCalledTimes(1);
    expect(applyEnvChanges).toHaveBeenCalledWith("/host/.env", {
      GOOGLE_VISION_API_KEY: VISION_KEY,
    });
    expect(edited(interaction)).toBe(
      "**Google Vision: key saved.** Google Vision accepted it in a test call. It is in use from now on and stays after a restart."
    );
    expect(logger.info).toHaveBeenCalledWith(
      {
        evt: "service_key_set",
        service: "vision",
        names: ["GOOGLE_VISION_API_KEY"],
        userId: OWNER_ID,
      },
      expect.any(String)
    );
    expectNoSecrets(interaction);
  });

  it("tests before it stores", async () => {
    const order: string[] = [];
    testOf("saucenao").mockImplementation(async () => {
      order.push("test");
      return { ok: true };
    });
    vi.mocked(applyEnvChanges).mockImplementation(() => {
      order.push("store");
    });
    const { ctx } = form("saucenao", { SAUCENAO_API_KEY: SAUCE_KEY });

    await handleServiceKeysModal(ctx);

    expect(order).toEqual(["test", "store"]);
  });

  it("says what a test call spent", async () => {
    const { interaction, ctx } = form("saucenao", { SAUCENAO_API_KEY: SAUCE_KEY });

    await handleServiceKeysModal(ctx);

    expect(edited(interaction)).toContain(
      "The test used one search of the account's daily allowance."
    );
  });

  it("stores both parts of a two-part key in one write", async () => {
    const { ctx } = form("e621", { E621_LOGIN: "pawbot", E621_API_KEY: E621_KEY });

    await handleServiceKeysModal(ctx);

    expect(testOf("e621")).toHaveBeenCalledWith({ E621_LOGIN: "pawbot", E621_API_KEY: E621_KEY });
    expect(applyEnvChanges).toHaveBeenCalledTimes(1);
    expect(applyEnvChanges).toHaveBeenCalledWith("/host/.env", {
      E621_LOGIN: "pawbot",
      E621_API_KEY: E621_KEY,
    });
  });

  it("stores nothing when the service refuses the key, and keeps the old one", async () => {
    process.env.SAUCENAO_API_KEY = "the-old-key-still-works";
    testOf("saucenao").mockResolvedValue({
      ok: false,
      reason: "credentials were rejected (HTTP 403)",
    });
    const { interaction, ctx } = form("saucenao", { SAUCENAO_API_KEY: SAUCE_KEY });

    await handleServiceKeysModal(ctx);

    expect(applyEnvChanges).not.toHaveBeenCalled();
    expect(process.env.SAUCENAO_API_KEY).toBe("the-old-key-still-works");
    expect(edited(interaction)).toBe(
      "**SauceNAO: not saved.** The test call failed: credentials were rejected (HTTP 403)\nNothing was changed. A key that was stored before is still in use."
    );
    expect(loggedEvents()).toContain("service_key_refused");
    expect(loggedEvents()).not.toContain("service_key_set");
    expectNoSecrets(interaction);
  });

  it("takes the key out of what the service answered", async () => {
    testOf("vision").mockResolvedValue({ ok: false, reason: `HTTP 400: bad key ${VISION_KEY}` });
    const { interaction, ctx } = form("vision", { GOOGLE_VISION_API_KEY: VISION_KEY });

    await handleServiceKeysModal(ctx);

    expect(edited(interaction)).toContain("The test call failed: HTTP 400: bad key [key]");
    expectNoSecrets(interaction);
  });

  it.each([
    ["a space inside", "AIza key with spaces"],
    ["a double quote", `"${VISION_KEY}"`],
    ["a hash sign", `${VISION_KEY}#x`],
    ["a dollar sign", `${VISION_KEY}$x`],
    ["a backslash", `${VISION_KEY}\\x`],
    ["a line break inside", "AIzaSy-first\nAIzaSy-second"],
    ["nothing but spaces", "   "],
  ])("refuses a value with %s before any test call", async (_what, value) => {
    const { interaction, ctx } = form("vision", { GOOGLE_VISION_API_KEY: value });

    await handleServiceKeysModal(ctx);

    expect(testOf("vision")).not.toHaveBeenCalled();
    expect(applyEnvChanges).not.toHaveBeenCalled();
    expect(edited(interaction)).toContain('**Not saved.** "API key" is empty or has a character');
    expect(edited(interaction)).toContain("Nothing was changed.");
    expect(said(interaction)).not.toContain("AIza");
    expect(logged()).not.toContain("AIza");
  });

  it("names the part of a two-part key that cannot be stored", async () => {
    const { interaction, ctx } = form("e621", { E621_LOGIN: "paw bot", E621_API_KEY: E621_KEY });

    await handleServiceKeysModal(ctx);

    expect(edited(interaction)).toContain('**Not saved.** "Account name" is empty');
    expect(testOf("e621")).not.toHaveBeenCalled();
  });

  it("changes nothing for a form of a service it does not know", async () => {
    const { interaction, ctx } = form("nope", { GOOGLE_VISION_API_KEY: VISION_KEY });

    await handleServiceKeysModal(ctx);

    expect(edited(interaction)).toBe("Unknown service. Nothing was changed.");
    expect(applyEnvChanges).not.toHaveBeenCalled();
    for (const service of KEY_SERVICES) expect(testOf(service.id)).not.toHaveBeenCalled();
  });

  it("answers privately and keeps the key out of the log when the test call breaks", async () => {
    testOf("vision").mockRejectedValue(new Error(`socket closed while sending ${VISION_KEY}`));
    const { interaction, ctx } = form("vision", { GOOGLE_VISION_API_KEY: VISION_KEY });

    await expect(handleServiceKeysModal(ctx)).resolves.toBeUndefined();

    expect(applyEnvChanges).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ ...EPHEMERAL, content: expect.stringContaining("test-trace-123") })
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        evt: "service_keys_failed",
        phase: "test",
        errMessage: "socket closed while sending [key]",
      }),
      expect.any(String)
    );
    expectNoSecrets(interaction);
  });

  it("answers privately when the key was accepted but the file cannot be written", async () => {
    vi.mocked(applyEnvChanges).mockImplementation(() => {
      throw Object.assign(new Error("EROFS: read-only file system"), { code: "EROFS" });
    });
    const { interaction, ctx } = form("vision", { GOOGLE_VISION_API_KEY: VISION_KEY });

    await expect(handleServiceKeysModal(ctx)).resolves.toBeUndefined();

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ evt: "service_keys_failed", phase: "store", code: "EROFS" }),
      expect.any(String)
    );
    expect(loggedEvents()).not.toContain("service_key_set");
    expect(said(interaction)).not.toContain("key saved");
    expectNoSecrets(interaction);
  });
});
