/**
 * Pawtropolis Tech -- src/features/gate/ui.ts
 * WHAT: Pure UI builders + parsers for the gate modal flow (page parsing,
 *       answer-map, nav/fix/done button rows).
 * WHY: Extracted from gate.ts (#00011) — dependency-free leaf helpers.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export function parsePage(customId: string): number {
  const match = customId.match(/^v1:start(?::p(\d+))?/);
  if (match && match[1]) return Number.parseInt(match[1], 10);
  return 0;
}

export function toAnswerMap(responses: Array<{ q_index: number; answer: string }>) {
  return new Map(responses.map((row) => [row.q_index, row.answer] as const));
}

/**
 * Build navigation buttons for multi-page forms. Shows Back/Next as appropriate.
 * The "Retry" button appears only on single-page forms or the last page when
 * something goes wrong - gives users a way to try again without starting over.
 *
 * Button customIds encode the target page (v1:start:p0, v1:start:p1, etc.)
 * so the button handler knows which modal to show next.
 */
export function buildNavRow(pageIndex: number, pageCount: number) {
  const buttons: ButtonBuilder[] = [];
  if (pageCount > 1 && pageIndex > 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`v1:start:p${pageIndex - 1}`)
        .setLabel("Back")
        .setStyle(ButtonStyle.Secondary)
    );
  }
  if (pageIndex < pageCount - 1) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`v1:start:p${pageIndex + 1}`)
        .setLabel("Next")
        .setStyle(ButtonStyle.Primary)
    );
  }
  if (buttons.length === 0) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`v1:start:p${pageIndex}`)
        .setLabel("Retry")
        .setStyle(ButtonStyle.Primary)
    );
  }
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons)];
}

export function buildFixRow(pageIndex: number) {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`v1:start:p${pageIndex}`)
        .setLabel(`Go to page ${pageIndex + 1}`)
        .setStyle(ButtonStyle.Primary)
    ),
  ];
}

export function buildDoneRow() {
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("v1:done").setLabel("Done").setStyle(ButtonStyle.Secondary)
    ),
  ];
}

