export const meta = {
  name: 'vitest-v4-testfix',
  description: 'Fix vitest v4 breaking changes in specific failing test files, one agent per file',
  phases: [{ title: 'Fix', detail: 'one agent per failing test file, self-verified' }],
}

const FILES = [
  'tests/commands/purge.test.ts',
  'tests/config/flaggerStore.test.ts',
  'tests/features/appLookup.test.ts',
  'tests/db/ensure.test.ts',
  'tests/listeners/messageDadMode.test.ts',
  'tests/listeners/messageSkullMode.test.ts',
]

const GUIDANCE = `The repo just upgraded vitest 3.2.4 -> 4.1.7. The test config (vitest.config.ts) sets restoreMocks:true + clearMocks:true. Your job: make ONE test file pass under v4 by fixing ONLY v4 breaking-change fallout. Do NOT change source code under src/ and do NOT weaken/delete assertions to make them pass.

KNOWN v4 BREAKING CHANGES seen in this codebase and their fixes:

1. ARROW-FUNCTION CONSTRUCTOR MOCKS. In v4 a mock whose implementation is an arrow function cannot be used with \`new\`. Symptom: "TypeError: () => ... is not a constructor". Fix: change the arrow to a regular function.
   - vi.fn(() => obj)                  -> vi.fn(function () { return obj; })
   - vi.fn().mockImplementation(() => obj) -> vi.fn().mockImplementation(function () { return obj; })
   Apply ONLY to mocks of things constructed with \`new\` (classes/builders). Leave plain callback mocks alone.

2. MOCK IMPLEMENTATIONS RESET BETWEEN TESTS. v4 resets vi.fn() implementations AND vi.spyOn spies before each test (v3 restoreMocks only restored spies). Symptom: a test that runs fine in isolation FAILS when run after another test that overrode a shared/module-scope mock (e.g. a prior test did \`db.prepare.mockReturnValue(throwingStub)\` or \`mockImplementationOnce(throw)\`), because the default implementation is no longer restored. Also shows up as unexpected thrown errors bleeding into later tests ("Create failed", "Index failed", "Some other error") or a query mock returning undefined.
   Fix: re-establish the DEFAULT mock implementation in beforeEach (after vi.clearAllMocks()). Make beforeEach async if you need to \`await import(...)\` the mocked module to get a handle. Example:
     beforeEach(async () => {
       vi.clearAllMocks();
       const { db } = await import('../../src/db/db.js');
       (db.prepare as any).mockImplementation(() => ({ all: vi.fn(() => []), get: vi.fn(() => ({ count: 0 })) }));
     });
   Keep tests that intentionally override the default (throwing/empty cases) working - they set their own override locally, which is fine now that the default is restored each test.

3. STALE vi.mock PATHS. v4 resolves vi.mock() target modules strictly; mocking a path that does not exist now errors ("Cannot find module"). Fix: point the mock (and any import) at the real module path.

4. SPY RE-USE. If a test re-spies a global already spied in beforeEach (e.g. vi.spyOn(Math, 'random')), and v4 restored it between tests, just ensure each test (or beforeEach) sets the implementation it needs. Symptom: odds/random-based assertions like "expected not to be called, but called 1 times".

PROCESS:
- Read the file. Run \`npx vitest run <thefile>\` to see current failures (use the Bash tool).
- Diagnose which of the above applies (often #2). Confirm a suspected pollution by checking whether the failing test passes in isolation: \`npx vitest run <thefile> -t "<test name>"\`.
- Apply the minimal fix. Re-run the file until ALL tests in it pass.
- Do not touch other files. Do not edit vitest.config.ts. Do not change src/.

Return: the file you fixed, which v4 change(s) applied, and the final "N passed" line from your last run.`

phase('Fix')

const results = await parallel(
  FILES.map((file) => () =>
    agent(`${GUIDANCE}\n\nYOUR FILE: ${file}\n\nFix it and verify with \`npx vitest run ${file}\` until green.`, {
      label: `fix:${file.replace(/^tests\//, '').replace(/\.test\.ts$/, '')}`,
      phase: 'Fix',
    })
  )
)

return { fixed: results.filter(Boolean).length, files: FILES, summaries: results.filter(Boolean) }
