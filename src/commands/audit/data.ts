/**
 * Pawtropolis Tech -- src/commands/audit/data.ts
 * WHAT: SlashCommandBuilder definition for /audit.
 * WHY: Isolated so each subcommand module can be tested without booting
 *      the entire command.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("audit")
  .setDescription("Server audit commands")
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub.setName("members").setDescription("Scan for bot-like accounts")
  )
  .addSubcommand((sub) =>
    sub
      .setName("nsfw")
      .setDescription("Scan member avatars for NSFW content")
      .addStringOption((opt) =>
        opt
          .setName("scope")
          .setDescription("Which members to scan")
          .setRequired(true)
          .addChoices(
            { name: "All members", value: "all" },
            { name: "Flagged members only", value: "flagged" }
          )
      )
  )
  .addSubcommand((sub) =>
    sub.setName("security").setDescription("Generate server permission/security documentation")
  )
  .addSubcommand((sub) =>
    sub
      .setName("acknowledge")
      .setDescription("Acknowledge a security warning as intentional")
      .addStringOption((opt) =>
        opt
          .setName("issue")
          .setDescription("Issue ID from the audit (e.g., CRIT-001 or LOW-008)")
          .setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName("reason")
          .setDescription("Why this is intentional/acceptable")
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("unacknowledge")
      .setDescription("Remove acknowledgment from a security warning")
      .addStringOption((opt) =>
        opt
          .setName("issue")
          .setDescription("Issue ID to unacknowledge (e.g., CRIT-001 or LOW-008)")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("trends")
      .setDescription("Show security issue trends over time")
      .addIntegerOption((opt) =>
        opt
          .setName("days")
          .setDescription("Number of days to show (default: 7)")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(30)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("diff")
      .setDescription("Show permission changes since last audit")
  )
  .addSubcommand((sub) =>
    sub
      .setName("acknowledge-all")
      .setDescription("Acknowledge all security warnings of a given severity")
      .addStringOption((opt) =>
        opt
          .setName("severity")
          .setDescription("Which severity level to acknowledge")
          .setRequired(true)
          .addChoices(
            { name: "High only", value: "high" },
            { name: "Medium only", value: "medium" },
            { name: "Low only", value: "low" },
            { name: "All severities", value: "all" }
          )
      )
      .addStringOption((opt) =>
        opt
          .setName("reason")
          .setDescription("Why these are intentional/acceptable")
          .setRequired(false)
      )
  );
