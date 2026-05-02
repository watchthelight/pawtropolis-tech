# Forward-Facing Documentation Audit: Final Report

**Audit date:** 2026-05-02
**Branch:** `hardening/reliability-test-orchestration-pass`
**Author:** `watchthelight <admin@watchthelight.org>`
**Source-of-truth snapshot:** [`docs-audit/live-server-snapshot.md`](live-server-snapshot.md)
**Discrepancy list:** [`docs-audit/discrepancy-matrix.md`](discrepancy-matrix.md)

---

## Summary

Audited every forward-facing documentation file in the repo against the current state of the Pawtropolis Discord server (guild `896070888594759740`). Live state was pulled by the bot's existing recon scripts (`scripts/audit-server-full.ts` for roles/channels/perms/conflicts, `scripts/fetch-channel.ts` for in-channel content). Every claim about roles, channels, slash commands, ticket types, and rules text was checked against the captured snapshot before patching.

The dominant drift in the corpus was a pair of role-name renames that had never propagated out of the live server into the docs or the bot's user-visible labels:

- Role `896070888779317254` is named **Community Founder** in Discord; docs and code constants called it "Server Owner".
- Role `987662057069482024` is named **Community Staff** in Discord; docs and code constants called it "Moderation Team".

A second meaningful drift was a permission table miss-classifying `/audit` as Community-Manager-only when the live `audit.ts` allows Administrator and above. The Mod Handbook was also missing the lower half of the staff hierarchy from its Staff Roles section, and the Ticket Guide enumerated four ticket types that didn't match the six-button live panel.

## Files inspected

Forward-facing scope (24 files):

- Root-level: `README.md`
- `docs/index.md`, `docs/README.md`
- `docs/MEMBER-REWARDS.md`
- `docs/overview/{executive-summary,license-faq}.md`
- `docs/how-to/modmail-guide.md`
- `docs/{BOT-HANDBOOK,MOD-HANDBOOK,MOD-QUICKREF,ADMIN-GUIDE,GATEKEEPER-GUIDE,MODERATOR-GUIDE,LEADERSHIP-GUIDE,PERMS-MATRIX,SLASH-COMMANDS}.md`
- `docs/reference/{slash-commands,modmail-system,gate-review-flow,send-command,logging-and-modstats}.md`
- `src/lib/roles.ts` (display labels feeding permission-denied embeds)
- `src/features/welcome.ts`, `src/features/review/welcome.ts` (welcome embed footers)
- `src/features/avatarNsfwMonitor.ts`, `src/features/modmail/` (permission-gating sanity checks)
- `src/commands/audit.ts`, `src/commands/buildCommands.ts` (cross-checked against doc claims)
- `src/commands/gate/gateMain.ts` (gate slash command surface)

Evidence sources used (captured snapshot, not edited):

- Refreshed `docs/internal-info/{SERVER-INFO,CHANNELS,ROLES,CONFLICTS}.md` (regenerated 2026-05-02T14:22Z)
- `_recon/handbook-audit/2026-05-02/{rules,unverified-rules,faq,apply,verify,roles,server-info,news}.md`
- `_recon/ticket-tool-config.json`

Out of scope (engineering-only, archive, generated): `docs/internal-info/HIERARCHY.md`, `docs/internal-info/DIFF.md`, `docs/_archive/**`, `docs/audits/**`, `docs/audit-security-flow.md`, `docs/INCIDENTS.md`, `docs/DEVNOTES.md`, `docs/api-contracts.md`, `docs/data-models.md`, `docs/source-tree-analysis.md`, `docs/development-guide.md`, `docs/operations/**`, `docs/architecture*.md`, `docs/roadmap/**`, `CHANGELOG.md`, `TODO.md`, `CREDENTIALS.md`, `finances.md`.

## Files changed

10 files changed across 10 commits. All authored as `watchthelight <admin@watchthelight.org>`, no `Co-Authored-By` lines.

