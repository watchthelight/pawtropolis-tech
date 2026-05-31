export const meta = {
  name: 'full-codebase-audit',
  description: 'Exhaustive Opus multi-agent audit of the entire codebase: a reader per file-bucket plus whole-codebase cross-cutting sweeps, adversarially verified and synthesized into a ranked report',
  phases: [
    { title: 'Audit', detail: 'one Opus agent per file bucket (all 989 files)', model: 'opus' },
    { title: 'Dimensions', detail: 'whole-codebase axis sweeps (injection, authz, races, leaks, ...)', model: 'opus' },
    { title: 'Verify', detail: 'adversarial skeptics confirm or refute high-severity findings', model: 'opus' },
    { title: 'Synthesize', detail: 'dedup, rank, and write the audit report', model: 'opus' },
  ],
}

const BUCKETS = typeof args === 'number' ? args : 91

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          file: { type: 'string', description: 'repo-relative path' },
          lines: { type: 'string', description: 'line or range, e.g. 42 or 42-58' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string', description: 'e.g. security, correctness, race, leak, sql, types, perf, dead-code' },
          title: { type: 'string' },
          detail: { type: 'string', description: 'what is wrong and the concrete impact / how it triggers' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          fix: { type: 'string', description: 'concrete suggested fix' },
        },
        required: ['file', 'severity', 'category', 'title', 'detail', 'confidence'],
      },
    },
    notes: { type: 'string', description: 'optional coverage notes / anything not reachable' },
  },
  required: ['findings'],
}

const VERDICTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          real: { type: 'boolean', description: 'true only if it is a genuine, defensible defect you confirmed by reading the code' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'invalid'] },
          reason: { type: 'string' },
        },
        required: ['id', 'real', 'severity', 'reason'],
      },
    },
  },
  required: ['verdicts'],
}

const SECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    markdown: { type: 'string', description: 'a complete markdown section for this area, findings ordered by severity' },
    critical: { type: 'number' },
    high: { type: 'number' },
  },
  required: ['markdown'],
}

const FINAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    report: { type: 'string', description: 'the full assembled markdown audit report' },
    summary: { type: 'string', description: 'executive summary, a few sentences' },
    criticalCount: { type: 'number' },
    highCount: { type: 'number' },
    mediumCount: { type: 'number' },
    lowCount: { type: 'number' },
    topRisks: { type: 'array', items: { type: 'string' } },
    coverageGaps: { type: 'array', items: { type: 'string' }, description: 'anything not audited or needing a follow-up pass' },
  },
  required: ['report', 'summary', 'criticalCount', 'highCount'],
}

const AUDIT_BRIEF = `You are a meticulous senior engineer auditing a TypeScript Discord bot + SvelteKit dashboard for REAL defects. For your assigned files, read each one IN FULL and look hard for:
- correctness bugs (off-by-one, wrong operator/condition, inverted logic, bad copy-paste, mishandled null/undefined, boundary errors, wrong async/await ordering, missing await)
- security (injection via string-built SQL/shell/paths, missing authz/owner/tier checks, unvalidated Discord/user input reaching sinks, secret or PII leakage in logs/responses, SSRF, unsafe deserialization)
- concurrency / races (shared mutable state, check-then-act, unguarded caches, interaction double-handling)
- resource leaks (unclosed DB statements/handles, dangling setInterval/listeners, unbounded growth)
- data integrity (SQL that can double-count or drop rows, non-idempotent writes, money/byte-token economy bugs)
- Discord API misuse (ack/defer timing, replying twice, wrong flags, permission assumptions)
- type-safety escapes that hide real bugs (unsound \`as\`, non-null \`!\` where undefined is actually possible, \`any\` that lets a wrong type through)
- dead/unreachable code, and broken edge cases

Rules: report ONLY defensible defects with concrete impact -- not style, naming, or formatting unless it causes a real bug or security issue. For each, cite file + line(s), explain how it triggers and the impact, rate severity and your confidence, and propose a concrete fix. If a file is clean, do not invent findings. Cross-reference the files in your bucket against each other (callers vs callees) where relevant.`

