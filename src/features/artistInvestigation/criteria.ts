/**
 * Pawtropolis Tech -- src/features/artistInvestigation/criteria.ts
 * WHAT: The 2D artist verification workflow, as data: each criterion with the
 *       exact wording it comes from and where that wording lives.
 * WHY: /investigate-artist must score against the server's own rules and never
 *      invent any. Handbook quotes are locked to docs/MOD-HANDBOOK.md by
 *      tests/docs/artist-criteria.test.ts. The applicant requirements live only
 *      in Discord (read 2026-11-14), so each run compares them with the greeting
 *      in the ticket and reports any drift.
 *      Where the two disagreed, the owner decided on 2026-11-15 that the
 *      handbook wins. The handbook says so itself, and an applicant-facing line
 *      it overrules is marked here and no longer decides a criterion.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

export type WorkflowSource = "requirements" | "handbook" | "art_rules";

export const WORKFLOW_SOURCE_LABELS: Record<WorkflowSource, string> = {
  requirements: "Applicant requirements (verify-artist embed, ticket panel, ticket greeting)",
  handbook: "Mod handbook, Commissions Verification",
  art_rules: "Art rules (art-rules channel; mod handbook, Art Bases)",
};

interface WorkflowRule {
  /** Exact wording from the source, markdown emphasis removed. */
  text: string;
  source: WorkflowSource;
  /**
   * An applicant-facing line the handbook overrules. It stays listed, so the
   * reviewer sees what applicants have been told, but it does not decide the
   * criterion. A greeting that drops it is the edit the owner asked staff to
   * make, so that is not reported as drift.
   */
  overruled?: true;
}

export type CriterionKey =
  | "process_evidence"
  | "client_work"
  | "terms_of_service"
  | "active_commissions"
  | "foundational_skill"
  | "consistency"
  | "provenance"
  | "ai_indicators"
  | "base_use"
  | "account_history";

export interface Criterion {
  key: CriterionKey;
  title: string;
  /**
   * A requirement asks the applicant for something. A risk check looks for a
   * problem, so "met" there means nothing concerning was found.
   */
  kind: "requirement" | "risk";
  rules: WorkflowRule[];
  /** How to read the rules against a ticket. Guidance for the reviewer, not policy. */
  guidance: string;
}

