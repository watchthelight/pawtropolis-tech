// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/constants/byteTokens.ts
 * WHAT: Byte token role IDs and what each rarity is worth.
 * WHY: Lifted out of commands/usebyte.ts so modules that only need the role IDs do not
 *      drag in byteMultiplierStore, which prepares SQL statements at import time.
 *      commands/usebyte.ts re-exports these, so existing importers are unaffected.
 */

import type { TokenRarity } from "../store/byteMultiplierStore.js";

export interface ByteTokenConfig {
  tokenRoleId: string;
  tokenRoleName: string;
  multiplierRoleId: string;
  multiplierRoleName: string;
  multiplierValue: number; // e.g., 2 for 2x
  durationHours: number;
  rarity: TokenRarity;
}

export const BYTE_TOKEN_CONFIG: Record<TokenRarity, ByteTokenConfig> = {
  common: {
    tokenRoleId: "1385194063841722439",
    tokenRoleName: "Byte Token [Common]",
    multiplierRoleId: "1407484898910011443",
    multiplierRoleName: "[2x] Byte",
    multiplierValue: 2,
    durationHours: 12,
    rarity: "common",
  },
  rare: {
    tokenRoleId: "1385194838890119229",
    tokenRoleName: "Byte Token [Rare]",
    multiplierRoleId: "1408385868414193744",
    multiplierRoleName: "[3x] Byte",
    multiplierValue: 3,
    durationHours: 24,
    rarity: "rare",
  },
  epic: {
    tokenRoleId: "1385195081065173033",
    tokenRoleName: "Byte Token [Epic]",
    multiplierRoleId: "1405369052829974543",
    multiplierRoleName: "[5x] Byte",
    multiplierValue: 5,
    durationHours: 48,
    rarity: "epic",
  },
  legendary: {
    tokenRoleId: "1385054324295733278",
    tokenRoleName: "Byte Token [Legendary]",
    multiplierRoleId: "1405369052829974543", // Same as Epic (5x)
    multiplierRoleName: "[5x] Byte",
    multiplierValue: 5,
    durationHours: 72,
    rarity: "legendary",
  },
  mythic: {
    tokenRoleId: "1385195450856112198",
    tokenRoleName: "Byte Token [Mythic]",
    multiplierRoleId: "1269171052836294787",
    multiplierRoleName: "[x10] Byte",
    multiplierValue: 10,
    durationHours: 168, // 7 days
    rarity: "mythic",
  },
};
