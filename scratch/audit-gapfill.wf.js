export const meta = {
  name: 'audit-gapfill',
  description: 'Recover the audit buckets and dimension sweeps that failed to return structured output, using the default (schema-reliable) agent',
  phases: [
    { title: 'Buckets', detail: 're-audit the file buckets that returned nothing', model: 'opus' },
    { title: 'Dimensions', detail: 'whole-codebase cross-cutting sweeps', model: 'opus' },
  ],
}

const MISSING = Array.isArray(args) ? args : []

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
          file: { type: 'string' },
          lines: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string' },
          title: { type: 'string' },
          detail: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          fix: { type: 'string' },
        },
        required: ['file', 'severity', 'category', 'title', 'detail', 'confidence'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['findings'],
}

const AUDIT_BRIEF = `You are a meticulous senior engineer auditing a TypeScript Discord bot + SvelteKit dashboard for REAL defects. Read each assigned file IN FULL and find: correctness bugs (off-by-one, inverted logic, bad copy-paste, mishandled null/undefined, boundary errors, missing await, wrong async ordering), security (injection via string-built SQL/shell/paths, missing authz/owner/tier checks, unvalidated input reaching sinks, secret/PII leakage), concurrency/races (check-then-act, unguarded caches, interaction double-handling), resource leaks (unclosed statements, dangling intervals/listeners), data integrity (double-count/drop SQL, non-idempotent writes, economy bugs), Discord API misuse (ack/defer timing, reply twice, wrong flags), unsound type escapes (\`as\`/non-null \`!\`/any hiding bugs), dead/unreachable code. Report ONLY defensible defects with concrete impact -- not style. Cite file + line(s), explain trigger + impact, rate severity + confidence, propose a fix. IMPORTANT: you MUST call the StructuredOutput tool with your findings array before finishing (empty array if the files are clean).`

const DIMENSIONS = [
  { key: 'injection', name: 'Injection (SQL / shell / path traversal)', hint: 'string-built SQL, db.exec/prepare with interpolation, child_process, fs paths from input' },
  { key: 'authz', name: 'Authorization / permission gating', hint: 'isOwner/hasStaffPermissions/tier checks missing or wrongly ordered on any command, button, modal, route, or API endpoint' },
  { key: 'authn', name: 'Authentication / session / CSRF / Origin', hint: 'dashboard auth, OAuth flow, session cookies, Origin allowlist, state-changing routes' },
  { key: 'secrets', name: 'Secrets / PII / log leakage', hint: 'tokens/keys in logs or responses, moderator_id or user PII exposed, .env handling' },
  { key: 'races', name: 'Concurrency / races / locks', hint: 'shared caches, check-then-act, scheduler overlap, interaction reentrancy' },
  { key: 'leaks', name: 'Resource leaks', hint: 'unclosed better-sqlite3 statements, setInterval never cleared, listeners, growing maps' },
  { key: 'input', name: 'Untrusted input validation', hint: 'Discord option/customId parsing, regex capture assumptions, number parsing, bounds' },
  { key: 'errors', name: 'Error handling', hint: 'swallowed catches, unhandled rejections, throwing in event handlers, missing try/catch around IO' },
  { key: 'sql', name: 'SQL correctness + migrations integrity', hint: 'GROUP BY/JOIN correctness, double counting, NULL handling, migration idempotency, schema drift' },
  { key: 'ratelimit', name: 'Rate limiting / abuse / DoS', hint: 'unbounded loops, missing cooldowns, expensive queries on hot paths, fan-out spam' },
  { key: 'economy', name: 'Economy / byte-token integrity', hint: 'double-spend, negative balances, off-by-one rewards, race on grant/redeem' },
  { key: 'discord', name: 'Discord interaction lifecycle', hint: 'defer/reply/update timing, 3s ack window, editReply vs reply, ephemeral flags, allowedMentions' },
  { key: 'types', name: 'Type-safety escapes', hint: 'unsound as-casts, non-null ! where undefined is real, any leaks, @ts-ignore hiding bugs' },
  { key: 'deadcode', name: 'Dead / unreachable code + unused exports', hint: 'unreachable branches, exports nobody imports, feature-flagged-off paths' },
  { key: 'perf', name: 'Performance hotspots', hint: 'N+1 DB queries, sync fs on request path, repeated work in loops, missing indexes vs query shape' },
  { key: 'web', name: 'Web SSR/CSR + caching correctness', hint: 'load functions, hydration, csr=false invariants, cache TTL/staleness, $derived vs initial-value' },
  { key: 'deploy', name: 'Deploy / ops scripts safety', hint: 'deploy.sh, migrate-remote, ssh/scp, lockfiles, backup-before-destructive, set -euo pipefail gaps' },
  { key: 'deps', name: 'Dependency / supply-chain', hint: 'unpinned versions, risky overrides, postinstall scripts' },
  { key: 'boundaries', name: 'Cross-module seams / nullability contracts', hint: 'a function trusts a caller invariant not all callers uphold; mismatched optional/required across imports' },
  { key: 'config', name: 'Config / env / feature flags / defaults', hint: 'missing env guards, unsafe defaults, flags that fail open, parseInt of env without validation' },
]

phase('Buckets')
const bucketRaw = await parallel(
  MISSING.map((i) => () =>
    agent(
      `${AUDIT_BRIEF}\n\nRead scratch/buckets.json (repo root), parse it as a JSON array of arrays, take element [${i}], and audit EVERY file path in that array (read each in full). This is bucket #${i}.`,
      { label: `gap:bucket-${i}`, phase: 'Buckets', schema: FINDINGS_SCHEMA, model: 'opus' }
    )
  )
)

phase('Dimensions')
const dimRaw = await parallel(
  DIMENSIONS.map((d) => () =>
    agent(
      `You are auditing the WHOLE codebase along one axis: ${d.name}. Use Grep and Glob to enumerate every relevant site across src/, web/src/, scripts/, migrations/, workers/, then read the suspicious ones in full. Hints: ${d.hint}. Report only real, defensible defects with concrete impact and a fix, citing file + lines, severity, confidence. Focus on cross-file interactions where one module trusts another incorrectly. You MUST call StructuredOutput with your findings (empty array if none).`,
      { label: `gap-dim:${d.key}`, phase: 'Dimensions', schema: FINDINGS_SCHEMA, model: 'opus' }
    )
  )
)

const out = []
bucketRaw.filter(Boolean).forEach((r, i) => (r.findings || []).forEach((f, fi) => out.push({ ...f, id: `G-b${MISSING[i]}-${fi}`, source: `bucket-${MISSING[i]}` })))
dimRaw.filter(Boolean).forEach((r, i) => (r.findings || []).forEach((f, fi) => out.push({ ...f, id: `G-d${i}-${fi}`, source: `dim:${DIMENSIONS[i].key}` })))
const sev = {}
out.forEach((f) => (sev[f.severity] = (sev[f.severity] || 0) + 1))
log(`Gap-fill recovered ${out.length} findings (buckets ${bucketRaw.filter(Boolean).length}/${MISSING.length}, dims ${dimRaw.filter(Boolean).length}/${DIMENSIONS.length}). Severity: ${JSON.stringify(sev)}`)

return { recovered: out.length, bySeverity: sev, bucketsOk: bucketRaw.filter(Boolean).length, dimsOk: dimRaw.filter(Boolean).length, findings: out }