export const CRITERIA: readonly Criterion[] = [
  {
    key: "process_evidence",
    title: "Process evidence",
    kind: "requirement",
    rules: [
      { text: "Minimum Acceptable Evidence (at least TWO required):", source: "handbook" },
      { text: "Recorded timelapse: Minimum 30 seconds, no unexplained cuts", source: "handbook" },
      {
        text: "Layered source file: .psd, .clip, .sai2, etc. showing dated layers and logical workflow",
        source: "handbook",
      },
      {
        text: "Work-in-progress photo: Handwritten current date + client identifier beside the artwork",
        source: "handbook",
      },
      { text: "Speed-paints also help your verification", source: "requirements" },
      { text: "3 different WIP/Layers to previous work", source: "requirements", overruled: true },
    ],
    guidance:
      "The handbook decides how much is enough: at least two of its three evidence types (recorded timelapse, layered source file, dated work-in-progress photo). Say which of the three are present and rate by that. The text shown to applicants has asked for three sets of WIPs or layers, so also say how many distinct pieces come with sketches, layer views, WIP stages, timelapses or source files, but do not rate by that count. A piece made on a credited base counts like any other (see base_use). Videos and source files are listed by name only: their contents were not inspected, so say that instead of assuming what they show.",
  },
  {
    key: "client_work",
    title: "Finished client work",
    kind: "requirement",
    rules: [
      { text: "Previous finished work with a client", source: "requirements" },
      { text: "Specific, verifiable client feedback", source: "handbook" },
    ],
    guidance:
      "Look for finished pieces the applicant says were commissions, and for anything that ties a piece to a client: a named client, a commission sheet, a public post, feedback.",
  },
  {
    key: "terms_of_service",
    title: "Terms of service",
    kind: "requirement",
    rules: [
      { text: "Need a form of ToS", source: "requirements" },
      { text: "Commissions >$200 require written or clearly documented terms", source: "handbook" },
    ],
    guidance:
      "A ToS can be an image, pasted text or a link. A link is recorded but its page was not fetched, so a linked ToS is unconfirmed until someone opens it.",
  },
  {
    key: "active_commissions",
    title: "Active commissions and experience",
    kind: "requirement",
    rules: [
      { text: "Have to be an artist that actively does commissions", source: "requirements" },
      {
        text: "If you haven't had a commission in the last 6 months prior to verifying, you will be ineligible",
        source: "requirements",
      },
      {
        text: "A commission within the 6 months before applying. Without one the applicant is ineligible",
        source: "handbook",
      },
      { text: "More than 6 months of experience", source: "handbook" },
    ],
    guidance:
      "Two separate rules, and both count. First, a commission within the six months before the ticket was opened: look for dated evidence of one. Second, more than six months of experience: look for dated older work, gallery or account history, or what the applicant says about how long they have been taking commissions. Say what the evidence shows for each rule. Dates the applicant states without anything to support them count as claims. Account age is a third rule and belongs to account_history.",
  },
  {
    key: "foundational_skill",
    title: "Foundational skill",
    kind: "requirement",
    rules: [
      {
        text: "Rendering Skills is not a requirement however we do require that you understand a level of shading to prove foundational artistic competence",
        source: "requirements",
      },
    ],
    guidance:
      "Judge only whether the work shows an understanding of shading and basic form. Polish, style and rendering quality are not part of this rule.",
  },
  {
    key: "consistency",
    title: "Style and skill consistency",
    kind: "risk",
    rules: [
      { text: "Sudden style/quality jumps between pieces", source: "handbook" },
      { text: "Style not consistent across portfolio", source: "handbook" },
      { text: "Multi-year consistent public portfolio", source: "handbook" },
    ],
    guidance:
      "Compare line quality, anatomy habits, coloring and signatures across the submitted images. Artists do work in several styles, so describe what differs and how much instead of treating any difference as a jump.",
  },
  {
    key: "provenance",
    title: "Provenance",
    kind: "risk",
    rules: [
      { text: "Reasonable proof of authorship must be provided upon request", source: "handbook" },
      { text: "Reverse-image search (TinEye, SauceNAO)", source: "handbook" },
      { text: "No tracing, AI passing as original, or art theft", source: "art_rules" },
    ],
    guidance:
      "Use the reverse image search results as given. A match under one of the applicant's own handles supports them. A match under another name, or one posted before their Discord account existed, needs an explanation. No match is not proof of originality and a match is not proof of theft.",
  },
  {
    key: "ai_indicators",
    title: "AI indicators",
    kind: "risk",
    rules: [
      { text: "AI detection triggers", source: "handbook" },
      { text: "Visual artifact checks (symmetrical errors, melting details)", source: "handbook" },
      {
        text: "| 100% AI-generated | Prohibited | Not allowed | Decline Verification |",
        source: "handbook",
      },
      {
        text: "| AI used only as reference | No | Declare upfront + provide full proof trio | Treated as undisclosed AI |",
        source: "handbook",
      },
    ],
    guidance:
      "Check each image against the handbook's Spotting AI Art table: anatomy, hands and paws, fur and texture, backgrounds, stylistic tells, incoherent accessories. Name the image and the artifact. AI generation cannot be detected reliably from pixels, so report indicators and how strong they are, never a finding.",
  },
  {
    key: "base_use",
    title: "Base use",
    kind: "risk",
    rules: [
      {
        text: "Work made on a base counts as evidence when the base creator is credited",
        source: "handbook",
      },
      {
        text: "Users may post artwork with P2U (Pay to Use) and F2U (Free to Use) bases as long as proper credit is given.",
        source: "handbook",
      },
      {
        text: "Users are allowed to post artwork with both P2U and F2U bases within Pawtropolis as long as proper credit is given.",
        source: "art_rules",
      },
    ],
    guidance:
      "Flag images that look base-made: lookup matches tagged as a base or YCH, the same pose and linework under different characters, or copies where only colors and markings differ. A base-made piece counts as evidence when the applicant credited the base creator somewhere in the ticket. Without credit it does not count, and that is the concern to report. Say where the credit is, or that there is none, and whether the base looks paid.",
  },
  {
    key: "account_history",
    title: "Account and history",
    kind: "risk",
    rules: [
      { text: "Account <6 months old with no traceable history", source: "handbook" },
      { text: "Resistance to standard proof requests", source: "handbook" },
      { text: "DM advertising", source: "handbook" },
    ],
    guidance:
      "Use the server context as given: account age, join date, roles, activity, other verification tickets and the Verify Blacklist. An account under six months old with no traceable history is a red flag of its own, apart from the two six-month rules under active_commissions. Note how the applicant answered staff requests for more proof.",
  },
];

/** Handbook flags, quoted. Shown to the model so it uses the server's wording. */
export const RED_FLAGS: readonly string[] = [
  "Account <6 months old with no traceable history",
  "Sudden style/quality jumps between pieces",
  "Resistance to standard proof requests",
  "Demand for Friends & Family, crypto, gift cards, etc.",
  "AI detection triggers",
  "DM advertising",
  "New account + high prices",
  "Refuses timelapse/file/photo",
  "Style not consistent across portfolio",
];

export const GREEN_FLAGS: readonly string[] = [
  "Multi-year consistent public portfolio",
  "Voluntary sharing of WIPs/process",
  "Specific, verifiable client feedback",
  "Speedpaints",
  "Use of milestone payments and written agreements",
];

/** The handbook's AI-Generated Content Policy table, one entry per row. */
export const AI_POLICY: ReadonlyArray<{
  level: string;
  allowed: string;
  disclosure: string;
  consequence: string;
}> = [
  {
    level: "No AI involvement",
    allowed: "Yes (default)",
    disclosure: "Standard proof trio",
    consequence: "None",
  },
  {
    level: "AI used only as reference",
    allowed: "No",
    disclosure: "Declare upfront + provide full proof trio",
    consequence: "Treated as undisclosed AI",
  },
  {
    level: "100% AI-generated",
    allowed: "Prohibited",
    disclosure: "Not allowed",
    consequence: "Decline Verification",
  },
];

