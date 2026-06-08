// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech — src/events/artChannelRoles.ts
 * WHAT: Channel ID to ping-role ID mapping for the auto-ping art channels
 * WHY: Extracted from artChannelPing so the mapping is unit-testable without a live Message
 */

// Channel ID → Role ID mapping
export const ART_CHANNEL_ROLES: ReadonlyMap<string, string> = new Map([
  ["1400346864947302461", "1128920851601969242"], // art-commissions → Art Comms
  ["1400348382798807060", "1128920968581091428"], // adopts → Art Adopts
  ["1400348338972528763", "1128921121593507860"], // verified-artwork → Verified Art
  ["1400348438385660017", "1512801521535025152"], // verified-ych → Verified YCH
]);

export function roleForArtChannel(channelId: string): string | undefined {
  return ART_CHANNEL_ROLES.get(channelId);
}
