// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/_helpers/requestEvent.ts
 * WHAT: Minimal RequestEvent factory for SvelteKit RequestHandler unit tests.
 * WHY: The dashboard's +server.ts handlers destructure { locals, request }
 *      from RequestEvent. Building the full SvelteKit event is overkill; this
 *      helper produces just the surface area handlers actually read.
 */

import type { RequestEvent } from "@sveltejs/kit";

export interface FakeUser {
  id: string;
  tier: string;
  username?: string;
  globalName?: string | null;
  avatarUrl?: string | null;
  bannerUrl?: string | null;
  accentColor?: number | null;
  roles?: string[];
}

export interface MakeEventOptions {
  user?: FakeUser | null;
  body?: unknown;
  rawBody?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
}

/**
 * Build a RequestEvent stub adequate for any handler that reads:
 *   - locals.user
 *   - request.json() / request.text() / request.headers
 *
 * Handlers that touch cookies, params, platform, fetch, getClientAddress,
 * isDataRequest, setHeaders, or url query parsing need extending.
 */
export function makeEvent(opts: MakeEventOptions = {}): RequestEvent {
  const url = new URL(opts.url ?? "http://localhost:5173/api/test");
  const method = opts.method ?? "POST";

  const rawBody =
    opts.rawBody !== undefined
      ? opts.rawBody
      : opts.body === undefined
        ? undefined
        : JSON.stringify(opts.body);

  const request = new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.headers ?? {}),
    },
    body: method === "GET" || method === "HEAD" ? undefined : rawBody,
  });

  const locals: App.Locals = {} as App.Locals;
  if (opts.user) {
    (locals as { user?: FakeUser }).user = opts.user;
  }

  return {
    locals,
    request,
    url,
    params: {},
    route: { id: null },
    cookies: makeStubCookies(),
    fetch: globalThis.fetch as RequestEvent["fetch"],
    getClientAddress: () => "127.0.0.1",
    platform: undefined,
    setHeaders: () => undefined,
    isDataRequest: false,
    isSubRequest: false,
  } as unknown as RequestEvent;
}

function makeStubCookies(): RequestEvent["cookies"] {
  return {
    get: () => undefined,
    getAll: () => [],
    set: () => undefined,
    delete: () => undefined,
    serialize: () => "",
  } as unknown as RequestEvent["cookies"];
}
