/**
 * Pawtropolis Tech -- src/features/gate/constants.ts
 * WHAT: Brand color + gate-entry footer sentinels shared by gate.ts and the
 *       entry-panel module.
 * WHY: Standalone so gate.ts and gate/entryPanel.ts can both import without a
 *      circular dependency (#00011).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

// WHY teal? Because that's what the designer picked in 2022. Don't change it
// unless you want to hear about it in every staff meeting for six months.
export const BRAND_COLOR = 0x22ccaa;
// Footer text doubles as a sentinel for identifying our gate messages when searching.
// Keep both legacy and current values so we can still find old gate entries after updates.
export const GATE_ENTRY_FOOTER = "If you're having issues DM an online moderator.";
export const GATE_ENTRY_FOOTER_MATCHES = new Set([GATE_ENTRY_FOOTER, "GateEntry v1"]);