const DIMENSIONS = [
  { key: 'injection', name: 'Injection (SQL / shell / path traversal)', hint: 'string-built SQL, db.exec/prepare with interpolation, child_process, fs paths from input' },
  { key: 'authz', name: 'Authorization / permission gating', hint: 'isOwner/hasStaffPermissions/tier checks: any command, button, modal, route, or API endpoint missing or wrongly ordered checks' },
  { key: 'authn', name: 'Authentication / session / CSRF / Origin', hint: 'dashboard auth, OAuth flow, session cookies, Origin allowlist, state-changing routes' },
  { key: 'secrets', name: 'Secrets / PII / log leakage', hint: 'tokens/keys in logs or responses, moderator_id or user PII exposed, .env handling' },
  { key: 'races', name: 'Concurrency / races / locks', hint: 'shared caches, check-then-act, scheduler overlap, interaction reentrancy, deploy lock' },
  { key: 'leaks', name: 'Resource leaks', hint: 'unclosed better-sqlite3 statements, setInterval never cleared, event listeners, growing maps' },
  { key: 'input', name: 'Untrusted input validation', hint: 'Discord option/customId parsing, regex capture assumptions, number parsing, bounds' },
  { key: 'errors', name: 'Error handling', hint: 'swallowed catches, unhandled promise rejections, throwing in event handlers, missing try/catch around IO' },
  { key: 'sql', name: 'SQL correctness + migrations integrity', hint: 'GROUP BY/JOIN correctness, double counting, NULL handling, migration idempotency, schema drift vs ensure* self-heal' },
  { key: 'ratelimit', name: 'Rate limiting / abuse / DoS', hint: 'unbounded loops, missing cooldowns on user-triggered actions, expensive queries on hot paths, fan-out spam' },
  { key: 'economy', name: 'Economy / byte-token integrity', hint: 'double-spend, negative balances, off-by-one rewards, race on grant/redeem' },
  { key: 'discord', name: 'Discord interaction lifecycle', hint: 'defer/reply/update timing, 3s ack window, editReply vs reply, ephemeral flags, allowedMentions' },
  { key: 'types', name: 'Type-safety escapes', hint: 'unsound as-casts, non-null ! where undefined is real, any leaks, @ts-ignore hiding bugs' },
  { key: 'deadcode', name: 'Dead / unreachable code + unused exports', hint: 'unreachable branches, exports nobody imports, feature-flagged-off paths' },
  { key: 'perf', name: 'Performance hotspots', hint: 'N+1 DB queries, sync fs on request path, repeated work in loops, missing indexes vs query shape' },
  { key: 'web', name: 'Web SSR/CSR + caching correctness', hint: 'load functions, hydration assumptions, csr=false invariants, cache TTL/staleness, $derived vs initial-value' },
  { key: 'deploy', name: 'Deploy / ops scripts safety', hint: 'deploy.sh, migrate-remote, ssh/scp, lockfiles, backup-before-destructive, set -euo pipefail gaps' },
  { key: 'deps', name: 'Dependency / supply-chain', hint: 'unpinned versions, risky overrides, postinstall scripts, known-vuln patterns' },
  { key: 'boundaries', name: 'Cross-module seams / nullability contracts', hint: 'a function trusts a caller-provided invariant that callers do not all uphold; mismatched optional/required across the import graph' },
  { key: 'config', name: 'Config / env / feature flags / defaults', hint: 'missing env guards, unsafe defaults, flags that fail open, parse-int of env without validation' },
]

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ---- Phase 1: per-bucket file audit (read scratch/buckets.json, take your index) ----
phase('Audit')
const auditRaw = await parallel(
  Array.from({ length: BUCKETS }, (_, i) => () =>
    agent(
      `${AUDIT_BRIEF}\n\nRead the file scratch/buckets.json (repo root). It is a JSON array of arrays. Parse it and take element at index [${i}] -- that array is YOUR assigned list of repo-relative file paths. Read EVERY file in that list in full, then report your findings. Audit bucket #${i} of ${BUCKETS}.`,
      { label: `audit:bucket-${i}`, phase: 'Audit', schema: FINDINGS_SCHEMA, model: 'opus', agentType: 'Explore' }
    )
  )
)

// ---- Phase 2: whole-codebase cross-cutting sweeps ----
phase('Dimensions')
const dimRaw = await parallel(
  DIMENSIONS.map((d) => () =>
    agent(
      `You are auditing the WHOLE codebase along a single axis: ${d.name}. Look at how files interact, not just one file. Use Grep and Glob to enumerate every relevant site across src/, web/src/, scripts/, migrations/, workers/, then read the suspicious ones in full. Focus hints: ${d.hint}. Report only real, defensible defects with concrete impact, citing file + lines, severity, confidence, and a concrete fix. Pay special attention to cross-file interactions where one module trusts another incorrectly.`,
      { label: `dim:${d.key}`, phase: 'Dimensions', schema: FINDINGS_SCHEMA, model: 'opus', agentType: 'Explore' }
    )
  )
)

// ---- Collect + id every finding ----
const all = []
;[...auditRaw, ...dimRaw].filter(Boolean).forEach((r, ri) => {
  ;(r.findings || []).forEach((f, fi) => {
    all.push({ ...f, id: `F${ri}-${fi}`, source: ri < BUCKETS ? `bucket-${ri}` : `dim` })
  })
})
log(`Collected ${all.length} raw findings from ${BUCKETS} file buckets + ${DIMENSIONS.length} dimension sweeps.`)

