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
  
} from "./registry.js";
export {  isSafeBadgeId } from "./svgEscape.js";
;
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
;
