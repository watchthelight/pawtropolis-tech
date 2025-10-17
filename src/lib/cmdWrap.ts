// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { nanoid } from "nanoid";
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from "discord.js";
import { logger } from "./logger.js";
import { addBreadcrumb, captureException, setContext, setTag } from "./sentry.js";
import { postErrorCard } from "./errorCard.js";

type Phase = string;

export type InstrumentedInteraction = ChatInputCommandInteraction | ModalSubmitInteraction;

export type CommandContext<I extends InstrumentedInteraction = ChatInputCommandInteraction> = {
  interaction: I;
  step: (phase: Phase) => void;
  currentPhase: () => Phase;
  readonly traceId: string;
};

type CommandExecutor<I extends InstrumentedInteraction> = (
  ctx: CommandContext<I>
) => Promise<void>;

export function wrapCommand<I extends InstrumentedInteraction>(
  name: string,
  fn: CommandExecutor<I>
) {
  return async (interaction: I) => {
    const traceId = nanoid(10);
    const startedAt = Date.now();
    let phase: Phase = "enter";

    const ctx: CommandContext<I> = {
      interaction,
      step: (newPhase: Phase) => {
        phase = newPhase;
        logger.info({ evt: "cmd_step", traceId, cmd: name, phase });
        addBreadcrumb({
          category: "cmd",
          message: name,
          data: { phase, traceId },
          level: "info",
        });
        setTag("phase", phase);
      },
      currentPhase: () => phase,
      traceId,
    };

    logger.info({
      evt: "cmd_start",
      traceId,
      cmd: name,
      user: interaction.user.id,
      guild: interaction.guildId ?? "dm",
    });

    setTag("cmd", name);
    setTag("traceId", traceId);
    setTag("phase", phase);
    setContext("discord", {
      userId: interaction.user.id,
      guildId: interaction.guildId ?? "dm",
    });

    try {
      await fn(ctx);
      const duration = Date.now() - startedAt;
      logger.info({ evt: "cmd_ok", traceId, cmd: name, ms: duration });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const errCode = (error as { code?: unknown })?.code;
      logger.error({
        evt: "cmd_error",
        traceId,
        cmd: name,
        phase,
        err: {
          name: err.name,
          code: errCode,
          message: err.message,
        },
      });
      setTag("phase", phase);
      setTag("cmd", name);
      setTag("traceId", traceId);
      captureException(err, { cmd: name, phase, traceId });

      try {
        await postErrorCard(interaction, {
          traceId,
          cmd: name,
          phase,
          err: {
            name: err.name,
            code: errCode,
            message: err.message,
          },
        });
      } catch (cardErr) {
        logger.error({ err: cardErr }, "Failed to post error card");
      }
    }
  };
}

export async function withStep<T>(
  ctx: CommandContext,
  phase: Phase,
  fn: () => Promise<T> | T
): Promise<T> {
  ctx.step(phase);
  return await fn();
}

export function currentTraceId(ctx: CommandContext): string {
  return ctx.traceId;
}
