// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/pages/security.redirect.test.ts
 * WHAT: Unit test for dashboard/security/+page.server.ts load().
 * WHY: Tiny but load-bearing: the legacy /dashboard/security route MUST
 *      301 -> /dashboard/audit/security. Any accidental change to the path
 *      or status breaks bookmarks and external links.
 */

import { describe, expect, it } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { load } = await import(
  "../../../web/src/routes/dashboard/security/+page.server.js"
);

describe("dashboard/security load()", () => {
  it("301 -> /dashboard/audit/security", async () => {
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      load(makeEvent({ method: "GET" }) as any),
    ).rejects.toMatchObject({
      status: 301,
      location: "/dashboard/audit/security",
    });
  });
});
