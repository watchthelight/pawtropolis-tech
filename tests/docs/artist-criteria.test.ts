// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/docs/artist-criteria.test.ts
 * WHAT: Checks that every handbook line /investigate-artist quotes is still in
 *       docs/MOD-HANDBOOK.md, and that the criteria built on those lines are
 *       well formed.
 * WHY: The command must judge by the server's own workflow. When the handbook
 *      is edited and a quote stops matching, this fails, so the criteria are
 *      updated with it and the command never applies a rule staff have dropped.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AI_ARTIFACT_GUIDE,
  AI_POLICY,
  CRITERIA,
  GREEN_FLAGS,
  HANDBOOK_PRECEDENCE,
  RED_FLAGS,
  WORKFLOW_DECISIONS,
  WORKFLOW_SOURCE_LABELS,
  displayRule,
  findOverruledInGreeting,
  findRequirementDrift,
  handbookQuotes,
  normalizeWorkflowText,
  requirementQuotes,
} from "../../src/features/artistInvestigation/criteria.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const handbook = fs.readFileSync(path.join(REPO_ROOT, "docs", "MOD-HANDBOOK.md"), "utf8");
const handbookText = normalizeWorkflowText(handbook);

/** The one applicant-facing line the handbook overrules (owner decision, 2026-11-15). */
const OVERRULED_LINE = "3 different WIP/Layers to previous work";

const rulesOf = (key: string) => CRITERIA.find((criterion) => criterion.key === key)?.rules ?? [];

/** The handbook text under one heading, up to the next heading of the same or a higher level. */
function handbookSection(heading: string): string {
  const lines = handbook.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) throw new Error(`heading not found in the mod handbook: ${heading}`);
  const level = heading.match(/^#+/)?.[0].length ?? 1;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => {
    const hashes = line.match(/^(#+)\s/)?.[1];
    return hashes !== undefined && hashes.length <= level;
  });
  return rest.slice(0, end === -1 ? undefined : end).join("\n");
}

describe("artist criteria: handbook parity", () => {
  it("quotes only lines that are in the mod handbook today", () => {
    const quotes = handbookQuotes();
    const missing = quotes.filter((quote) => !handbookText.includes(normalizeWorkflowText(quote)));

    expect(quotes.length).toBeGreaterThan(20);
    expect(missing).toEqual([]);
  });

  it("takes its verification rules from the Commissions Verification section", () => {
    const section = normalizeWorkflowText(handbookSection("## Commissions Verification"));
    const outside = [...RED_FLAGS, ...GREEN_FLAGS].filter(
      (quote) => !section.includes(normalizeWorkflowText(quote))
    );

    expect(outside).toEqual([]);
  });

  it("takes its base rules from the Art Bases and 2D Artwork Verification sections", () => {
    const artBases = normalizeWorkflowText(handbookSection("#### Art Bases"));
    const verification = normalizeWorkflowText(handbookSection("### 2D Artwork Verification"));
    const fromHandbook = rulesOf("base_use")
      .filter((rule) => rule.source === "handbook")
      .map((rule) => normalizeWorkflowText(rule.text));

    // Posting with credit is an art rule. Whether a base piece counts as evidence
    // is a verification rule, so it sits with the other verification rules.
    expect(fromHandbook).toHaveLength(2);
    expect(fromHandbook.filter((rule) => artBases.includes(rule))).toHaveLength(1);
    expect(fromHandbook.filter((rule) => verification.includes(rule))).toHaveLength(1);
  });

  it("takes the experience and recent commission rules from the 2D section", () => {
    const section = normalizeWorkflowText(handbookSection("### 2D Artwork Verification"));
    const fromHandbook = rulesOf("active_commissions").filter((rule) => rule.source === "handbook");

    expect(fromHandbook.map((rule) => rule.text)).toEqual([
      "A commission within the 6 months before applying. Without one the applicant is ineligible",
      "More than 6 months of experience",
    ]);
    for (const rule of fromHandbook) expect(section).toContain(normalizeWorkflowText(rule.text));
  });

  it("finds the sentence that puts the handbook first next to the evidence list", () => {
    const section = normalizeWorkflowText(handbookSection("### 2D Artwork Verification"));
    const evidence = section.indexOf(
      normalizeWorkflowText("Minimum Acceptable Evidence (at least TWO required):")
    );
    const precedence = section.indexOf(normalizeWorkflowText(HANDBOOK_PRECEDENCE));

    expect(evidence).toBeGreaterThan(-1);
    expect(precedence).toBeGreaterThan(evidence);
  });

  it("carries every row of the handbook's AI policy table", () => {
    const section = handbookSection("## Commissions Verification");
    const start = section.indexOf("**AI-Generated Content Policy:**");
    const table = section
      .slice(start)
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim());
    const firstRow = table.findIndex((line) => line.startsWith("|"));
    const rows = [];
    for (const line of table.slice(firstRow)) {
      if (!line.startsWith("|")) break;
      rows.push(line);
    }
    // Header and divider are not policy rows.
    const policyRows = rows.slice(2);

    expect(start).toBeGreaterThan(-1);
    expect(policyRows).toHaveLength(AI_POLICY.length);
    for (const row of AI_POLICY) {
      expect(handbookText).toContain(
        normalizeWorkflowText(
          `| ${row.level} | ${row.allowed} | ${row.disclosure} | ${row.consequence} |`
        )
      );
    }
  });

  it("carries every row of the handbook's Spotting AI Art table", () => {
    const section = handbookSection("### Spotting AI Art (Visual Guide)");
    const rows = section
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|"));
    // The table has a header row and a divider row above its entries.
    const entries = rows.slice(2);

    expect(entries).toHaveLength(AI_ARTIFACT_GUIDE.length);
    for (const row of AI_ARTIFACT_GUIDE) {
      expect(normalizeWorkflowText(section)).toContain(
        normalizeWorkflowText(`| ${row.category} | ${row.artifacts} |`)
      );
    }
  });
});

