// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * tests/features/inventory/mimuGrants.test.ts
 * WHAT: Reading a Mimu shop purchase out of Mimu's own confirmation message.
 * WHY: Granting a role a member already holds is a no-op on Discord: no
 *      guildMemberUpdate, no audit entry. Taylor bought a Byte Token [Rare] while
 *      already wearing the role and the copy vanished. This message is the only
 *      evidence the purchase happened, so the parse has to hold.
 */
import { describe, it, expect } from "vitest";

import {
  parseShopGrant,
  looksLikeGrant,
  MIMU_BOT_ID,
} from "../../../src/features/inventory/mimuGrants.js";

// Captured verbatim from the live channel.
const REAL =
  "you have used BoyKisser [Cosmetic] . . . \nand you were given the <@&1130461373504159844> role!";

describe("parseShopGrant", () => {
  it("REGRESSION: reads the role out of a real Mimu shop confirmation", () => {
    const grant = parseShopGrant(REAL);

    expect(grant).not.toBeNull();
    expect(grant?.roleId).toBe("1130461373504159844");
    expect(grant?.itemLabel).toBe("BoyKisser [Cosmetic]");
  });

  it("reads a token purchase, which is the case that lost items", () => {
    const grant = parseShopGrant(
      "you have used Byte Token [Rare] . . . \nand you were given the <@&1385194838890119229> role!"
    );

    expect(grant?.roleId).toBe("1385194838890119229");
    expect(grant?.itemLabel).toBe("Byte Token [Rare]");
  });

  it("returns null when no role was handed out", () => {
    expect(parseShopGrant("you have used a Pet Snack . . . \nPeach looks happy!")).toBeNull();
  });

  it("returns null on an unrelated Mimu embed", () => {
    expect(parseShopGrant("**same.old.shell** petted Mimu ~")).toBeNull();
  });

  it("still finds the role when the item label is missing", () => {
    const grant = parseShopGrant("and you were given the <@&123> role!");

    expect(grant?.roleId).toBe("123");
    expect(grant?.itemLabel).toBeNull();
  });

  it("does not mistake a user mention for a role mention", () => {
    expect(parseShopGrant("you were given the <@1130461373504159844> role!")).toBeNull();
  });

  it("is not thrown off by casing", () => {
    expect(parseShopGrant("You Were Given The <@&999> Role!")?.roleId).toBe("999");
  });
});

describe("looksLikeGrant", () => {
  it("flags a grant that failed to parse so a wording change is visible", () => {
    const description = "you have used Byte Token [Rare] . . . \nand you were given a shiny new role";

    expect(parseShopGrant(description)).toBeNull();
    expect(looksLikeGrant(description)).toBe(true);
  });

  it("stays quiet on messages that were never grants", () => {
    expect(looksLikeGrant("nom nom nom ! **Peach** ate 7 pet food.")).toBe(false);
  });
});

describe("MIMU_BOT_ID", () => {
  it("matches the Mimu application in the guild", () => {
    expect(MIMU_BOT_ID).toBe("493716749342998541");
  });
});
