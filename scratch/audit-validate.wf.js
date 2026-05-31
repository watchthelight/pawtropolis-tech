export const meta = {
  name: 'audit-validate',
  description: 'Adversarial prevalidation of issue-worthy audit findings: each agent independently re-reads the cited code and confirms or refutes',
  phases: [{ title: 'Validate', detail: 'refute-or-confirm each finding by reading the real code', model: 'opus' }],
}

const TOTAL = (args && args.total) || 216
const BATCH = (args && args.batch) || 6
const N = Math.ceil(TOTAL / BATCH)

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
          real: { type: 'boolean' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'invalid'] },
          reason: { type: 'string' },
        },
        required: ['id', 'real', 'severity', 'reason'],
      },
    },
  },
  required: ['verdicts'],
}

const brief = (start) =>
  'You are an adversarial verifier prevalidating audit findings before they become tracked issues. Read the file audit/2026-05-31/findings-issueworthy.json (a JSON array of finding objects). Take the elements at indices [' +
  start + ', ' + (start + BATCH) + ') -- up to ' + BATCH +
  ' findings. For EACH one: open the cited file at the cited lines in the working tree and read the surrounding code yourself. Decide real=true ONLY if it is a genuine, defensible defect you independently confirmed. Actively try to REFUTE: if the code is actually correct, the path is unreachable, a guard exists elsewhere, the cited lines do not say what the finding claims, or you cannot confirm the impact, set real=false. Default to real=false when uncertain. Set severity to your adjusted rating (use "invalid" when real=false). Return one verdict per finding id you examined. You MUST call the StructuredOutput tool with your verdicts before finishing.'

phase('Validate')
const raw = await parallel(
  Array.from({ length: N }, (_, i) => () =>
    agent(brief(i * BATCH), { label: 'validate:' + i * BATCH, phase: 'Validate', schema: VERDICTS_SCHEMA, model: 'opus' })
  )
)

const verdicts = {}
raw.filter(Boolean).forEach((r) => (r.verdicts || []).forEach((v) => (verdicts[v.id] = v)))
const real = Object.values(verdicts).filter((v) => v.real).length
const refuted = Object.values(verdicts).filter((v) => !v.real).length
log('Validation: ' + Object.keys(verdicts).length + ' verdicts (' + real + ' confirmed, ' + refuted + ' refuted). Batches ok: ' + raw.filter(Boolean).length + '/' + N)

return { verdicts: Object.values(verdicts), confirmedReal: real, refuted, batchesOk: raw.filter(Boolean).length, batches: N }
