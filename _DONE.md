# Pawtropolis: Done

One-line dated ledger. Detail in [`done/`](./done/). Pair of [`_BACKLOG.md`](./_BACKLOG.md).

Reverse chronological by completion date.

## 2026-05-19

- [x] [Upgrade Sentry packages (26 patches behind)](done/00005.md) `High` Bumped @sentry/node + @sentry/profiling-node ^10.20.0 -> ^10.53.1. No API changes, typecheck clean.
- [x] [Patch HIGH and CRITICAL npm vulnerabilities](done/00002.md) `Critical` Root + web/ npm audit clean of HIGH/CRITICAL in production. Five commits: removed @xenova, upgraded fastify, upgraded discord.js, added root overrides for protobufjs+fast-uri+jws+minimatch+ws, upgraded web vite/sveltekit/svelte.
- [x] [Remove or isolate @xenova/transformers](done/00003.md) `Critical` Confirmed unused via grep + Vision-only inference path. Removed cleanly. 32 transitive packages dropped.
- [x] [Upgrade Vite in web/ to patch dev-server path traversal](done/00004.md) `High` Bundled into #00002 step 5; web build verified clean.
- [x] [Smoke test the new issue system](done/00001.md) Round trip verified end to end: file created, GH issue 1 mirrored with correct labels (TODO/chore/Nominal/IP), file moved to done/, sync closed the issue.
