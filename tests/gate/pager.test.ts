// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect } from "vitest";
import { paginate, buildModalForPage, type QuestionPage } from "../../src/features/gate/pager.js";

describe("gate pager", () => {
  it("paginates questions into stable pages", () => {
    const questions = Array.from({ length: 12 }, (_, i) => ({
      q_index: i,
      prompt: `Prompt ${i}`,
      required: i % 2 === 0,
    }));

    const pages = paginate(questions, 5);
    expect(pages).toHaveLength(3);
    expect(pages[0].pageIndex).toBe(0);
    expect(pages[1].questions).toHaveLength(5);
    expect(pages[2].questions[0].q_index).toBe(10);
  });

  it("builds a modal with up to five inputs and prefilled answers", () => {
    const page: QuestionPage = {
      pageIndex: 0,
      questions: [
        { q_index: 0, prompt: "First required question", required: true },
        {
          q_index: 1,
          prompt: "Optional answer that should be truncated if it is too long",
          required: false,
        },
      ],
    };
    const longAnswer = "a".repeat(1500);
    const answers = new Map<number, string>([
      [0, "existing"],
      [1, longAnswer],
    ]);

    const modal = buildModalForPage(page, answers);
    const json = modal.toJSON() as {
      custom_id: string;
      components?: Array<{
        components: Array<{
          custom_id?: string;
          required?: boolean;
          value?: string;
        }>;
      }>;
    };

    expect(json.custom_id).toBe("v1:modal:p0");
    expect(json.components).toHaveLength(2);
    const firstInput = json.components![0].components[0];
    expect(firstInput.custom_id).toBe("v1:q:0");
    expect(firstInput.required).toBe(true);
    expect(firstInput.value).toBe("existing");
    const secondInput = json.components![1].components[0];
    expect(secondInput.value?.length).toBe(1000);
  });
});
