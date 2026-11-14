/**
 * Pawtropolis Tech -- src/features/artistInvestigation/criteria.ts
 * WHAT: The 2D artist verification workflow, as data: each criterion with the
 *       exact wording it comes from and where that wording lives.
 * WHY: /investigate-artist must score against the server's own rules and never
 *      invent any. Handbook quotes are locked to docs/MOD-HANDBOOK.md by
 *      tests/docs/artist-criteria.test.ts. The applicant requirements live only
 *      in Discord (read 2026-11-14), so each run compares them with the greeting
 *      in the ticket and reports any drift.
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
      { text: "3 different WIP/Layers to previous work", source: "requirements" },
      { text: "Speed-paints also help your verification", source: "requirements" },
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
    ],
    guidance:
      "Count distinct pieces that come with sketches, layer views, WIP stages, timelapses or source files, and say which of the handbook's three evidence types are present. Videos and source files are listed by name only: their contents were not inspected, so say that instead of assuming what they show.",
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
    title: "Active commissions",
    kind: "requirement",
    rules: [
      { text: "Have to be an artist that actively does commissions", source: "requirements" },
      {
        text: "If you haven't had a commission in the last 6 months prior to verifying, you will be ineligible",
        source: "requirements",
      },
    ],
    guidance:
      "Look for dated evidence of a commission within the six months before the ticket was opened. Dates the applicant states without anything to support them count as claims.",
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
        text: "Users may post artwork with P2U (Pay to Use) and F2U (Free to Use) bases as long as proper credit is given.",
        source: "handbook",
      },
      {
        text: "Users are allowed to post artwork with both P2U and F2U bases within Pawtropolis as long as proper credit is given.",
        source: "art_rules",
      },
    ],
    guidance:
      "Flag images that look base-made: lookup matches tagged as a base or YCH, the same pose and linework under different characters, or copies where only colors and markings differ. Say whether the applicant credited the base creator anywhere in the ticket and whether the base looks paid.",
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
      "Use the server context as given: account age, join date, roles, activity, other verification tickets and the Verify Blacklist. Note how the applicant answered staff requests for more proof.",
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
 * Places where the workflow's sources disagree or say nothing. The command
 * reports them as open questions and does not pick a side.
 */
export const WORKFLOW_GAPS: readonly string[] = [
  'Evidence count: the handbook asks for at least two of timelapse, layered source file or dated WIP photo; the applicant requirements ask for "3 different WIP/Layers to previous work". Both are reported.',
  "Bases as evidence: bases are allowed with credit when posting art. Neither source says whether base-made work counts toward verification.",
  "Six months: the requirements make an applicant ineligible without a commission in the last 6 months; the handbook treats an account under 6 months old with no traceable history as a red flag. These are separate rules.",
];

/** Every handbook quote this file relies on. The docs parity test checks each one. */
export function handbookQuotes(): string[] {
  const fromCriteria = CRITERIA.flatMap((c) =>
    c.rules.filter((r) => r.source === "handbook").map((r) => r.text)
  );
  const policyRows = AI_POLICY.map(
    (r) => `| ${r.level} | ${r.allowed} | ${r.disclosure} | ${r.consequence} |`
  );
  const guideRows = AI_ARTIFACT_GUIDE.map((r) => `| ${r.category} | ${r.artifacts} |`);
  return [...new Set([...fromCriteria, ...RED_FLAGS, ...GREEN_FLAGS, ...policyRows, ...guideRows])];
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

/**
 * Requirement lines that no longer appear in the greeting posted in this ticket.
 * An empty greeting returns nothing: there is no text to compare against.
 */
export function findRequirementDrift(greetingText: string): string[] {
  const haystack = normalizeWorkflowText(greetingText);
  if (!haystack) return [];
  return requirementQuotes().filter((quote) => !haystack.includes(normalizeWorkflowText(quote)));
}