describe("artist criteria: shape", () => {
  it("has one entry per key, each with a title, rules and guidance", () => {
    const keys = CRITERIA.map((criterion) => criterion.key);

    expect(new Set(keys).size).toBe(keys.length);
    for (const criterion of CRITERIA) {
      expect(criterion.key).toMatch(/^[a-z_]+$/);
      expect(criterion.title.length).toBeGreaterThan(3);
      expect(criterion.rules.length).toBeGreaterThan(0);
      expect(criterion.guidance.length).toBeGreaterThan(40);
    }
  });

  it("marks which criteria ask for something and which look for a problem", () => {
    // The report and the prompt word a rating by this: "met" on a risk check means nothing was found.
    expect(
      Object.fromEntries(CRITERIA.map((criterion) => [criterion.key, criterion.kind]))
    ).toEqual({
      process_evidence: "requirement",
      client_work: "requirement",
      terms_of_service: "requirement",
      active_commissions: "requirement",
      foundational_skill: "requirement",
      consistency: "risk",
      provenance: "risk",
      ai_indicators: "risk",
      base_use: "risk",
      account_history: "risk",
    });
  });

  it("ties every rule to a source the report can name", () => {
    const sources = new Set(
      CRITERIA.flatMap((criterion) => criterion.rules.map((rule) => rule.source))
    );

    expect([...sources].sort()).toEqual(["art_rules", "handbook", "requirements"]);
    for (const source of sources) expect(WORKFLOW_SOURCE_LABELS[source].length).toBeGreaterThan(5);
  });

  it("covers what the brief asks the command to assess", () => {
    expect(CRITERIA.map((criterion) => criterion.key)).toEqual(
      expect.arrayContaining([
        "process_evidence",
        "consistency",
        "provenance",
        "ai_indicators",
        "base_use",
        "account_history",
      ])
    );
  });

  it("never tells the model to reach a verdict on theft or AI", () => {
    const guidance = CRITERIA.map((criterion) => criterion.guidance).join(" ");

    expect(guidance).toContain("AI generation cannot be detected reliably");
    expect(guidance).not.toMatch(
      /\b(?:conclude|decide|rule) (?:that|whether) (?:the art|it) (?:is|was) (?:stolen|traced|AI)/i
    );
  });

  it("marks the one applicant line the handbook overrules, and no handbook line", () => {
    const overruled = CRITERIA.flatMap((criterion) =>
      criterion.rules
        .filter((rule) => rule.overruled)
        .map((rule) => `${criterion.key} / ${rule.source} / ${rule.text}`)
    );

    expect(overruled).toEqual([`process_evidence / requirements / ${OVERRULED_LINE}`]);
  });

  it("rates process evidence by the handbook's list, which comes first", () => {
    const [first] = rulesOf("process_evidence");
    const guidance =
      CRITERIA.find((criterion) => criterion.key === "process_evidence")?.guidance ?? "";

    expect(first).toEqual({
      text: "Minimum Acceptable Evidence (at least TWO required):",
      source: "handbook",
    });
    expect(guidance).toContain("at least two of its three evidence types");
    expect(guidance).toContain("do not rate by that count");
  });

  it("states the three points the owner settled as rules", () => {
    const decisions = WORKFLOW_DECISIONS.join(" ");

    expect(WORKFLOW_DECISIONS).toHaveLength(3);
    expect(decisions).toContain(`"${OVERRULED_LINE}" is context and does not decide`);
    expect(decisions).toContain("three separate rules, and all three count");
    expect(decisions).toContain("counts as evidence when the base creator is credited");
  });

  it("uses plain punctuation in everything it shows", () => {
    const shown = [
      ...CRITERIA.flatMap((criterion) => [criterion.title, criterion.guidance]),
      ...WORKFLOW_DECISIONS,
      HANDBOOK_PRECEDENCE,
      ...Object.values(WORKFLOW_SOURCE_LABELS),
    ].join("\n");
    const dashes = [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d].map((code) =>
      String.fromCharCode(code)
    );

    for (const mark of dashes) expect(shown).not.toContain(mark);
  });
});

