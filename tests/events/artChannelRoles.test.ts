// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { ART_CHANNEL_ROLES, roleForArtChannel } from "../../src/events/artChannelRoles.js";

const VERIFIED_YCH_CHANNEL = "1400348438385660017";
const VERIFIED_YCH_ROLE = "1512801521535025152";
const VERIFIED_ARTWORK_CHANNEL = "1400348338972528763";
const VERIFIED_ART_ROLE = "1128921121593507860";

describe("roleForArtChannel", () => {
  it("REGRESSION: maps verified-ych channel to the Verified YCH role", () => {
    expect(roleForArtChannel(VERIFIED_YCH_CHANNEL)).toBe(VERIFIED_YCH_ROLE);
  });

  it("keeps the existing verified-artwork mapping intact", () => {
    expect(roleForArtChannel(VERIFIED_ARTWORK_CHANNEL)).toBe(VERIFIED_ART_ROLE);
  });

  it("returns undefined for an unmapped channel", () => {
    expect(roleForArtChannel("0")).toBeUndefined();
  });

  it("maps every art channel to a distinct role", () => {
    const roles = [...ART_CHANNEL_ROLES.values()];
    expect(new Set(roles).size).toBe(roles.length);
  });
});
