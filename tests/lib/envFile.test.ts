/**
 * Pawtropolis Tech -- tests/lib/envFile.test.ts
 * WHAT: Tests for the .env writer behind /service-keys.
 * WHY: It rewrites the file that holds every secret on the host. A wrong line
 *      ending, a lost line or a value that one parser reads differently would
 *      only show at the next restart.
 * NOTE: Every test writes to a temp directory. The repo's own .env is never touched.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as util from "node:util";
import dotenv from "dotenv";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyEnvChanges, hostEnvPath, isStorableEnvValue } from "../../src/lib/envFile.js";

// Added to Node in 20.12. The comparison is skipped on an older runtime.
const parseEnv = (util as { parseEnv?: (text: string) => Record<string, string | undefined> })
  .parseEnv;

const NAMES = ["ENVFILE_TEST_A", "ENVFILE_TEST_B", "ENVFILE_TEST_C"] as const;

let dir: string;
let file: string;

const read = () => fs.readFileSync(file, "utf8");

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "envfile-"));
  file = path.join(dir, ".env");
  for (const name of NAMES) delete process.env[name];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const name of NAMES) delete process.env[name];
});

describe("hostEnvPath", () => {
  it("is the .env in the working directory, where PM2 starts both apps", () => {
    expect(hostEnvPath()).toBe(path.join(process.cwd(), ".env"));
  });
});

describe("isStorableEnvValue", () => {
  it.each([
    "Key-with_dash0123456789abcdefghijklmnopq",
    "0123456789abcdef0123456789abcdef01234567",
    "user_name-1",
    "o'brien",
    "abc+def/ghi==",
    "a.b~c:d@e",
  ])("accepts %s", (value) => {
    expect(isStorableEnvValue(value)).toBe(true);
  });

  it.each([
    ["an empty value", ""],
    ["a space", "two words"],
    ["a leading space", " key"],
    ["a trailing space", "key "],
    ["a tab", "key\tvalue"],
    ["a line break", "key\nOTHER=1"],
    ["a carriage return", "key\r"],
    ["a comment sign", "key#rest"],
    ["a dollar sign", "key$HOME"],
    ["a double quote", 'key"quoted"'],
    ["a quote at the start", "'key"],
    ["a backtick", "key`x`"],
    ["a backslash", "key\\n"],
    ["a character outside ASCII", "keý"],
    ["more than 512 characters", "a".repeat(513)],
  ])("refuses %s", (_what, value) => {
    expect(isStorableEnvValue(value)).toBe(false);
  });
});

describe("applyEnvChanges", () => {
  it("creates the file when it is missing", () => {
    applyEnvChanges(file, { ENVFILE_TEST_A: "first" });

    expect(read()).toBe("ENVFILE_TEST_A=first\n");
  });

  it("appends a name the file does not have", () => {
    fs.writeFileSync(file, "# bot\nDISCORD_TOKEN=abc\n");

    applyEnvChanges(file, { ENVFILE_TEST_A: "first", ENVFILE_TEST_B: "second" });

    expect(read()).toBe("# bot\nDISCORD_TOKEN=abc\nENVFILE_TEST_A=first\nENVFILE_TEST_B=second\n");
  });

  it("starts a new line when the file does not end with one", () => {
    fs.writeFileSync(file, "DISCORD_TOKEN=abc");

    applyEnvChanges(file, { ENVFILE_TEST_A: "first" });

    expect(read()).toBe("DISCORD_TOKEN=abc\nENVFILE_TEST_A=first\n");
  });

  it("replaces the value in place and leaves every other line as it was", () => {
    const before = [
      "# Discord",
      "DISCORD_TOKEN=abc.def$ghi",
      "",
      'QUOTED="two words # not a comment"',
      "ENVFILE_TEST_A=old-value # set by hand",
      "  SPACED = 1",
      "# ENVFILE_TEST_A=commented-out",
      "LAST=1",
      "",
    ].join("\n");
    fs.writeFileSync(file, before);

    applyEnvChanges(file, { ENVFILE_TEST_A: "new-value" });

    expect(read()).toBe(
      before.replace("ENVFILE_TEST_A=old-value # set by hand", "ENVFILE_TEST_A=new-value")
    );
  });

  it("drops later lines for the same name, which would win at the next start", () => {
    fs.writeFileSync(file, "ENVFILE_TEST_A=one\nOTHER=1\nENVFILE_TEST_A=two\n");

    applyEnvChanges(file, { ENVFILE_TEST_A: "three" });

    expect(read()).toBe("ENVFILE_TEST_A=three\nOTHER=1\n");
    expect(dotenv.parse(read()).ENVFILE_TEST_A).toBe("three");
  });

  it("keeps an export prefix and the indent", () => {
    fs.writeFileSync(file, "  export ENVFILE_TEST_A = old\n");

    applyEnvChanges(file, { ENVFILE_TEST_A: "new" });

    expect(read()).toBe("  export ENVFILE_TEST_A=new\n");
  });

  it("keeps CRLF line endings", () => {
    fs.writeFileSync(file, "FIRST=1\r\nENVFILE_TEST_A=old\r\nLAST=1\r\n");

    applyEnvChanges(file, { ENVFILE_TEST_A: "new", ENVFILE_TEST_B: "added" });

    expect(read()).toBe("FIRST=1\r\nENVFILE_TEST_A=new\r\nLAST=1\r\nENVFILE_TEST_B=added\r\n");
  });

  it("removes every line for a name set to null", () => {
    fs.writeFileSync(file, "FIRST=1\nENVFILE_TEST_A=one\nENVFILE_TEST_A=two\nLAST=1\n");

    applyEnvChanges(file, { ENVFILE_TEST_A: null });

    expect(read()).toBe("FIRST=1\nLAST=1\n");
  });

  it("does not create a file when there is only something to remove", () => {
    applyEnvChanges(file, { ENVFILE_TEST_A: null });

    expect(fs.existsSync(file)).toBe(false);
  });

  it("is not fooled by a name that only starts the same", () => {
    fs.writeFileSync(file, "ENVFILE_TEST_A_OLD=keep\nXENVFILE_TEST_A=keep\n");

    applyEnvChanges(file, { ENVFILE_TEST_A: "new" });

    expect(read()).toBe("ENVFILE_TEST_A_OLD=keep\nXENVFILE_TEST_A=keep\nENVFILE_TEST_A=new\n");
  });

  it("leaves a line alone whose name is a property every object has", () => {
    fs.writeFileSync(file, "constructor=1\ntoString=2\n");

    applyEnvChanges(file, { ENVFILE_TEST_A: "new" });

    expect(read()).toBe("constructor=1\ntoString=2\nENVFILE_TEST_A=new\n");
  });

  it("makes the same change in process.env", () => {
    process.env.ENVFILE_TEST_B = "to-be-removed";

    applyEnvChanges(file, { ENVFILE_TEST_A: "set", ENVFILE_TEST_B: null });

    expect(process.env.ENVFILE_TEST_A).toBe("set");
    expect(process.env.ENVFILE_TEST_B).toBeUndefined();
  });

  it("leaves no temp file behind", () => {
    applyEnvChanges(file, { ENVFILE_TEST_A: "first" });
    applyEnvChanges(file, { ENVFILE_TEST_A: "second" });

    expect(fs.readdirSync(dir)).toEqual([".env"]);
  });

  it("writes nothing and changes nothing when one value cannot be stored", () => {
    fs.writeFileSync(file, "ENVFILE_TEST_A=old\n");
    process.env.ENVFILE_TEST_A = "old";
    const secret = "new value with spaces";

    let message = "";
    try {
      applyEnvChanges(file, { ENVFILE_TEST_A: "fine", ENVFILE_TEST_B: secret });
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toBe("the value for ENVFILE_TEST_B has a character the .env file cannot hold");
    expect(message).not.toContain(secret);
    expect(read()).toBe("ENVFILE_TEST_A=old\n");
    expect(process.env.ENVFILE_TEST_A).toBe("old");
    expect(process.env.ENVFILE_TEST_B).toBeUndefined();
  });

  it.each(["lower_case", "1LEADING_DIGIT", "WITH-DASH", "WITH SPACE", "A=B", ""])(
    "refuses the name %j",
    (name) => {
      expect(() => applyEnvChanges(file, { [name]: "value" })).toThrow("is not a variable name");
      expect(fs.existsSync(file)).toBe(false);
    }
  );

  it("leaves process.env as it was when the file cannot be written", () => {
    process.env.ENVFILE_TEST_A = "old";
    const unwritable = path.join(dir, "no-such-directory", ".env");

    expect(() => applyEnvChanges(unwritable, { ENVFILE_TEST_A: "new" })).toThrow();

    expect(process.env.ENVFILE_TEST_A).toBe("old");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("does not rewrite the file when nothing changes", () => {
    fs.writeFileSync(file, "ENVFILE_TEST_A=same\n");
    const old = new Date("2020-01-01T00:00:00Z");
    fs.utimesSync(file, old, old);

    applyEnvChanges(file, { ENVFILE_TEST_A: "same" });

    expect(fs.statSync(file).mtime.getTime()).toBe(old.getTime());
    expect(process.env.ENVFILE_TEST_A).toBe("same");
  });

  // Windows has no owner-only mode bits to check.
  it.skipIf(process.platform === "win32")("keeps secrets readable by the owner only", () => {
    applyEnvChanges(file, { ENVFILE_TEST_A: "first" });
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    fs.chmodSync(file, 0o640);
    applyEnvChanges(file, { ENVFILE_TEST_A: "second" });
    expect(fs.statSync(file).mode & 0o777).toBe(0o640);
  });

  describe("what the parsers read back", () => {
    const values = {
      ENVFILE_TEST_A: "Key-with_dash0123456789abcdefghijklmnopq",
      ENVFILE_TEST_B: "o'brien",
      ENVFILE_TEST_C: "abc+def/ghi==:x@y.z~",
    };

    beforeEach(() => {
      fs.writeFileSync(file, '# header\nQUOTED="a b"\nENVFILE_TEST_B=old\n');
      applyEnvChanges(file, values);
    });

    it("dotenv, which the bot uses at start", () => {
      expect(dotenv.parse(read())).toEqual({ QUOTED: "a b", ...values });
    });

    it.skipIf(!parseEnv)("Node's --env-file, which PM2 starts both apps with", () => {
      expect({ ...parseEnv!(read()) }).toEqual({ QUOTED: "a b", ...values });
    });
  });
});
