// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/deploy.test.ts
 * WHAT: Runs deploy.sh against a fake remote and checks when it installs
 *       dependencies there. ssh, scp, node, npm, npx, pm2, systemctl, sqlite3
 *       and sleep are stand-in scripts on PATH; the "remote" is a temp directory.
 * WHY: The script used to compare the local lockfile with the remote one after
 *      its own tarball had replaced the remote one. The two always matched, so
 *      npm ci never ran on the host and production kept the packages of an
 *      install from months earlier. A second way to end up with the wrong
 *      packages is a new Node major on the host: the lockfile is the same and
 *      the compiled modules no longer load. Nothing here opens a network
 *      connection.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// On Windows the script needs Git Bash; without it there is nothing to run.
const GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const bash = process.platform === "win32" ? (existsSync(GIT_BASH) ? GIT_BASH : null) : "bash";

const slash = (p: string) => p.split(path.sep).join("/");
const DEPLOY_SH = slash(path.resolve("deploy.sh"));

const FAKES: Record<string, string> = {
  // Drops the options and the user@host argument, then runs the command here.
  ssh: `#!/bin/bash
while [ "$1" = "-o" ]; do shift 2; done
shift
exec bash -c "$*"
`,
  scp: `#!/bin/bash
while [ "$1" = "-o" ]; do shift 2; done
cp "$1" "\${2#*@*:}"
`,
  // The remote's Node. It answers the one question the script asks it, and
  // does nothing when the script starts the migration runner or the command sync.
  node: `#!/bin/bash
if [ "$1" = "-p" ]; then echo "$FAKE_NODE_ABI"; fi
`,
  // npm ci starts from an empty node_modules, so the key of the last install goes.
  npm: `#!/bin/bash
echo "npm $* | $PWD" >> "$FAKE_LOG"
if [ "$1" = "ci" ]; then
  mkdir -p node_modules
  rm -f node_modules/.install-key
fi
`,
  npx: `#!/bin/bash
echo "BUILD_GIT_SHA=test" > .env.build
`,
  pm2: `#!/bin/bash
echo "pm2 $*" >> "$FAKE_LOG"
case "$1" in
  show) echo "status   : online"; echo "restarts : 0" ;;
  logs) echo "Bot ready" ;;
esac
`,
  systemctl: `#!/bin/bash
echo active
`,
  sqlite3: `#!/bin/bash
echo 001
`,
  sleep: `#!/bin/bash
exit 0
`,
};

let root = "";
let local = "";
let remote = "";
let logFile = "";
// The module ABI number the remote's Node reports: 115 is Node 20, 137 is Node 24.
let remoteAbi = "115";

