// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi, beforeEach } from "vitest";

const { execFileMock, existsSyncMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  existsSyncMock: vi.fn(() => true),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFile: execFileMock,
}));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: existsSyncMock,
}));
vi.mock("../../src/lib/env.js", () => ({ env: { DB_PATH: "data/test.db" } }));
vi.mock("../../src/lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  runDbIntegrityCheck,
  refreshDbIntegrity,
  getLastDbIntegrity,
} from "../../src/lib/dbIntegrityCheck.js";

type Cb = (err: Error | null, stdout: string, stderr: string) => void;

function respond(stdout: string, err: Error | null = null) {
  execFileMock.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Cb) => {
    setImmediate(() => cb(err, stdout, ""));
    return {} as never;
  });
}

describe("lib/dbIntegrityCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    existsSyncMock.mockReturnValue(true);
  });

  it("runs the check in a child node process and reports ok", async () => {
    respond(JSON.stringify(["ok"]));
    const result = await runDbIntegrityCheck("quick", "data/test.db");
    expect(result.ok).toBe(true);
    expect(result.message).toBe("ok");
    expect(result.mode).toBe("quick");
    const [cmd, args] = execFileMock.mock.calls[0] as [string, string[]];
    expect(cmd).toBe(process.execPath);
    expect(args[0]).toBe("-e");
    expect(args).toContain("data/test.db");
    expect(args).toContain("quick");
  });

  it("reports corruption rows as a failed check", async () => {
    respond(
      JSON.stringify(["*** in database main ***", "Page 5: btreeInitPage() returns error code 11"])
    );
    const result = await runDbIntegrityCheck("full", "data/test.db");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Page 5");
    expect(result.mode).toBe("full");
  });

  it("reports a killed child as a timeout", async () => {
    respond("", Object.assign(new Error("killed"), { killed: true }));
    const result = await runDbIntegrityCheck("quick", "data/test.db");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/timed out/);
  });

  it("fails without spawning when the database file is missing", async () => {
    existsSyncMock.mockReturnValue(false);
    const result = await runDbIntegrityCheck("quick", "data/missing.db");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/not found/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("shares one child process between concurrent refresh calls and keeps the result", async () => {
    respond(JSON.stringify(["ok"]));
    const [a, b] = await Promise.all([refreshDbIntegrity("quick"), refreshDbIntegrity("quick")]);
    expect(a).toBe(b);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    expect(getLastDbIntegrity().ok).toBe(true);
    expect(getLastDbIntegrity().checkedAt).toBeGreaterThan(0);
  });
});
