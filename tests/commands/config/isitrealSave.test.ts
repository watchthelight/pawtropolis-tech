/**
 * Pawtropolis Tech -- tests/commands/config/isitrealSave.test.ts
 * WHAT: Tests for the last step of the /config isitreal wizard: a key that
 *       passed its test is written to the host's .env.
 * WHY: That step rewrites the file that holds every secret on the host. It
 *      goes through the same writer as /service-keys, and these tests pin what
 *      that gives: one line per name, every other line kept, and a value the
 *      file cannot hold refused instead of stored wrongly.
 * NOTE: The file is a temp file, and the services' test calls are replaced,
 *       so the repo's own .env is never touched and nothing leaves the machine.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ButtonInteraction, EmbedBuilder, ModalSubmitInteraction } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../../src/lib/owner.js", () => ({ isOwner: vi.fn(() => true) }));
vi.mock("../../../src/lib/envFile.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/lib/envFile.js")>()),
  hostEnvPath: vi.fn(),
}));
vi.mock("../../../src/features/aiDetection/health.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/features/aiDetection/health.js")>()),
  testHive: vi.fn(async () => ({ success: true })),
  testSightEngine: vi.fn(async () => ({ success: true })),
}));

import { routeIsitRealInteraction } from "../../../src/commands/config/isitreal.js";
import { hostEnvPath } from "../../../src/lib/envFile.js";
import { logger } from "../../../src/lib/logger.js";

const USER_ID = "400000000000000008";
const NAMES = ["HIVE_API_KEY", "SIGHTENGINE_API_USER", "SIGHTENGINE_API_SECRET"] as const;
const HIVE_KEY = "hive-key-0123456789abcdef";

const before = new Map<string, string | undefined>();
let dir: string;
let file: string;

const read = () => fs.readFileSync(file, "utf8");

function form(service: string, fields: Record<string, string>) {
  return {
    customId: `isitreal_modal_${service}`,
    user: { id: USER_ID },
    guildId: "300000000000000001",
    fields: { getTextInputValue: (id: string) => fields[id] ?? "" },
    reply: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as ModalSubmitInteraction;
}

function saveButton(service: string) {
  return {
    customId: `isitreal_save_${service}`,
    user: { id: USER_ID },
    guildId: "300000000000000001",
    reply: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction;
}

/** Enter a key in the form, then press "Save to .env". */
async function enterAndSave(service: string, fields: Record<string, string>) {
  await routeIsitRealInteraction(form(service, fields));
  const button = saveButton(service);
  await routeIsitRealInteraction(button);
  return button;
}

function title(button: ButtonInteraction): string | undefined {
  const call = vi.mocked(button.editReply).mock.calls.at(-1);
  if (!call) throw new Error("editReply was not called");
  return (call[0] as { embeds: EmbedBuilder[] }).embeds[0]?.data.title;
}

beforeEach(() => {
  vi.clearAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "isitreal-save-"));
  file = path.join(dir, ".env");
  vi.mocked(hostEnvPath).mockReturnValue(file);
  for (const name of NAMES) {
    before.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const name of NAMES) {
    const value = before.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("/config isitreal: saving a tested key", () => {
  it("replaces the line, drops a second line for the name and keeps the rest", async () => {
    fs.writeFileSync(
      file,
      "DISCORD_TOKEN=keep\r\nHIVE_API_KEY=old\r\n# note\r\nHIVE_API_KEY=older\r\n"
    );

    const button = await enterAndSave("hive", { api_key: `  ${HIVE_KEY} ` });

    expect(read()).toBe(`DISCORD_TOKEN=keep\r\nHIVE_API_KEY=${HIVE_KEY}\r\n# note\r\n`);
    expect(process.env.HIVE_API_KEY).toBe(HIVE_KEY);
    expect(title(button)).toBe("Hive Moderation Configured!");
  });

  it("adds both SightEngine names to a file that has neither", async () => {
    fs.writeFileSync(file, "A=1\n");

    const button = await enterAndSave("sightengine", {
      api_user: "1234567",
      api_secret: "se-secret-abcdef",
    });

    expect(read()).toBe(
      "A=1\nSIGHTENGINE_API_USER=1234567\nSIGHTENGINE_API_SECRET=se-secret-abcdef\n"
    );
    expect(process.env.SIGHTENGINE_API_USER).toBe("1234567");
    expect(process.env.SIGHTENGINE_API_SECRET).toBe("se-secret-abcdef");
    expect(title(button)).toBe("SightEngine Configured!");
  });

  it("refuses a value the file cannot hold and changes nothing", async () => {
    fs.writeFileSync(file, "HIVE_API_KEY=old\n");

    // The old code passed the value to String.replace as the replacement, where
    // "$&" stands for the matched line: the file ended up with a different key.
    const button = await enterAndSave("hive", { api_key: "abc$&def-0123456789" });

    expect(read()).toBe("HIVE_API_KEY=old\n");
    expect(process.env.HIVE_API_KEY).toBeUndefined();
    expect(title(button)).toBe("Save Failed");
    expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain("abc$&def");
  });

  it("logs which names were saved, never a value", async () => {
    fs.writeFileSync(file, "A=1\n");

    await enterAndSave("hive", { api_key: HIVE_KEY });

    const logged = JSON.stringify(
      (["debug", "info", "warn", "error"] as const).flatMap(
        (level) => vi.mocked(logger[level]).mock.calls
      )
    );
    expect(logged).toContain("HIVE_API_KEY");
    expect(logged).not.toContain(HIVE_KEY);
  });

  it("says so when there is no tested key waiting, and leaves the file alone", async () => {
    fs.writeFileSync(file, "A=1\n");
    const button = saveButton("optic");

    await routeIsitRealInteraction(button);

    expect(button.update).toHaveBeenCalledWith({
      content: "This save request has expired. Please configure the service again.",
      embeds: [],
      components: [],
    });
    expect(read()).toBe("A=1\n");
  });
});