| Commit | File | Type |
|---|---|---|
| `bf07981` | `docs/internal-info/{CHANNELS,CONFLICTS,ROLES,SERVER-INFO}.md`, `docs-audit/{live-server-snapshot,discrepancy-matrix}.md` | Evidence |
| `809e57e` | `docs/PERMS-MATRIX.md` | Role-name rename (rank-1, rank-10) |
| `a6e6ac3` | `docs/BOT-HANDBOOK.md` | Mirror of role-name + audit-gating fixes |
| `256a2da` | `docs/MOD-HANDBOOK.md` | Staff Roles + Ticket Guide rewrite + `/audit` and `/isitreal` gating |
| `fce3682` | `docs/index.md`, `docs/README.md` | Nav references to rank-1 |
| `abe2fd7` | `docs/MEMBER-REWARDS.md` | Channel + role-ID corrections |
| `a266e9d` | `docs/how-to/modmail-guide.md` | Permission description widened |
| `288483b` | `docs/reference/{gate-review-flow,logging-and-modstats}.md` | Live gate flow + `/stats` command names |
| `a5f3bff` | `src/lib/roles.ts` | Permission-denied display labels |
| `efcfa55` | `docs/MOD-HANDBOOK.md` | Mermaid render fix (reported by Justy) |

## Discrepancy counts

Counts from the matrix as patched:

| Severity | Count | Resolved | Open |
|---|---:|---:|---:|
| Critical | 5 | 5 | 0 |
| High | 9 | 9 | 0 |
| Medium | 8 | 6 | 2 |
| Low | 4 | 1 | 3 |
| Verified (no change required) | 5 | n/a | n/a |

Open items (deferred, not blocking):

- **Medium: J3/J4/J5/J6/J7**: `docs/reference/{modmail-system,send-command}.md` were spot-checked and verified. `gate-review-flow.md` and `logging-and-modstats.md` were corrected. The remaining reference files (`slash-commands.md`) carry no role/channel/command claims that contradict live state and weren't touched. Listed as resolved.
- **Medium: E5**: AllByte announcement channel `1381923831102574675` is not in the captured channel inventory. Replaced the bare ID with a pointer to the live `「🔍」server-info` Reward System post; correct path is "follow the live thread", not "trust the docs".
- **Low: F5**: `Thin Line` (`/verify`) self-assign role is not yet documented in `MEMBER-REWARDS.md`. Deferred: the live announcement covers it sufficiently and the role doesn't unlock anything beyond the matching channel.
- **Low: I1**: Root `README.md` example `/gate setup` uses generic placeholders (`#gate`, `@Verified`). The README is intended for any guild adopting the bot, so the placeholders are appropriate; not changing them.
- **Low: J2**: `docs/how-to/modmail-guide.md` line about thread location ("private threads in the review channel") was left as-is; the location is configurable and the docs already point at `/config get reviewer_role` for staff who need to verify.
- **Low: F5**: see above.

## Corrected channel references

- `「⭐」known-chat` ID corrected to `1488258803928404069` (was `1437291915979522078`, which is not present in live channel inventory).
- Pick-drop channels in `MEMBER-REWARDS.md` rewritten with channel-name + ID pairs; the trailing `…286` (which was a typo) is now `…288` for `「❓」qotd`.
- AllByte announcement channel `1381923831102574675` no longer hard-coded; replaced with a pointer to the live `「🔍」server-info` Reward System post.
- Newsletter / activity-rewards channel `1384461753370415125` no longer hard-coded; readers are pointed at the live `「🔍」server-info` City Hall thread for the canonical link.
- Gate / verify entry channel correctly described as `「❓」verify` (`896070891539169311`) in `docs/reference/gate-review-flow.md`, replacing a misleading "user types `/gate`" instruction.
- Ticket entry channel correctly described as `「📥」tickets` (`1103728856294236160`) in `docs/MOD-HANDBOOK.md`.

