/**
 * Pawtropolis Tech -- tests/features/research/text.test.ts
 * WHAT: Pins the text measures of the chat research.
 * WHY: The effort model was trained on these exact numbers, and the other
 *      measures continue a series that began in April 2026. The port was
 *      checked against everything the first pipeline had stored (945,625
 *      effort scores and 980,146 rule-based scores, all identical to the last
 *      digit). The values below were taken from the port in that state, on
 *      made-up texts, so a later change that moves a score fails here.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  contextText,
  handFeatures,
  heuristicScore,
  isFiller,
  lexicalDensity,
  loadWordList,
  maxCharRun,
  novelty,
  substantiveness,
  tokens,
  weeklyFacts,
} from "../../../src/features/research/text.js";

const lowlist = new Set(["lol", "ok", "yeah", "lmao"]);
const fillerBank = new Set(["lol", "ok thanks", "good morning"]);

function expectClose(actual: number[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value, `value ${i}`).toBeCloseTo(expected[i] ?? NaN, 12));
}

const question = {
  content: "Has anyone tried the new brush pack? I keep getting weird streaks at low opacity!!",
  hasAttachment: false,
  hasEmbed: false,
  isReply: true,
  context: ["I only paint with the round brush", "", "what tablet do you use?"],
};
const noisy = {
  content:
    "LOOOOOOL ok ok ok https://example.com/a?b=1 <@123456789012345678> <:paw:123456789012345678> \u{1F43E} 42",
  hasAttachment: true,
  hasEmbed: true,
  isReply: false,
  context: [],
};
const throwaway = {
  content: "lol",
  hasAttachment: false,
  hasEmbed: false,
  isReply: false,
  context: ["lol"],
};
const accented = {
  content: "Café time, the café is open. Is the café open?",
  hasAttachment: false,
  hasEmbed: false,
  isReply: false,
  context: ["is it open", "the cafe?"],
};

describe("tokens", () => {
  it("lowercases and keeps punctuation on the word", () => {
    expect(tokens(question.content).slice(0, 7)).toEqual([
      "has",
      "anyone",
      "tried",
      "the",
      "new",
      "brush",
      "pack?",
    ]);
  });

  it("drops links, mentions and emoji", () => {
    expect(tokens(noisy.content)).toEqual(["looooool", "ok", "ok", "ok", "42"]);
  });

  it("gives the same answer when asked twice in a row", () => {
    // The patterns are global. A pattern that kept its position would miss the second link.
    const text = "see https://example.com/one and https://example.com/two";
    expect(tokens(text)).toEqual(tokens(text));
    expect(tokens(text)).toEqual(["see", "and"]);
  });
});

describe("maxCharRun", () => {
  it("counts the longest run of one character and ignores runs of spaces", () => {
    expect(maxCharRun(noisy.content)).toBe(6);
    expect(maxCharRun("a      b")).toBe(1);
    expect(maxCharRun("")).toBe(1);
  });
});

describe("handFeatures", () => {
  it("has 24 values", () => {
    expect(handFeatures(question, lowlist)).toHaveLength(24);
  });

  it("pins a question with context", () => {
    expectClose(
      handFeatures(question, lowlist),
      [
        4.418840607796598, 2.772588722239781, 1, 5.466666666666667, 0.9558823529411765, 0, 0,
        0.04411764705882353, 0.03076923076923077, 0.2, 0.1, 0, 0, 1, 0, 0, 1, 0, 0,
        3.906890595608518, 4.162270255969652, 3, 0.125, 4.04305126783455,
      ]
    );
  });

  it("pins a message with a link, a mention, emoji and stretched letters", () => {
    expectClose(
      handFeatures(noisy, lowlist),
      [
        4.584967478670572, 1.791759469228055, 0.6, 19.4, 0.38636363636363635, 0.4431818181818182,
        0.011363636363636364, 0.1590909090909091, 0.23529411764705882, 0.6, 0.3, 1, 1, 1, 1, 1, 0,
        0.6, 0, 1.3709505944546687, 4.896284022195586, 0, 0, 0,
      ]
    );
  });

  it("pins a throwaway word that repeats its context", () => {
    expectClose(
      handFeatures(throwaway, lowlist),
      [
        1.3862943611198906, 0.6931471805599453, 1, 3, 1, 0, 0, 0, 0, 0.1, 0.1, 0, 0, 0, 0, 0, 0, 1,
        1, 0, 0.9182958340544896, 1, 1, 1.3862943611198906,
      ]
    );
  });

  it("pins a message with letters outside ASCII", () => {
    expectClose(
      handFeatures(accented, lowlist),
      [
        3.8501476017100584, 2.3978952727983707, 0.6, 4.6, 0.8378378378378378, 0,
        0.08108108108108109, 0.08108108108108109, 0.06451612903225806, 0.1, 0.1, 0, 0, 1, 0, 0, 0,
        0, 0, 2.446439344671015, 3.93315944527285, 2, 0.2222222222222222, 2.995732273553991,
      ]
    );
  });

  it("answers the link and mention questions the same for every message in a row", () => {
    const withLink = { ...throwaway, content: "look https://example.com/x" };
    const first = handFeatures(withLink, lowlist);
    const second = handFeatures(withLink, lowlist);
    expect(first[11]).toBe(1);
    expect(second[11]).toBe(1);
  });

  it("counts an empty context message as a message", () => {
    expect(handFeatures({ ...throwaway, context: ["", "", ""] }, lowlist)[21]).toBe(3);
  });
});

describe("contextText", () => {
  it("joins the texts and leaves out the empty ones", () => {
    expect(contextText(question.context)).toBe(
      "I only paint with the round brush what tablet do you use?"
    );
  });

  it("is a single space when there is nothing to join", () => {
    expect(contextText([])).toBe(" ");
    expect(contextText(["", ""])).toBe(" ");
  });
});

describe("heuristicScore", () => {
  it("pins the four examples", () => {
    expectClose(
      [question, noisy, throwaway, accented].map((m) =>
        heuristicScore(m.content, m.hasAttachment, m.hasEmbed, lowlist)
      ),
      [0.6195711287808496, 0.3294806766085555, 0.05599572337168304, 0.49749715972425146]
    );
  });

  it("gives a picture without words the middle score", () => {
    expect(heuristicScore("   ", true, false, lowlist)).toBe(0.5);
    expect(heuristicScore("", false, true, lowlist)).toBe(0.5);
  });

  it("gives nothing at all a zero", () => {
    expect(heuristicScore("", false, false, lowlist)).toBe(0);
  });

  it("stays between 0 and 1", () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
    for (const text of [long, "lol", "aaaaaaaaaaaaaaaaaaaaaaaa", "?!?!?!"]) {
      const score = heuristicScore(text, false, false, lowlist);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe("isFiller", () => {
  it("matches a stock phrase whatever its case, spacing and closing punctuation", () => {
    expect(isFiller("lol", fillerBank)).toBe(true);
    expect(isFiller("OK thanks!!!", fillerBank)).toBe(true);
    expect(isFiller("good   morning <@123456789012345678> \u{1F31E}", fillerBank)).toBe(true);
  });

  it("does not match a longer message that contains one", () => {
    expect(isFiller("lol that brush pack is great", fillerBank)).toBe(false);
  });

  it("does not match a message that is empty once the markup is gone", () => {
    expect(isFiller("\u{1F43E}", new Set(["", "lol"]))).toBe(false);
  });
});

describe("lexicalDensity", () => {
  it("is the share of different content words", () => {
    expect(lexicalDensity(question.content)).toBe(1);
    expect(lexicalDensity(noisy.content)).toBeCloseTo(0.6, 12);
    expect(lexicalDensity(accented.content)).toBeCloseTo(0.5, 12);
  });

  it("is 0 when only stopwords are left", () => {
    expect(lexicalDensity("the and of")).toBe(0);
  });
});

describe("novelty", () => {
  const unit = (index: number) => {
    const vector = new Float32Array(384);
    vector[index] = 1;
    return vector;
  };

  it("is 0 for the same direction and 1 for a right angle", () => {
    expect(novelty(unit(3), unit(3))).toBeCloseTo(0, 8);
    expect(novelty(unit(3), unit(4))).toBe(1);
  });

  it("is capped at 1 for opposite directions", () => {
    const opposite = unit(3);
    opposite[3] = -1;
    expect(novelty(unit(3), opposite)).toBe(1);
  });
});

describe("substantiveness", () => {
  it("weighs novelty 0.5, not being filler 0.3 and density 0.2", () => {
    expect(substantiveness(0.4, 1, 0.5)).toBeCloseTo(0.6, 12);
    expect(substantiveness(1, 1, 1)).toBeCloseTo(1, 12);
    expect(substantiveness(0, 0, 0)).toBe(0);
  });
});

describe("weeklyFacts", () => {
  it("reports what the weekly table counts", () => {
    expect(weeklyFacts(question.content, lowlist)).toMatchObject({
      isQuestion: true,
      isRepeatSpam: false,
      isLowlistOnly: false,
    });
    expect(weeklyFacts(noisy.content, lowlist)).toMatchObject({
      isQuestion: true,
      isRepeatSpam: true,
      isLowlistOnly: false,
    });
    expect(weeklyFacts("ok lol", lowlist)).toMatchObject({
      tokens: ["ok", "lol"],
      isQuestion: false,
      isRepeatSpam: false,
      isLowlistOnly: true,
    });
  });

  it("does not call four throwaway words throwaway-only", () => {
    expect(weeklyFacts("ok lol yeah lmao", lowlist).isLowlistOnly).toBe(false);
  });
});

describe("loadWordList", () => {
  it("reads the two lists of the repo", () => {
    expect(loadWordList(path.join("scripts", "lowlist.json"), "tokens").has("lol")).toBe(true);
    expect(loadWordList(path.join("scripts", "filler-bank.json"), "phrases").size).toBe(200);
  });

  it("lowercases the entries and refuses a file without the list", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "research-words-"));
    try {
      const file = path.join(dir, "list.json");
      fs.writeFileSync(file, JSON.stringify({ tokens: ["LOL", "Ok"] }));
      expect([...loadWordList(file, "tokens")]).toEqual(["lol", "ok"]);
      expect(() => loadWordList(file, "phrases")).toThrow('has no "phrases" list');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
