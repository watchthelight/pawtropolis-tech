// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/commands/help/registryParity.test.ts
 * WHAT: The /help registry and the slash command manifest list the same commands.
 * WHY: The registry is written by hand. Nothing failed when a new command was left
 *      out of /help, or when /help kept an entry for a command that was removed.
 */
import { describe, expect, it } from "vitest";
import { COMMAND_REGISTRY } from "../../../src/commands/help/registry.js";
import { SLASH_COMMAND_NAMES } from "../../../src/commands/runtimeManifest.js";

// Developer commands that are registered but kept out of /help on purpose.
const HIDDEN_FROM_HELP = ["test", "testidea"];

describe("help registry parity", () => {
  const documented = new Set(COMMAND_REGISTRY.map((command) => command.name));
  const registered = new Set<string>(SLASH_COMMAND_NAMES);

  it("documents every slash command that is not hidden on purpose", () => {
    const missing = [...registered].filter((name) => !documented.has(name)).sort();

    expect(missing).toEqual(HIDDEN_FROM_HELP);
  });

  it("documents no command that is not registered", () => {
    expect([...documented].filter((name) => !registered.has(name))).toEqual([]);
  });
});
