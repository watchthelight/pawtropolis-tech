// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/dashboardApiAccess.test.ts
 * WHAT: Tests for the bot-side dashboard API secret check and listen host.
 * WHY: The API accepts moderation mutations on a shared secret. It must compare the
 *      secret in constant time and bind to loopback unless an operator opts out.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Hook = (request: unknown, reply: unknown) => Promise<unknown> | unknown;

const fake = vi.hoisted(() => {
  const state = {
    hooks: [] as Array<(request: unknown, reply: unknown) => unknown>,
    listen: vi.fn(async (_opts: unknown) => undefined),
  };
  const server: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "addHook") return (_name: string, fn: Hook) => void state.hooks.push(fn);
        if (prop === "listen") return state.listen;
        if (prop === "close") return async () => undefined;
        return vi.fn();
      },
    }
  );
  return { state, server };
});

vi.mock("fastify", () => ({ default: () => fake.server }));

const noop = () => undefined;
vi.mock("../../src/web/routes/audit.js", () => ({ registerAuditRoutes: noop }));
vi.mock("../../src/web/routes/context.js", () => ({ createRouteContext: () => ({}) }));
vi.mock("../../src/web/routes/review.js", () => ({ registerReviewRoutes: noop }));
vi.mock("../../src/web/routes/art.js", () => ({ registerArtRoutes: noop }));
vi.mock("../../src/web/routes/scan.js", () => ({ registerScanRoutes: noop }));
vi.mock("../../src/web/routes/levelStats.js", () => ({ registerLevelStatsRoutes: noop }));
vi.mock("../../src/web/routes/config.js", () => ({ registerConfigRoutes: noop }));
vi.mock("../../src/web/routes/health.js", () => ({ registerHealthRoutes: noop }));
vi.mock("../../src/web/routes/modmail.js", () => ({ registerModmailRoutes: noop }));
vi.mock("../../src/web/routes/qotd.js", () => ({ registerQotdRoutes: noop }));
vi.mock("../../src/web/routes/flag.js", () => ({ registerFlagRoutes: noop }));

const SECRET = "correct-horse-battery-staple";

function makeReply() {
  const reply = {
    statusCode: 200,
    body: undefined as unknown,
    code(c: number) {
      reply.statusCode = c;
      return reply;
    },
    send(b: unknown) {
      reply.body = b;
      return reply;
    },
  };
  return reply;
}

async function start() {
  const mod = await import("../../src/web/dashboardApi.js");
  await mod.startDashboardApi({} as never);
  return mod;
}

async function authStatus(header: unknown): Promise<number> {
  const reply = makeReply();
  await fake.state.hooks[0]!({ headers: { "x-dashboard-secret": header }, method: "GET" }, reply);
  return reply.statusCode;
}

beforeEach(() => {
  vi.resetModules();
  fake.state.hooks.length = 0;
  fake.state.listen.mockClear();
  vi.stubEnv("DASHBOARD_API_SECRET", SECRET);
  vi.stubEnv("DASHBOARD_API_HOST", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dashboard API secret", () => {
  it("rejects a wrong, missing or malformed secret", async () => {
    await start();
    expect(await authStatus("wrong")).toBe(401);
    expect(await authStatus(SECRET + "x")).toBe(401);
    expect(await authStatus(undefined)).toBe(401);
    expect(await authStatus([SECRET])).toBe(401);
  });

  it("accepts the right secret", async () => {
    await start();
    expect(await authStatus(SECRET)).toBe(200);
  });
});

describe("dashboard API listen host", () => {
  it("binds to loopback by default", async () => {
    await start();
    expect(fake.state.listen).toHaveBeenCalledWith({ port: 3003, host: "127.0.0.1" });
  });

  it("honours DASHBOARD_API_HOST", async () => {
    vi.stubEnv("DASHBOARD_API_HOST", "0.0.0.0");
    await start();
    expect(fake.state.listen).toHaveBeenCalledWith({ port: 3003, host: "0.0.0.0" });
  });
});
