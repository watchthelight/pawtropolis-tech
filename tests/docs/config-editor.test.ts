/**
 * Pawtropolis Tech -- tests/docs/config-editor.test.ts
 * WHAT: The bot's editable guild_config columns, the canonical validation rules, the
 *       dashboard's copy of those rules, and the dashboard's field metadata all name
 *       the same set of columns.
 * WHY: A column the bot accepts but the editor rejects is a missing feature, and the
 *      web copy of the rules is a hand-synced duplicate (#00273, #00272).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_CONFIG_COLUMNS } from "../../src/lib/config.js";
import { CONFIG_FIELD_RULES as botRules } from "../../src/lib/configValidation.js";
import { CONFIG_FIELD_RULES as webRules } from "../../web/src/lib/shared/configValidation.js";

const ROOT = path.resolve(__dirname, "../..");

/** Keys of FIELD_META in web/src/lib/server/queries/config.ts (the module needs $lib). */
function fieldMetaKeys(): string[] {
  const text = readFileSync(path.join(ROOT, "web/src/lib/server/queries/config.ts"), "utf8");
  const start = text.indexOf("const FIELD_META");
  const end = text.indexOf("\n};", start);
  return [...text.slice(start, end).matchAll(/^  ([a-z_]+): \{/gm)].map((m) => m[1]!);
}

// Shown on the dashboard but toggled through /panic, never through the editor.
const DISPLAY_ONLY = new Set(["panic_mode"]);

const sorted = (xs: Iterable<string>) => [...xs].filter((k) => !DISPLAY_ONLY.has(k)).sort();

describe("guild_config editor parity", () => {
  const bot = sorted(ALLOWED_CONFIG_COLUMNS);

  it("canonical validation rules cover exactly the bot's editable columns", () => {
    expect(sorted(Object.keys(botRules))).toEqual(bot);
  });

  it("the dashboard copy of the rules matches the canonical rules key by key", () => {
    expect(sorted(Object.keys(webRules))).toEqual(sorted(Object.keys(botRules)));
    for (const key of Object.keys(botRules)) {
      expect(webRules[key]?.type, key).toBe(botRules[key]!.type);
      expect(webRules[key]?.minTier, key).toBe(botRules[key]!.minTier);
    }
  });

  it("the dashboard field metadata covers exactly the bot's editable columns", () => {
    expect(sorted(fieldMetaKeys())).toEqual(bot);
  });
});
