/**
 * Pawtropolis Tech -- src/commands/service-keys.ts
 * WHAT: /service-keys, the owner's way to set, test and remove the API keys of
 *       the outside services (Google Vision, SauceNAO, e621) from Discord.
 * WHY: These keys used to go into the host's .env by hand over SSH. The owner
 *      asked for a way to do it from Discord (#00289).
 * FLOWS:
 *  - status: which service has a key and what it is for. Never a value
 *  - set: owner check -> form -> test call -> stored only when the service accepted it
 *  - clear: removes the key from the .env file and from the running bot
 *  - test: tries the stored keys against their services
 * PRIVACY:
 *  - The owner check runs in both handlers. Every reply is ephemeral.
 *  - A key is never logged, echoed or put in an error message. Text that comes
 *    back from a service is scrubbed of the submitted values before it is shown.
 *  - Errors are caught here and answered privately, so the shared error card
 *    (public when a reply was never deferred) is never used.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type SlashCommandStringOption,
} from "discord.js";
import { visionPausedUntil } from "../features/googleVision.js";
import {
  KEY_SERVICES,
  findKeyService,
  storedValues,
  type KeyService,
} from "../features/serviceKeys.js";
import { withStep, type CommandContext, type InstrumentedInteraction } from "../lib/cmdWrap.js";
import { applyEnvChanges, hostEnvPath, isStorableEnvValue } from "../lib/envFile.js";
import { logger } from "../lib/logger.js";
import { SERVICE_KEYS_MODAL_PREFIX } from "../lib/modalPatterns.js";
import { isOwner } from "../lib/owner.js";

const OWNER_ONLY = "❌ This command is only available to the bot owner.";
const NO_MENTIONS = { parse: [] as [] };
/** Google keys are 39 characters, SauceNAO keys 40, e621 keys 24. */
const MAX_KEY_LENGTH = 200;

const serviceOption =
  (required: boolean, description: string) => (option: SlashCommandStringOption) =>
    option
      .setName("service")
      .setDescription(description)
      .setRequired(required)
      .addChoices(...KEY_SERVICES.map((service) => ({ name: service.name, value: service.id })));

export const data = new SlashCommandBuilder()
  .setName("service-keys")
  .setDescription("Set, test or remove the API keys of outside services (owner only)")
  .setDMPermission(false)
  // Keeps the command out of members' pickers. The real gate is the owner check in the handlers.
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub.setName("status").setDescription("Which services have a key. Never shows a key")
  )
  .addSubcommand((sub) =>
    sub
      .setName("set")
      .setDescription("Enter a key in a private form. It is stored only if the service accepts it")
      .addStringOption(serviceOption(true, "The service the key is for"))
  )
  .addSubcommand((sub) =>
    sub
      .setName("clear")
      .setDescription("Remove a stored key")
      .addStringOption(serviceOption(true, "The service to remove the key of"))
  )
  .addSubcommand((sub) =>
    sub
      .setName("test")
      .setDescription("Try the stored keys against their services")
      .addStringOption(
        serviceOption(false, "One service. Leave empty to test every service that has a key")
      )
  );

/**
 * Take every secret out of a text before it is shown or logged. Short values
 * are left in: an account name is no secret, and cutting two letters out of
 * every word would make the text unreadable.
 */
function scrub(text: string, secrets: readonly string[]): string {
  let clean = text;
  for (const secret of secrets) {
    if (secret.length >= 8) clean = clean.split(secret).join("[key]");
  }
  return clean;
}

const everyStoredValue = () =>
  KEY_SERVICES.flatMap((service) => Object.values(storedValues(service)));

function missingFields(service: KeyService): string[] {
  const stored = storedValues(service);
  return service.fields.filter((field) => !(field.env in stored)).map((field) => field.label);
}

function statusLine(service: KeyService): string {
  const missing = missingFields(service);
  if (missing.length === service.fields.length)
    return `**${service.name}:** no key. ${service.without}`;
  if (missing.length > 0)
    return `**${service.name}:** incomplete, missing: ${missing.join(", ")}. ${service.without}`;

  const line = `**${service.name}:** key stored. Used for ${service.usedFor}.`;
  const pausedUntil = service.id === "vision" ? visionPausedUntil() : 0;
  return pausedUntil > 0
    ? `${line}\nScans are paused until <t:${Math.floor(pausedUntil / 1000)}:t> because Google refused a request. \`/service-keys test\` shows what Google answers now.`
    : line;
}

function statusText(): string {
  return [
    "**Service keys**",
    ...KEY_SERVICES.map(statusLine),
    "",
    "The keys are in the bot's `.env` file on the host, and this command never shows one. The keys for `/isitreal` are set with `/config isitreal`.",
  ].join("\n");
}

function buildModal(service: KeyService): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${SERVICE_KEYS_MODAL_PREFIX}${service.id}`)
    .setTitle(`${service.name}: enter the key`)
    .addComponents(
      ...service.fields.map((field) =>
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId(field.env)
            .setLabel(field.label)
            .setStyle(TextInputStyle.Short)
            .setMaxLength(MAX_KEY_LENGTH)
            .setRequired(true)
        )
      )
    );
}

async function clearKey(
  interaction: ChatInputCommandInteraction,
  service: KeyService
): Promise<void> {
  if (missingFields(service).length === service.fields.length) {
    await interaction.editReply({ content: `${service.name} has no key stored.` });
    return;
  }
  applyEnvChanges(
    hostEnvPath(),
    Object.fromEntries(service.fields.map((field) => [field.env, null]))
  );
  logger.info(
    { evt: "service_key_cleared", service: service.id, userId: interaction.user.id },
    "[service-keys] key removed"
  );
  await interaction.editReply({
    content: `**${service.name}: key removed.** It is gone from the \`.env\` file and from the running bot. ${service.without}`,
    allowedMentions: NO_MENTIONS,
  });
}