describe("artist criteria: text helpers", () => {
  const curlyApostrophe = String.fromCharCode(0x2019);
  const curlyOpen = String.fromCharCode(0x201c);
  const curlyClose = String.fromCharCode(0x201d);

  it("normalizes case, spacing, emphasis, custom emoji and curly quotes", () => {
    expect(
      normalizeWorkflowText("  **Speed-paints**   also\n\n_help_ your `verification` ~~now~~ ")
    ).toBe("speed-paints also help your verification now");
    expect(
      normalizeWorkflowText("<:paw:123456789012345678> Rule <a:spin:987654321098765432>")
    ).toBe("rule");
    expect(normalizeWorkflowText(`Don${curlyApostrophe}t ${curlyOpen}trace${curlyClose}`)).toBe(
      `don't "trace"`
    );
  });

  it("shows a table row without its column bars and leaves other rules alone", () => {
    expect(
      displayRule("| 100% AI-generated | Prohibited | Not allowed | Decline Verification |")
    ).toBe("100% AI-generated / Prohibited / Not allowed / Decline Verification");
    expect(displayRule("3 different WIP/Layers to previous work")).toBe(
      "3 different WIP/Layers to previous work"
    );
  });

  it("lists the applicant requirement lines the criteria were built from", () => {
    const quotes = requirementQuotes();

    // An overruled line stays on the list: it is still what applicants were shown.
    expect(quotes).toContain(OVERRULED_LINE);
    expect(quotes.length).toBeGreaterThanOrEqual(5);
    expect(new Set(quotes).size).toBe(quotes.length);
  });

  it("finds no drift when there is no greeting or the greeting carries every line", () => {
    const noisy = requirementQuotes()
      .map((quote) => `> <:paw:123456789012345678> **${quote.toUpperCase()}**`)
      .join("\n\n");

    expect(findRequirementDrift("")).toEqual([]);
    expect(findRequirementDrift("   \n ")).toEqual([]);
    expect(findRequirementDrift(noisy)).toEqual([]);
  });

  it("names exactly the lines a greeting no longer carries", () => {
    const quotes = requirementQuotes().filter((quote) => quote !== OVERRULED_LINE);
    const greeting = quotes.filter((_, index) => index !== 0 && index !== 2).join("\n");

    expect(findRequirementDrift(greeting)).toEqual([quotes[0], quotes[2]]);
    expect(findRequirementDrift("Welcome! A staff member will be with you shortly.")).toEqual(
      quotes
    );
  });

  it("does not count an overruled line the greeting dropped as drift", () => {
    const edited = requirementQuotes()
      .filter((quote) => quote !== OVERRULED_LINE)
      .join("\n");

    expect(findRequirementDrift(edited)).toEqual([]);
    expect(findOverruledInGreeting(edited)).toEqual([]);
  });

  it("finds an overruled line only in a greeting that carries it", () => {
    const noisy = `> <:paw:123456789012345678> **${OVERRULED_LINE.toUpperCase()}**`;

    expect(findOverruledInGreeting("")).toEqual([]);
    expect(findOverruledInGreeting("   \n ")).toEqual([]);
    expect(findOverruledInGreeting("Welcome! A staff member will be with you shortly.")).toEqual(
      []
    );
    expect(findOverruledInGreeting(noisy)).toEqual([OVERRULED_LINE]);
    expect(findOverruledInGreeting(requirementQuotes().join("\n"))).toEqual([OVERRULED_LINE]);
  });
});
