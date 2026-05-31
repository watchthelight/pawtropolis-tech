export const meta = {
  name: 'unused-symbol-sweep',
  description: 'Clear TS6133/TS6196 unused-symbol errors across the codebase in parallel by file group',
  phases: [{ title: 'Sweep', detail: 'one agent per disjoint file group' }],
}

// args is the raw `tsc` error list: lines like
//   path/to/file.ts(line,col): error TS6133: 'Name' is declared but its value is never read.
const raw = String(args || '').trim()
const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)

// Group error lines by file path.
const byFile = new Map()
for (const line of lines) {
  const m = line.match(/^(.+?\.ts)\(/)
  if (!m) continue
  const file = m[1]
  if (!byFile.has(file)) byFile.set(file, [])
  byFile.get(file).push(line)
}

const files = [...byFile.keys()].sort()
const GROUPS = 8
const buckets = Array.from({ length: GROUPS }, () => [])
// Contiguous chunks keep same-directory files together and disjoint per agent.
const perBucket = Math.ceil(files.length / GROUPS)
files.forEach((f, i) => {
  buckets[Math.min(GROUPS - 1, Math.floor(i / perBucket))].push(f)
})

const RULES = `You are clearing TypeScript "declared but never read" errors (TS6133 / TS6196) now that noUnusedLocals + noUnusedParameters are enabled. Apply the SAFEST correct transform per site. Read each site before editing.

Transform rules (in priority order):
1. Unused IMPORT name: remove only that name from the import clause. If it is the sole import on the line, delete the whole import statement. Keep other names on the line intact. Preserve "import type" vs "import" form.
2. Unused top-level const / function / type / interface declaration that is NOT exported: delete the entire declaration. (tsc never flags exported symbols, so anything flagged is safe to remove.)
3. Unused LOCAL variable "const x = <expr>;":
   - If <expr> is a pure expression (literal, property access, arithmetic, array/object literal): delete the whole statement.
   - If <expr> is or contains a CALL or anything with side effects (db writes, network, logging, await): KEEP the call, drop only the binding. Replace "const x = foo();" with "foo();" (or "await foo();" if it was awaited). Do NOT delete a side-effecting call.
4. Unused FUNCTION PARAMETER: rename it with a leading underscore (e.g. "client" -> "_client"). This satisfies noUnusedParameters. Only remove a parameter if it is the LAST one AND removing it cannot break a call site or an interface/override signature; when unsure, just underscore-prefix it.
5. Unused DESTRUCTURED property (e.g. "const { embed, appUrls } = f()" where appUrls is unused): remove that property from the pattern -> "const { embed } = f()".
6. Unused CATCH binding: prefer "catch {" (optional catch binding) if the runtime is modern; otherwise rename to "_err".
7. A local whose name already starts with "_" but is still flagged (e.g. "_DISCORD_MAX_LENGTH"): it is an unused local, not a param. Delete it per rule 2/3.

Do NOT:
- Change runtime behavior. Never delete a statement that performs I/O, mutation, or logging.
- Touch anything not named in the error list below.
- Reformat unrelated code or remove comments.
- Run tsc or tests (verification happens centrally afterward).

Edit the files directly with your file tools. After editing, return a one-line-per-fix summary of what you changed and which rule you applied.`

phase('Sweep')

const results = await parallel(
  buckets
    .filter((b) => b.length > 0)
    .map((group, idx) => () => {
      const errs = group.flatMap((f) => byFile.get(f))
      const label = `sweep:${group[0].replace(/^.*\//, '').replace(/\.ts$/, '')}+${group.length - 1}`
      return agent(
        `${RULES}\n\nFix exactly these ${errs.length} errors across ${group.length} file(s). Each line is "file(line,col): error CODE: 'Name' ...":\n\n${errs.join('\n')}`,
        { label, phase: 'Sweep' }
      )
    })
)

return { groups: buckets.filter((b) => b.length).length, summaries: results.filter(Boolean) }
