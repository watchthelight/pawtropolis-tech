// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/lib/githubGit.test.ts
 * WHAT: Token-leak tests for the GitHub push paths in /update and /audit security.
 * WHY: git failures used to echo the full command line, which embedded the PAT, into
 *      Discord replies and logs. The token must stay out of argv, errors and logs.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const TOKEN = "ghp_SuperSecretTokenValue1234567890";
const USER = "bot-user";
const B64 = Buffer.from(`${USER}:${TOKEN}`).toString("base64");

const execSyncMock = vi.hoisted(() => vi.fn());
const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execSync: execSyncMock,
  execFileSync: execFileSyncMock,
}));

const loggerCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock("../../src/lib/logger.js", () => {
  const rec = (...a: unknown[]) => void loggerCalls.push(a);
  return {
    logger: { info: rec, warn: rec, error: rec, debug: rec, trace: rec, fatal: rec },
    redact: (v: string) => v,
  };
});

vi.mock("../../src/store/acknowledgedSecurityStore.js", () => ({
  getAcknowledgedIssues: vi.fn(() => new Map()),
  clearStaleAcknowledgments: vi.fn(),
}));

function leakyError(): Error {
  const cmd = `git push https://${USER}:${TOKEN}@github.com/org/repo.git HEAD:main`;
  return Object.assign(new Error(`Command failed: ${cmd}\nremote: ${B64} denied`), {
    stderr: Buffer.from(`fatal: unable to access 'https://${USER}:${TOKEN}@github.com/': 403`),
  });
}

function expectNoLeak(value: unknown) {
  const text = JSON.stringify(value, (_k, v) => (v instanceof Error ? { m: v.message, s: v.stack } : v));
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(B64);
}

beforeEach(() => {
  loggerCalls.length = 0;
  vi.stubEnv("GITHUB_BOT_TOKEN", TOKEN);
  vi.stubEnv("GITHUB_BOT_USERNAME", USER);
  vi.stubEnv("GITHUB_BOT_EMAIL", "bot@example.test");
  vi.stubEnv("GITHUB_REPO", "org/repo");
  execSyncMock.mockImplementation((cmd: string) => {
    if (cmd.startsWith("git status")) return " M assets/banner.png\n";
    if (cmd.startsWith("git rev-parse")) return "abc1234\n";
    if (/^git (push|fetch|pull)/.test(cmd)) throw leakyError();
    return "";
  });
  execFileSyncMock.mockImplementation(() => {
    throw leakyError();
  });
});

afterEach(() => {
  vi.resetModules();
});

describe("/update asset push", () => {
  it("returns a generic error and never exposes the token", async () => {
    const { commitAndPushAssets } = await import("../../src/commands/update.js");
    const result = await commitAndPushAssets("banner");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Push to GitHub failed. Check the bot logs.");
    expectNoLeak(result);
    expect(loggerCalls.length).toBeGreaterThan(0);
    expectNoLeak(loggerCalls);
  });

  it("keeps the token out of every process argument list", async () => {
    execFileSyncMock.mockImplementation(() => "");
    const { commitAndPushAssets } = await import("../../src/commands/update.js");
    const result = await commitAndPushAssets("avatar");

    expect(result.success).toBe(true);
    expectNoLeak(execSyncMock.mock.calls.map((c) => c[0]));
    const [file, args, opts] = execFileSyncMock.mock.calls[0];
    expect(file).toBe("git");
    expect(args).toEqual(["push", "https://github.com/org/repo.git", "HEAD:main"]);
    expectNoLeak(args);
    expect(opts.env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
    expect(opts.env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${B64}`);
  });
});

describe("/audit security docs push", () => {
  it("returns a generic error and never exposes the token", async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith("git status")) return " M docs/internal-info/CONFLICTS.md\n";
      if (cmd.startsWith("git rev-parse")) return "abc1234\n";
      if (/^git (push|fetch|pull)/.test(cmd)) throw leakyError();
      return "";
    });
    const { commitAndPushDocs } = await import("../../src/features/serverAuditDocs.js");
    const result = await commitAndPushDocs({
      roleCount: 1,
      channelCount: 1,
      issueCount: 0,
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: 0,
    } as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Push to GitHub failed. Check the bot logs.");
    expectNoLeak(result);
    expectNoLeak(loggerCalls);
    expectNoLeak(execSyncMock.mock.calls.map((c) => c[0]));
  });
});