async function testKeys(
  ctx: CommandContext<ChatInputCommandInteraction>,
  only: KeyService | null
): Promise<void> {
  const { interaction } = ctx;
  const lines: string[] = [];
  const outcome: Record<string, "accepted" | "failed" | "no_key"> = {};

  for (const service of only ? [only] : KEY_SERVICES) {
    const values = storedValues(service);
    if (Object.keys(values).length < service.fields.length) {
      outcome[service.id] = "no_key";
      lines.push(`**${service.name}:** no key stored, nothing to test.`);
      continue;
    }
    const result = await withStep(ctx, `test_${service.id}`, () => service.test(values));
    outcome[service.id] = result.ok ? "accepted" : "failed";
    lines.push(
      result.ok
        ? `**${service.name}:** accepted.${service.testCost ? ` The test used ${service.testCost}.` : ""}`
        : `**${service.name}:** failed. ${scrub(result.reason, Object.values(values))}`
    );
  }

  logger.info(
    { evt: "service_key_test", outcome, userId: interaction.user.id },
    "[service-keys] stored keys tested"
  );
  await interaction.editReply({
    content: ["**Key test**", ...lines].join("\n"),
    allowedMentions: NO_MENTIONS,
  });
}

/** Log what is safe to log and tell the owner privately. Never rethrows. */
async function fail(
  ctx: CommandContext<InstrumentedInteraction>,
  err: unknown,
  secrets: readonly string[]
): Promise<void> {
  const { interaction } = ctx;
  const message = err instanceof Error ? err.message : String(err);
  logger.error(
    {
      evt: "service_keys_failed",
      traceId: ctx.traceId,
      phase: ctx.currentPhase(),
      errName: err instanceof Error ? err.name : typeof err,
      errMessage: scrub(message, [...secrets, ...everyStoredValue()]).slice(0, 300),
      code: (err as { code?: unknown })?.code,
    },
    "[service-keys] stopped on an error"
  );
  const notice = {
    content: `Something went wrong. \`/service-keys status\` shows what is stored now. Trace: \`${ctx.traceId}\``,
    flags: MessageFlags.Ephemeral as const,
  };
  await (
    interaction.deferred || interaction.replied
      ? interaction.followUp(notice)
      : interaction.reply(notice)
  ).catch(() => undefined);
}

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>): Promise<void> {
  const { interaction } = ctx;
  try {
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({ content: OWNER_ONLY, flags: MessageFlags.Ephemeral });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const serviceId = interaction.options.getString("service");
    const service = serviceId ? findKeyService(serviceId) : null;

    if (sub === "set") {
      // A form has to be the first answer to an interaction, so no defer here.
      if (service) await interaction.showModal(buildModal(service));
      else await interaction.reply({ content: "Unknown service.", flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (sub === "status") {
      await interaction.editReply({ content: statusText(), allowedMentions: NO_MENTIONS });
    } else if (sub === "clear" && service) {
      ctx.step("clear");
      await clearKey(interaction, service);
    } else if (sub === "test" && (service || !serviceId)) {
      await testKeys(ctx, service);
    } else {
      await interaction.editReply({ content: "Unknown service." });
    }
  } catch (err) {
    await fail(ctx, err, []);
  }
}

/** The form opened by `/service-keys set`. Routed here by its custom id prefix. */
export async function handleServiceKeysModal(
  ctx: CommandContext<ModalSubmitInteraction>
): Promise<void> {
  const { interaction } = ctx;
  const submitted: string[] = [];
  try {
    // Checked again: a form can be submitted long after it was opened.
    if (!isOwner(interaction.user.id)) {
      await interaction.reply({ content: OWNER_ONLY, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const service = findKeyService(interaction.customId.slice(SERVICE_KEYS_MODAL_PREFIX.length));
    if (!service) {
      await interaction.editReply({ content: "Unknown service. Nothing was changed." });
      return;
    }

    const values: Record<string, string> = {};
    for (const field of service.fields) {
      const value = interaction.fields.getTextInputValue(field.env).trim();
      submitted.push(value);
      values[field.env] = value;
    }
    const unstorable = service.fields.find((field) => !isStorableEnvValue(values[field.env] ?? ""));
    if (unstorable) {
      await interaction.editReply({
        content: `**Not saved.** "${unstorable.label}" is empty or has a character that cannot be stored. Letters, digits and \`. _ ~ + / = : @ -\` can be, and \`'\` after the first character. Check that the whole value was pasted and nothing else. Nothing was changed.`,
      });
      return;
    }

    const result = await withStep(ctx, "test", () => service.test(values));
    if (!result.ok) {
      logger.info(
        { evt: "service_key_refused", service: service.id, userId: interaction.user.id },
        "[service-keys] key not stored: the test call failed"
      );
      await interaction.editReply({
        content: `**${service.name}: not saved.** The test call failed: ${scrub(result.reason, submitted)}\nNothing was changed. A key that was stored before is still in use.`,
        allowedMentions: NO_MENTIONS,
      });
      return;
    }

    ctx.step("store");
    applyEnvChanges(hostEnvPath(), values);
    logger.info(
      {
        evt: "service_key_set",
        service: service.id,
        names: service.fields.map((field) => field.env),
        userId: interaction.user.id,
      },
      "[service-keys] key stored"
    );
    await interaction.editReply({
      content: `**${service.name}: key saved.** ${service.name} accepted it in a test call. It is in use from now on and stays after a restart.${service.testCost ? ` The test used ${service.testCost}.` : ""}`,
      allowedMentions: NO_MENTIONS,
    });
  } catch (err) {
    await fail(ctx, err, submitted);
  }
}
