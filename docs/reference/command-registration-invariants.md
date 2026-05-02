# Command registration invariants

Pawtropolis Tech registers slash commands in two places that must stay in lockstep:

1. `src/commands/buildCommands.ts`: `buildCommands()` returns the JSON payloads sent to Discord's bulk command registration endpoint.
2. `src/index.ts`: populates a `Collection<string, executor>` keyed by command name; the interaction router looks up handlers by name when an interaction arrives.

`src/commands/runtimeManifest.ts` is the single source of truth tying the two together.

## Invariants

These invariants are enforced by `tests/commands/registration.test.ts`:

1. Every slash command JSON in `buildCommands()` has a matching name in `SLASH_COMMAND_NAMES`.
2. Every name in `SLASH_COMMAND_NAMES` appears in `buildCommands()` (unless explicitly listed in `INTERNAL_ONLY_RUNTIME_NAMES`).
3. Every context menu JSON in `buildCommands()` is in `CONTEXT_MENU_NAMES` (and vice versa).
4. The gate command and its aliases (`accept`, `reject`, `kick`, `unclaim`) are all registered.
5. No name appears twice in the manifest or in `buildCommands()`.

`src/index.ts` also asserts at startup that the runtime `commands` Collection contains exactly the entries listed in `SLASH_COMMAND_NAMES`. A mismatch throws and the bot refuses to start, surfacing the drift before applicants can be told "Unknown command."

## Adding a new slash command

1. Add the data import + `commands.set(...)` call in `src/index.ts`.
2. Add the data import + `data.toJSON()` entry in `src/commands/buildCommands.ts`.
3. Add the name string to `SLASH_COMMAND_NAMES` in `src/commands/runtimeManifest.ts`.
4. Run `npm test -- tests/commands/registration.test.ts`.

If you forget any one of those three places, the test fails or the bot fails to start. Both signals are loud.

## Adding a new context menu

1. Build the `ContextMenuCommandBuilder` and import it into `buildCommands.ts`.
2. Add a route in the `interaction.isContextMenuCommand()` block of `src/index.ts`.
3. Add the menu name (display label, e.g. `"Is It Real?"`) to `CONTEXT_MENU_NAMES`.

Context menus are dispatched by their `commandName` (the display label), not by a customId, so the manifest tracks the human-readable name. There is no startup-time assertion for context menus today; the test alone catches drift.

## Internal-only runtime commands

If a slash command should exist in the runtime dispatch table but never be registered with Discord (for example, a hidden owner debug command), add it to both `SLASH_COMMAND_NAMES` and `INTERNAL_ONLY_RUNTIME_NAMES`. The test will then accept that the name has no JSON in `buildCommands()`.

The list is empty today. Adding entries should be reviewed; the alternative is usually a developer-tier check inside a normal command.

## Why two sources?

We could fold the lists into one and treat the manifest as the only source. We didn't, because:

- `buildCommands()` returns rich `SlashCommandBuilder` JSON (descriptions, options, permissions). The manifest only carries names.
- The runtime registry maps names to executor functions; the build registry maps names to schemas. Different concerns, different files.

The manifest is intentionally a thin glue layer that the test uses to assert the two stay aligned.