/** The handbook's Spotting AI Art table: what to look for, by category. */
export const AI_ARTIFACT_GUIDE: ReadonlyArray<{ category: string; artifacts: string }> = [
  {
    category: "Anatomical Errors",
    artifacts:
      "Extra/missing fingers/toes/digits, fused limbs, impossible joint bends, asymmetrical faces/eyes/ears, warped paws or muzzles",
  },
  {
    category: "Hands/Paws & Details",
    artifacts: 'Blobby or multi-fingered hands, unnatural claw placement, "melting" fingers',
  },
  {
    category: "Textures & Fur",
    artifacts:
      "Overly smooth/shiny plastic-like skin, inconsistent fur direction/flow, blurry or repeating patterns",
  },
  {
    category: "Backgrounds & Composition",
    artifacts:
      "Nonsensical elements (floating objects, impossible shadows/lighting), mismatched perspectives",
  },
  {
    category: "Stylistic Inconsistencies",
    artifacts:
      "Sudden glossy/over-saturated look, unnatural color blending, symmetrical errors in asymmetric poses",
  },
  {
    category: "Other Tells",
    artifacts:
      "Incoherent accessories (warped clothing/jewelry), weird reflections, or dream-like distortions",
  },
];

/**
 * Points where the applicant-facing text and the handbook disagreed, or neither
 * said anything. The owner settled each one on 2026-11-15 and the handbook
 * carries the rule now, so the command applies them instead of reporting them
 * as open questions.
 */
export const WORKFLOW_DECISIONS: readonly string[] = [
  'Evidence: the handbook decides. At least two of recorded timelapse, layered source file and dated work-in-progress photo are enough. The applicant-facing line "3 different WIP/Layers to previous work" is context and does not decide.',
  "Six months: three separate rules, and all three count. More than 6 months of experience, a commission within the 6 months before applying, and an account under 6 months old with no traceable history as a red flag.",
  "Bases: work made on a base counts as evidence when the base creator is credited. Without credit it does not count and is a concern.",
];

/** The handbook sentence that puts it above the applicant-facing text. */
export const HANDBOOK_PRECEDENCE =
  "Where the requirements shown to applicants ask for something else, staff go by the handbook.";

/** Every handbook quote this file relies on. The docs parity test checks each one. */
export function handbookQuotes(): string[] {
  const fromCriteria = CRITERIA.flatMap((c) =>
    c.rules.filter((r) => r.source === "handbook").map((r) => r.text)
  );
  const policyRows = AI_POLICY.map(
    (r) => `| ${r.level} | ${r.allowed} | ${r.disclosure} | ${r.consequence} |`
  );
  const guideRows = AI_ARTIFACT_GUIDE.map((r) => `| ${r.category} | ${r.artifacts} |`);
  return [
    ...new Set([
      ...fromCriteria,
      ...RED_FLAGS,
      ...GREEN_FLAGS,
      ...policyRows,
      ...guideRows,
      HANDBOOK_PRECEDENCE,
    ]),
  ];
}

/** A rule as shown in the report. Quotes taken from a handbook table lose their column bars. */
export function displayRule(text: string): string {
  return text.replace(/^\|\s*|\s*\|$/g, "").replace(/\s*\|\s*/g, " / ");
}

/** Applicant requirement lines as read from the live server on 2026-11-14. */
export function requirementQuotes(): string[] {
  return CRITERIA.flatMap((c) =>
    c.rules.filter((r) => r.source === "requirements").map((r) => r.text)
  );
}

/** Lowercase, straight quotes, markdown emphasis and custom emoji removed, whitespace collapsed. */
export function normalizeWorkflowText(text: string): string {
  return text
    .replace(/<a?:\w+:\d+>/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Applicant requirement lines the handbook overrules. */
function overruledQuotes(): string[] {
  return CRITERIA.flatMap((c) => c.rules.filter((r) => r.overruled).map((r) => r.text));
}

/**
 * Requirement lines that no longer appear in the greeting posted in this ticket.
 * An empty greeting returns nothing: there is no text to compare against. An
 * overruled line is left out, because a greeting without it is how it should be.
 */
export function findRequirementDrift(greetingText: string): string[] {
  const haystack = normalizeWorkflowText(greetingText);
  if (!haystack) return [];
  const overruled = new Set(overruledQuotes());
  return requirementQuotes().filter(
    (quote) => !overruled.has(quote) && !haystack.includes(normalizeWorkflowText(quote))
  );
}

/**
 * Overruled requirement lines that the greeting posted in this ticket carries:
 * the applicant was told something the handbook does not go by.
 */
export function findOverruledInGreeting(greetingText: string): string[] {
  const haystack = normalizeWorkflowText(greetingText);
  if (!haystack) return [];
  return overruledQuotes().filter((quote) => haystack.includes(normalizeWorkflowText(quote)));
}