// ---- Phase 3: adversarial verification of critical/high findings ----
phase('Verify')
const highSev = all.filter((f) => f.severity === 'critical' || f.severity === 'high')
let verdictMap = {}
if (highSev.length > 0) {
  const VB = Math.min(12, Math.max(1, Math.ceil(highSev.length / 4)))
  const batches = chunk(highSev, Math.ceil(highSev.length / VB))
  const verdictRaw = await parallel(
    batches.map((b, i) => () =>
      agent(
        `You are an adversarial verifier. For each finding below, independently OPEN the cited file(s) and read the surrounding code. Decide if it is a GENUINE defect. Try hard to REFUTE it: if the code is actually correct, the path is unreachable, a guard exists elsewhere, or you cannot confirm the impact, mark real=false. Default to real=false when uncertain. Adjust severity if the original over- or under-rated it (use "invalid" severity when real=false). Findings (JSON):\n\n${JSON.stringify(b.map((f) => ({ id: f.id, file: f.file, lines: f.lines, severity: f.severity, category: f.category, title: f.title, detail: f.detail })))}`,
        { label: `verify:batch-${i}`, phase: 'Verify', schema: VERDICTS_SCHEMA, model: 'opus', agentType: 'Explore' }
      )
    )
  )
  verdictRaw.filter(Boolean).forEach((v) => (v.verdicts || []).forEach((x) => (verdictMap[x.id] = x)))
}

// Confirmed = verified-real high/critical, plus all medium/low carried as unverified.
const confirmedHigh = highSev
  .map((f) => ({ ...f, verdict: verdictMap[f.id] }))
  .filter((f) => f.verdict && f.verdict.real)
  .map((f) => ({ ...f, severity: f.verdict.severity === 'invalid' ? f.severity : f.verdict.severity }))
const refutedCount = highSev.length - confirmedHigh.length
const lowerSev = all.filter((f) => f.severity === 'medium' || f.severity === 'low')
const forReport = [...confirmedHigh, ...lowerSev]
log(`Verification: ${confirmedHigh.length} high/critical confirmed, ${refutedCount} refuted. ${lowerSev.length} medium/low carried.`)

// ---- Phase 4: synthesis by area + final assembly/critic ----
phase('Synthesize')
const areaOf = (f) => {
  const p = f.file || ''
  if (p.startsWith('web/')) return 'web dashboard'
  if (p.startsWith('scripts/') || p.startsWith('migrations/') || p.startsWith('workers/')) return 'scripts / migrations / ops'
  if (p.startsWith('src/commands') || p.startsWith('src/handlers') || p.startsWith('src/events')) return 'bot commands & handlers'
  if (p.startsWith('src/features')) return 'bot features'
  return 'bot core / lib / other'
}
const areas = ['web dashboard', 'scripts / migrations / ops', 'bot commands & handlers', 'bot features', 'bot core / lib / other']
const sections = await parallel(
  areas.map((area) => () => {
    const fs = forReport.filter((f) => areaOf(f) === area)
    return agent(
      `Write the "${area}" section of a codebase audit report from the confirmed findings below. Group by severity (Critical, High, Medium, Low). For each finding give: a short bold title, file:lines, the impact, and the suggested fix, as tight markdown. Merge obvious duplicates. If the list is empty, return a one-line "No confirmed findings in this area." Findings JSON:\n\n${JSON.stringify(fs.map((f) => ({ file: f.file, lines: f.lines, severity: f.severity, category: f.category, title: f.title, detail: f.detail, fix: f.fix, confidence: f.confidence })))}`,
      { label: `synth:${area.split(' ')[0]}`, phase: 'Synthesize', schema: SECTION_SCHEMA, model: 'opus', agentType: 'Explore' }
    ).then((r) => ({ area, ...(r || {}) }))
  })
)

const counts = {
  critical: forReport.filter((f) => f.severity === 'critical').length,
  high: forReport.filter((f) => f.severity === 'high').length,
  medium: forReport.filter((f) => f.severity === 'medium').length,
  low: forReport.filter((f) => f.severity === 'low').length,
}
const final = await agent(
  `You are the lead auditor assembling the final FULL-CODEBASE AUDIT report for a single-developer Discord bot + SvelteKit dashboard. Inputs: per-area sections (markdown) and the severity counts. Produce one cohesive markdown report: a title, a 3-6 sentence executive summary, a severity tally, a "Top risks to fix first" ordered list (the few that matter most), then the per-area sections in this order: ${areas.join(', ')}. Be precise and skeptical -- this went through adversarial verification, so present confirmed issues confidently but do not inflate. Also list coverage gaps if any.\n\nSeverity counts: ${JSON.stringify(counts)}\nRaw confirmed high/critical count: ${confirmedHigh.length}, refuted: ${refutedCount}.\n\nArea sections (JSON array of {area, markdown}):\n\n${JSON.stringify(sections.filter(Boolean).map((s) => ({ area: s.area, markdown: s.markdown })))}`,
  { label: 'synth:assemble+critic', phase: 'Synthesize', schema: FINAL_SCHEMA, model: 'opus', agentType: 'Explore' }
)

return {
  agentsApprox: BUCKETS + DIMENSIONS.length + Object.keys(verdictMap).length > 0 ? BUCKETS + DIMENSIONS.length : BUCKETS + DIMENSIONS.length,
  rawFindings: all.length,
  confirmedHighCritical: confirmedHigh.length,
  refuted: refutedCount,
  counts,
  report: final ? final.report : '(synthesis failed)',
  summary: final ? final.summary : '',
  topRisks: final ? final.topRisks : [],
  coverageGaps: final ? final.coverageGaps : [],
  allFindings: all,
  confirmed: forReport,
}