function write(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** The key an install from this lockfile leaves, under the remote's current Node. */
function installKey(lockfile: string): string {
  const sha256 = createHash("sha256").update(readFileSync(lockfile)).digest("hex");
  return `${sha256} node-abi-${remoteAbi}`;
}

function marker(dir: string): string | null {
  const file = path.join(dir, "node_modules", ".install-key");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

function deploy(...args: string[]): { status: number | null; output: string; installs: string[] } {
  writeFileSync(logFile, "");
  const result = spawnSync(
    bash as string,
    [
      "-c",
      'export PATH="$(cygpath -u "$FAKE_BIN" 2>/dev/null || echo "$FAKE_BIN"):$PATH"; exec bash "$DEPLOY_SH" "$@"',
      "deploy-test",
      ...args,
    ],
    {
      cwd: local,
      encoding: "utf8",
      timeout: 100_000,
      env: {
        ...process.env,
        HOME: slash(path.join(root, "home")),
        FAKE_BIN: slash(path.join(root, "bin")),
        FAKE_LOG: slash(logFile),
        FAKE_NODE_ABI: remoteAbi,
        DEPLOY_SH,
        REMOTE_HOST: "fake-host",
        REMOTE_PATH: slash(remote),
        DEPLOY_LOCK_DIR: slash(path.join(root, "deploy.lock")),
        BACKUP_BEFORE_DEPLOY: "0",
      },
    }
  );
  const installs = readFileSync(logFile, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("npm ci --omit=dev | "))
    .map((line) => (line.endsWith("/web") ? "web" : "bot"));
  return { status: result.status, output: `${result.stdout}\n${result.stderr}`, installs };
}

describe.skipIf(!bash)("deploy.sh dependency install", () => {
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "pawtropolis-deploy-test-"));
    local = path.join(root, "local");
    remote = path.join(root, "remote");
    logFile = path.join(root, "fake.log");

    mkdirSync(path.join(root, "bin"));
    for (const [name, body] of Object.entries(FAKES)) {
      writeFileSync(path.join(root, "bin", name), body, { mode: 0o755 });
    }
    write(path.join(root, "home", ".ssh", "config"), "Host fake-host\n  HostName 127.0.0.1\n");

    write(path.join(local, "dist", "index.js"), "");
    write(path.join(local, "dist", "scripts", "commands.js"), "");
    write(path.join(local, "src", "index.ts"), "");
    write(path.join(local, "migrations", "001_init.ts"), "");
    write(path.join(local, "scripts", "migrate-remote.js"), "");
    write(path.join(local, "assets", "banner.txt"), "");
    write(path.join(local, "ecosystem.config.cjs"), "module.exports = { apps: [] };\n");
    write(path.join(local, "package.json"), "{}\n");
    write(path.join(local, "package-lock.json"), '{ "lock": "bot 1" }\n');
    write(path.join(local, "web", "build", "index.js"), "");
    write(path.join(local, "web", "package.json"), "{}\n");
    write(path.join(local, "web", "package-lock.json"), '{ "lock": "web 1" }\n');

    // The host as the old script left it: packages from an earlier install and
    // lockfiles that already equal the ones about to be shipped.
    write(path.join(remote, "node_modules", "old-package", "index.js"), "");
    write(path.join(remote, "web", "node_modules", "old-package", "index.js"), "");
    write(path.join(remote, "package-lock.json"), '{ "lock": "bot 1" }\n');
    write(path.join(remote, "web", "package-lock.json"), '{ "lock": "web 1" }\n');
  });

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it(
    "installs on a host whose lockfiles already match but were never installed",
    { timeout: 120_000 },
    () => {
      const run = deploy();

      expect(run.output).toContain("::DEPLOY_DONE::");
      expect(run.status).toBe(0);
      expect(run.installs).toEqual(["bot", "web"]);
      expect(marker(remote)).toBe(installKey(path.join(local, "package-lock.json")));
      expect(marker(path.join(remote, "web"))).toBe(
        installKey(path.join(local, "web", "package-lock.json"))
      );
    }
  );

  it(
    "skips npm ci when both lockfiles are the ones that were installed",
    { timeout: 120_000 },
    () => {
      const run = deploy();

      expect(run.status).toBe(0);
      expect(run.installs).toEqual([]);
      expect(run.output).toContain("Bot dependencies match the lockfile");
      expect(run.output).toContain("Web dependencies match the lockfile");
    }
  );

  it("installs only where the lockfile changed", { timeout: 120_000 }, () => {
    writeFileSync(path.join(local, "package-lock.json"), '{ "lock": "bot 2" }\n');

    const run = deploy();

    expect(run.status).toBe(0);
    expect(run.installs).toEqual(["bot"]);
    expect(marker(remote)).toBe(installKey(path.join(local, "package-lock.json")));
  });

  it("installs again when node_modules has lost its key", { timeout: 120_000 }, () => {
    rmSync(path.join(remote, "web", "node_modules", ".install-key"));

    const run = deploy();

    expect(run.status).toBe(0);
    expect(run.installs).toEqual(["web"]);
    expect(marker(path.join(remote, "web"))).toBe(
      installKey(path.join(local, "web", "package-lock.json"))
    );
  });

  it(
    "installs both again when the host has moved to another Node major",
    { timeout: 240_000 },
    () => {
      remoteAbi = "137";

      const run = deploy();

      expect(run.status).toBe(0);
      expect(run.installs).toEqual(["bot", "web"]);
      expect(marker(remote)).toBe(installKey(path.join(local, "package-lock.json")));
      expect(marker(path.join(remote, "web"))).toBe(
        installKey(path.join(local, "web", "package-lock.json"))
      );

      // The new Node is the installed one now, so the next deploy has nothing to do.
      expect(deploy().installs).toEqual([]);
    }
  );

  it(
    "--web installs the dashboard dependencies when its lockfile changed",
    { timeout: 120_000 },
    () => {
      writeFileSync(path.join(local, "web", "package-lock.json"), '{ "lock": "web 2" }\n');

      const run = deploy("--web");

      expect(run.output).toContain("::DEPLOY_DONE::");
      expect(run.status).toBe(0);
      expect(run.installs).toEqual(["web"]);
      expect(marker(path.join(remote, "web"))).toBe(
        installKey(path.join(local, "web", "package-lock.json"))
      );
    }
  );

  it("--bot installs the bot dependencies when its lockfile changed", { timeout: 120_000 }, () => {
    writeFileSync(path.join(local, "package-lock.json"), '{ "lock": "bot 3" }\n');

    const run = deploy("--bot");

    expect(run.output).toContain("::DEPLOY_DONE::");
    expect(run.status).toBe(0);
    expect(run.installs).toEqual(["bot"]);
    expect(marker(remote)).toBe(installKey(path.join(local, "package-lock.json")));
  });
});

// The dashboard deploy workflow installs into the same web/node_modules. With a
// different key each of the two would reinstall after the other one ran.
describe("install key", () => {
  it("is built the same way in deploy.sh and in the dashboard deploy workflow", () => {
    const key =
      "$(sha256sum package-lock.json | cut -d' ' -f1) node-abi-$(node -p process.versions.modules)";
    // deploy.sh holds the expression inside a double-quoted string.
    const script = readFileSync("deploy.sh", "utf8").replaceAll("\\$", "$");
    const workflow = readFileSync(".github/workflows/deploy-handbook.yml", "utf8");

    for (const text of [script, workflow]) {
      expect(text).toContain(key);
      expect(text).toContain("node_modules/.install-key");
      expect(text).not.toContain(".lock-sha256");
    }
  });
});
