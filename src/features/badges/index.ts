// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/badges/index.ts
 * Public surface for the badge subsystem.
 */

export * from "./types.js";
export {
  BADGE_REGISTRY,
  getBadgeDefinition,
  listBadgeDefinitions,
  assertNoDuplicateIds,
} from "./registry.js";
export { svgEscape, isSafeBadgeId } from "./svgEscape.js";
export {
  intToHex,
  normalizeHex,
  readableTextOn,
  relativeLuminance,
  tintForPill,
  accentForRole,
} from "./color.js";
export { renderBadgeSvg, renderUnknownBadgeSvg } from "./renderSvg.js";
export {
  defaultStoreConfig,
  readManifest,
  writeManifest,
  readBadgeSvg,
  writeBadgeSvg,
  upsertManifestEntry,
  manifestEntryUrl,
  svgPathFor,
} from "./store.js";
export type { BadgeStoreConfig } from "./store.js";
export { resolveBadge } from "./resolve.js";
export type { ResolveContext } from "./resolve.js";
