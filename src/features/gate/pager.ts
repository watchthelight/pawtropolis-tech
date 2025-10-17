import type { Database as BetterSqliteDatabase } from "better-sqlite3";
import {
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

export type GateQuestion = {
  q_index: number;
  prompt: string;
  required: boolean;
};

export type QuestionPage = {
  pageIndex: number;
  questions: GateQuestion[];
};

const INPUT_MAX_LENGTH = 1000;
const LABEL_MAX_LENGTH = 45;
const PLACEHOLDER_MAX_LENGTH = 100;

export function getQuestions(db: BetterSqliteDatabase, guildId: string): GateQuestion[] {
  const rows = db
    .prepare(
      `
      SELECT q_index, prompt, required
      FROM guild_question
      WHERE guild_id = ?
      ORDER BY q_index ASC
    `
    )
    .all(guildId) as Array<{ q_index: number; prompt: string; required: number }>;
  return rows.map((row) => ({
    q_index: row.q_index,
    prompt: row.prompt,
    required: row.required === 1,
  }));
}

export function paginate(questions: GateQuestion[], pageSize = 5): QuestionPage[] {
  if (pageSize <= 0) throw new Error("pageSize must be positive");
  const pages: QuestionPage[] = [];
  for (let i = 0; i < questions.length; i += pageSize) {
    const slice = questions.slice(i, i + pageSize);
    pages.push({ pageIndex: pages.length, questions: slice });
  }
  return pages;
}

export function buildModalForPage(
  page: QuestionPage,
  draftAnswersMap: Map<number, string>
): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`v1:modal:p${page.pageIndex}`)
    .setTitle(`Gate Entry - Page ${page.pageIndex + 1}`);

  const rows = page.questions.map((question) => {
    const label =
      question.prompt.length > LABEL_MAX_LENGTH
        ? `${question.prompt.slice(0, LABEL_MAX_LENGTH - 3)}...`
        : question.prompt || `Question ${question.q_index + 1}`;
    const placeholder =
      question.prompt.length > PLACEHOLDER_MAX_LENGTH
        ? question.prompt.slice(0, PLACEHOLDER_MAX_LENGTH)
        : question.prompt;
    const input = new TextInputBuilder()
      .setCustomId(`v1:q:${question.q_index}`)
      .setLabel(label)
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(INPUT_MAX_LENGTH)
      .setRequired(question.required);
    if (placeholder) {
      input.setPlaceholder(placeholder);
    }
    const existing = draftAnswersMap.get(question.q_index);
    if (existing) {
      input.setValue(existing.slice(0, INPUT_MAX_LENGTH));
    }
    return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
  });
  if (rows.length === 0) {
    throw new Error("Cannot build modal without inputs");
  }
  modal.addComponents(...rows);
  return modal;
}
