/**
 * Pawtropolis Tech -- src/features/tickets/panels.ts
 * WHAT: Builds the two persistent panel embeds (Tickets stack + Verification stack)
 *       posted in the ticket panel channel. Each embed lists its types and exposes
 *       a button per type that opens a new ticket of that type.
 * WHY: Centralizes embed/button assembly so /postticketpanel can call buildPanel()
 *      and the open-ticket handler can derive the type from the customId without
 *      knowing the layout.
 *
 * BUTTON LIMIT: Discord allows up to 5 buttons per ActionRow and up to 5 ActionRows
 * per message. With 6 types in the Tickets stack and 4 in Verification we comfortably
 * fit (2 rows + 1 row).
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type APIMessageComponentEmoji,
} from "discord.js";
import { PANEL_FOOTER_MARKER } from "./config.js";
import { listActiveTypesByStack } from "./registry.js";
import type { ButtonEmoji, PanelStack, TicketTypeConfig } from "./types.js";

const TICKETS_PANEL_GREEN = 0x388e3c;
const VERIFICATION_PANEL_PINK = 0xff7eec;

const TICKETS_PANEL_HEADER = "Please click the one that suits your needs best!";
const VERIFICATION_PANEL_HEADER =
  "This section allows certain users to authenticate their work. Currently we offer 4 different types of verified programs.";

function emojiToComponent(e: ButtonEmoji | null): APIMessageComponentEmoji | undefined {
  if (!e) return undefined;
  if (e.id) return { name: e.name, id: e.id, animated: e.animated };
  return { name: e.name };
}

function buildButton(type: TicketTypeConfig): ButtonBuilder {
  const btn = new ButtonBuilder()
    .setCustomId(`tk:open:${type.key}`)
    .setLabel(type.label)
    .setStyle(type.buttonStyle as ButtonStyle);
  const emoji = emojiToComponent(type.buttonEmoji);
  if (emoji) btn.setEmoji(emoji);
  return btn;
}

/** Group buttons into action rows, max 5 per row. */
function chunkButtonsToRows(buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    const slice = buttons.slice(i, i + 5);
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(slice));
  }
  return rows;
}

function buildEmbedBody(types: TicketTypeConfig[]): string {
  return types
    .map((t) => {
      const e = t.buttonEmoji;
      let prefix = "";
      if (e?.id) {
        prefix = `<${e.animated ? "a" : ""}:${e.name}:${e.id}> `;
      } else if (e?.name) {
        prefix = `${e.name} `;
      }
      return `${prefix}${t.label}`;
    })
    .join("\n");
}

export interface PanelMessagePayload {
  stack: PanelStack;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
}

/** Build both panels (in canonical order: tickets first, then verification). */
export function buildAllPanels(): PanelMessagePayload[] {
  return [buildPanel("tickets"), buildPanel("verification")];
}

/**
 * Build the embed + action rows for one panel stack.
 * Returns null if no active types exist for that stack.
 */
export function buildPanel(stack: PanelStack): PanelMessagePayload {
  const types = listActiveTypesByStack(stack);
  const isTickets = stack === "tickets";

  const embed = new EmbedBuilder()
    .setColor(isTickets ? TICKETS_PANEL_GREEN : VERIFICATION_PANEL_PINK)
    .setDescription(
      `${isTickets ? TICKETS_PANEL_HEADER : VERIFICATION_PANEL_HEADER}\n\n${buildEmbedBody(types)}`
    )
    .setFooter({
      text: `${PANEL_FOOTER_MARKER} • ${stack}`,
    });

  const buttons = types.map(buildButton);
  const rows = chunkButtonsToRows(buttons);

  return { stack, embeds: [embed], components: rows };
}

/**
 * Detect whether a Discord message is one of OUR panel messages by checking
 * footer text marker. Used by /postticketpanel to find existing panels and
 * edit them in place rather than spamming duplicates.
 */
export function isPanelMessage(footerText: string | null | undefined): PanelStack | null {
  if (!footerText) return null;
  if (!footerText.startsWith(PANEL_FOOTER_MARKER)) return null;
  if (footerText.endsWith("• tickets")) return "tickets";
  if (footerText.endsWith("• verification")) return "verification";
  return null;
}
