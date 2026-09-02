# Slash Commands

This page is intentionally a short quick-reference. The complete, per-command details (subcommands, options, examples, permission tiers) live in **[BOT-HANDBOOK.md](../BOT-HANDBOOK.md)** and in the in-bot `/help` system, which is the live source of truth.

## How to find what a command does

1. In Discord, run `/help` and search by name, alias, or category. Owner / staff visibility is filtered per-user, so what you see is what you can run.
2. In source: `src/commands/help/registry.ts` is the canonical metadata; `src/commands/runtimeManifest.ts` is the canonical list of registered names.

## Quick reference (top-level commands)

Categories follow `/help`'s grouping. **Hidden** = registered but intentionally not in `/help` (dev tools).

| Category | Commands |
|---|---|
| Gate & Verification | `/gate`, `/accept`, `/reject`, `/kick`, `/unclaim`, `/welcomebatch`, `/verify`, `/admin-migrate-unverified` |
| Queue & Review | `/listopen`, `/sample`, `/review-set-notify-config`, `/review-get-notify-config`, `/review-set-listopen-output` |
| Moderation | `/audit`, `/flag`, `/isitreal`, `/unblock`, `/report`, `/cleanup`, `/purge` |
| Configuration | `/config` |
| Messaging | `/send`, `/poke`, `/modmail`, `/qotd` |
| Roles | `/roles`, `/restoreroles`, `/panic` |
| Artist System | `/artistqueue`, `/redeemreward`, `/art`, `/usebyte` |
| Rewards & Inventory | `/stash`, `/redeem` |
| Events | `/movie`, `/event`, `/attendance` |
| Analytics | `/stats` (subcommands: activity, approval-rate, leaderboard, user, export, reset, history) |
| Search | `/search` |
| Tickets | `/postticketpanel`, `/closeticket`, `/assignticket` |
| Help & System | `/help`, `/health`, `/update`, `/database`, `/resetdata`, `/backfill` |
| Developer Tools (hidden from /help) | `/developer`, `/test`, `/testidea`, `/skullmode` |

## Registering commands

```bash
npm run deploy:cmds
```

Run after:

- Adding or removing a slash command in `src/commands/`
- Changing a command's name, description, options, or subcommands
- Updating choice lists or autocompletion

Re-deploy is not required for behavior-only changes inside an existing command (those ship with a normal `bash scripts/deploy.sh`).

If `deploy:cmds` hangs locally on Windows, run it on the EC2 host instead. See [deploy memory](../../README.md) for the full procedure.

## Common issues

- **Command missing in Discord?** Re-run `npm run deploy:cmds`. Global commands take up to an hour to propagate; the deploy script uses guild commands which propagate instantly.
- **Permission denied?** Check role hierarchy in [PERMS-MATRIX.md](../PERMS-MATRIX.md) and confirm the user has the role at-or-above the documented minimum.
- **Subcommand not listed in `/help`?** Add it to the corresponding entry in `src/commands/help/registry.ts` and redeploy.

## See also

- [Bot Handbook](../BOT-HANDBOOK.md) — full per-command guide
- [PERMS-MATRIX.md](../PERMS-MATRIX.md) — permission tiers per command
- [command-checklist.md](command-checklist.md) and [command-patterns.md](command-patterns.md): creating and registering commands
- [TICKET-SYSTEM-GUIDE.md](../TICKET-SYSTEM-GUIDE.md) — first-party ticket flow
- [Command Patterns](command-patterns.md) — shared command-level patterns