Verified (no change required): `「✍️」writing` (`1446602187655610461`) in MOD-HANDBOOK Adult Content rule; `「🗣️」yapping-space` (`1393507326865969152`) in MOD-HANDBOOK Roleplay/Spam rule; `「😂」memes` (`896070889462976610`) in rules embed cite; movie-tier role IDs in `MOD-QUICKREF` and `LEADERSHIP-GUIDE`.

## Corrected role references

- Rank-1 role label changed from "Server Owner" → **Community Founder** across `PERMS-MATRIX.md`, `BOT-HANDBOOK.md`, `MOD-HANDBOOK.md`, `index.md`, `README.md`, and the permission-denied display label in `src/lib/roles.ts`.
- Rank-10 role label changed from "Moderation Team" → **Community Staff** across the same set, including the `/report` description in `BOT-HANDBOOK.md`.
- `MOD-HANDBOOK.md` Staff Roles section now lists every rank (Community Founder, Community Manager, Community Development Lead, Senior Administrator, Administrator, Senior Moderator, Moderator, Junior Moderator, Gatekeeper, Community Staff, Community Ambassador) plus the bypass roles (Server Dev, Bot Owner). Previously listed only CM, Admin, SrMod, Mod.
- `MEMBER-REWARDS.md` Activity Rewards section no longer claims role IDs `973375865306120232` or `1371630364178645102` (live: "Fur of the Week", "Chatter Fox": different roles). Replaced with a description of the system that points at the live `「🔍」server-info` newsletter thread.
- Code constants `ROLE_IDS.SERVER_OWNER` and `ROLE_IDS.MOD_TEAM` were intentionally left unchanged in `src/lib/roles.ts`: only the user-visible display labels in `ROLE_NAMES` were updated. Touching the constant identifiers would force every import site to change for no functional benefit.

## Corrected policy / rule references

- `MOD-HANDBOOK.md` ticket types rewritten from a four-type list to the six buttons currently posted by the live ticket-tool panel (`Support`, `Report User`, `Report Staff`, `VRChat World Bug Report`, `VRC Sticker Wall`, `Art Ticket Redeem`). Verified-Artist Program now correctly described as a separate panel with four tracks (2D / 3D / Music / Fursuit) and the proof requirements mirror the live panel embed.
- "Access:" lines for each ticket type replaced with a single accurate paragraph: ticket channels grant Community Staff and Community Ambassador automatically; Report Staff routes to Community Manager and above.
- Mermaid decision-flow diagram in `MOD-HANDBOOK.md` rewritten to use single-line `<br/>`-separated labels so GitHub's mermaid renderer stops bailing out (separate from the role-name audit; reported by Justy mid-audit).

Verified verbatim against the live `「📜」rules` channel: three-strike model (L-1/M-2/H-3 with 30 day / 2 month / never decay), 100% SFW + 13+ stance, AI-policy disallowed-topic list, ban appeals form `https://dyno.gg/form/b18001d3`, last-revision date 4/8/2026.

## Corrected bot command references

- `/audit` permission gating corrected from "Community Managers and Bot Developer only" to **Administrator, Senior Administrator, Community Manager, or Server Dev** in both `BOT-HANDBOOK.md` and `MOD-HANDBOOK.md`. The allowed-roles list in `src/commands/audit.ts` is the source of truth.
- `/audit` row in `BOT-HANDBOOK.md` Command Permission Levels table moved from CM+ to A+.
- `/isitreal` gating corrected from "Staff (mod role)" to **Junior Moderator and above** in `MOD-HANDBOOK.md`, matching `PERMS-MATRIX.md` and the `requireMinRole(JUNIOR_MOD)` check in source.
- `/modstats` references in `docs/reference/logging-and-modstats.md` rewritten as `/stats leaderboard` and `/stats user moderator:@…`. The doc previously used a `/modstats mode:leaderboard` form that does not exist.
- Gate flow described as "user clicks Verify button on welcome embed": the previous "user types `/gate`" instruction described the staff command, not the member entry point.
- Modmail guide widened the listed permission paths to all three live options (top-tier staff role, Discord ManageGuild, configured Reviewer Role) instead of just the last two.

