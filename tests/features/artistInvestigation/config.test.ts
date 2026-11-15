/**
 * Pawtropolis Tech -- tests/features/artistInvestigation/config.test.ts
 * WHAT: getSettings() reads the lookup keys when it is called.
 * WHY: The keys can be set and removed while the bot runs. A value captured at
 *      start would keep a removed key in use, and a new key would wait for a restart.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSettings } from "../../../src/features/artistInvestigation/config.js";

const NAMES = ["SAUCENAO_API_KEY", "E621_LOGIN", "E621_API_KEY"] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const name of NAMES) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of NAMES) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("getSettings: lookup keys", () => {
  it("has none when nothing is set", () => {
    expect(getSettings()).toMatchObject({
      sauceNaoApiKey: null,
      e621Login: null,
      e621ApiKey: null,
    });
  });

  it("picks up a key that was set after the module loaded", () => {
    process.env.SAUCENAO_API_KEY = "sauce-key";
    process.env.E621_LOGIN = "pawbot";
    process.env.E621_API_KEY = "e6-key";

    expect(getSettings()).toMatchObject({
      sauceNaoApiKey: "sauce-key",
      e621Login: "pawbot",
      e621ApiKey: "e6-key",
    });
  });

  it("drops a key as soon as it is removed", () => {
    process.env.SAUCENAO_API_KEY = "sauce-key";
    expect(getSettings().sauceNaoApiKey).toBe("sauce-key");

    delete process.env.SAUCENAO_API_KEY;
    expect(getSettings().sauceNaoApiKey).toBeNull();
  });

  it("treats a blank line copied from .env.example as no key", () => {
    process.env.SAUCENAO_API_KEY = "";
    process.env.E621_LOGIN = "   ";

    expect(getSettings()).toMatchObject({ sauceNaoApiKey: null, e621Login: null });
  });

  it("trims what is around a key", () => {
    process.env.E621_API_KEY = "  e6-key\r";

    expect(getSettings().e621ApiKey).toBe("e6-key");
  });
});