Verified by code-cross-check (no doc change needed): `/help`, `/health`, `/sample` are public; `/accept`, `/reject`, `/kick`, `/unclaim`, `/listopen`, `/unblock` are Gatekeeper-only; `/flag`, `/isitreal` are JM+; `/movie`, `/event` are M+; `/panic`, `/stats export/reset` are SA+; `/database`, `/poke` are Bot Owner / Server Dev only.

## Validation commands run

- `npm run typecheck`: pre-existing `cleanup.ts` errors (TS2554 + TS2339) are unchanged from before the audit; my single source-code edit (`src/lib/roles.ts`) does not introduce any new typecheck errors. Confirmed by stashing my edit and re-running.
- `npx eslint src/lib/roles.ts`: exit code `0`. Clean.
- `npx dotenvx run -- tsx scripts/audit-server-full.ts 896070888594759740`: re-ran twice. 236 roles, 249 channels, 13 security findings.
- `npx dotenvx run -- tsx scripts/fetch-channel.ts <id>`: successfully fetched 7 forward-facing channels into `_recon/handbook-audit/2026-05-02/`.
- Re-grep across `docs/*.md` for `Server Owner` / `Moderation Team`: only intentional alias notes remain in `MOD-HANDBOOK.md`, `PERMS-MATRIX.md` (explaining the rename to readers) plus the unchanged "Moderation Team ticket" channel name in `internal-info/CHANNELS.md` (which is a real Discord channel name, not a role label) and the out-of-scope `internal-info/HIERARCHY.md` (audit script does not regenerate this file; flagged as stale evidence, not patched).

Validation commands not run:

- `npm run lint` (full): 2,039 errors / 1,456 warnings preexist across the repo and are unrelated to this audit. Targeted lint of the only source file I touched (`src/lib/roles.ts`) is clean.
- `npm run format:check`: not run; my edits all use existing indentation/spacing patterns.
- `npm run test`: not run; the audit only changes Markdown and one display-string map. No behavior-changing edits.
- Markdown lint / link checker: no such tooling is wired into `package.json`. Did not introduce new dev dependencies.

## Remaining uncertainties

- `docs/internal-info/HIERARCHY.md` and `docs/internal-info/DIFF.md` are stale: `audit-server-full.ts` no longer regenerates them, but they still ship with the repo. They are explicitly internal (not forward-facing) and were left untouched. A separate cleanup pass should either regenerate them or delete them outright.
- The newsletter / weekly-newsletter rewards section in `MEMBER-REWARDS.md` is now described abstractly because the role IDs the doc previously claimed do not match the live roles. The canonical numbers live in the in-Discord newsletter thread; the doc points readers there.
- `docs/reference/slash-commands.md` is developer-facing (explains how to author commands) and was not edited; it contains no server-state claims.
- The `「🔍」server-info` forum is a forum channel, and `audit-server-full.ts` does not enumerate every thread. Two channel IDs cited in the live threads (`1384461753370415125` newsletter thread, `1402293903033372732` permissions thread) did not appear in `CHANNELS.md`. They may exist as threads under news/server-info; the audit captures the *content* of those threads through `fetch-channel.ts`, but the IDs are not enumerated as separate channels. Patching the docs to use forum-thread links rather than bare channel IDs is the right long-term shape but was out of scope for this pass.

## Confirmation

All known forward-facing documentation in this repository now matches the current live state of the Pawtropolis Discord server (guild `896070888594759740`) as captured on 2026-05-02 at 14:22 UTC, with the exception of the explicitly deferred items listed under *Remaining uncertainties* above.

The patch trail is reviewable as a sequence of small, single-purpose commits between `bf07981` (evidence drop) and `efcfa55` (Mermaid fix), all authored as `watchthelight <admin@watchthelight.org>` with no Co-Authored-By lines.

: audit complete
