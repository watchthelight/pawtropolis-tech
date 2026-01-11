# Command Patterns Reference

Quick reference for common command patterns in Pawtropolis Tech.

> **Related Docs:**
> - [Slash Commands Guide](../SLASH-COMMANDS.md) - Full guide to the slash command system
> - [Refactoring Checklist](./command-refactor-checklist.md) - Step-by-step checklist
> - [Template](../../src/commands/_template.ts.example) - Annotated example command

---

## Quick Start

Every command follows this structure:

```typescript
import { withStep, type CommandContext } from "../lib/cmdWrap.js";

export async function execute(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  // 1. Permission check (always first)
  if (!requireMinRole(interaction, ROLE_IDS.X, {...})) return;

  // 2. Route subcommands via switch
  switch (interaction.options.getSubcommand()) {
    case "foo": await handleFoo(ctx); break;
    case "bar": await handleBar(ctx); break;
    default: await interaction.reply({ content: "Unknown subcommand." });
  }
}

async function handleFoo(ctx: CommandContext<ChatInputCommandInteraction>) {
  const { interaction } = ctx;

  await withStep(ctx, "defer", async () => {
    await interaction.deferReply();
  });

  // ... logic wrapped in withStep ...

  await withStep(ctx, "reply", async () => {
    await interaction.editReply({ content: "Done!" });
  });
}
```

---

## Core Patterns

### 1. `withStep()` — Execution Tracing

Wrap logical phases for error tracing and debugging:

```typescript
await withStep(ctx, "phase_name", async () => {
  // Your logic here
});
```

**Common phase names:**
| Phase | When to use |
|-------|-------------|
| `defer_reply` | Deferring the interaction |
| `parse_options` | Extracting command options |
| `validate` | Input validation |
| `fetch_data` | Database reads, API calls |
| `process` | Business logic |
| `build_embed` | Building complex embeds |
| `reply` | Sending the response |
| `log_action` | Audit logging |

**Gotcha:** `withStep` always returns a Promise. Even for sync operations, use `await`:
```typescript
// Correct
const config = await withStep(ctx, "get_config", () => getConfig(guildId));

// Wrong - config will be a Promise
const config = withStep(ctx, "get_config", () => getConfig(guildId));
```

---

### 2. `withSql()` — Database Tracking

Wrap database operations for query logging and error context:

```typescript
const result = withSql(ctx, "SELECT * FROM users WHERE id = ?", () => {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
});
```

**Note:** `withSql` is synchronous (better-sqlite3 is sync). No `await` needed.

**Best practice:** SQL string should match the actual query:
```typescript
// Good
withSql(ctx, "INSERT INTO flags (user_id, reason)", () => {
  db.prepare("INSERT INTO flags (user_id, reason) VALUES (?, ?)").run(userId, reason);
});

// Bad - misleading SQL string
withSql(ctx, "add flag", () => {
  db.prepare("INSERT INTO flags...").run(...);
});
```

---

### 3. Permission Helpers

Choose the right helper for your use case:

| Helper | Use Case |
|--------|----------|
| `requireStaff(i)` | Any staff member |
| `requireMinRole(i, roleId, opts)` | Role or above (hierarchical) |
| `requireExactRoles(i, [roles], opts)` | Specific roles only |
| `requireGatekeeper(i, cmd, desc)` | Gatekeeper role |
| `requireArtist(i, cmd, desc)` | Artist or admin |
| `requireOwnerOnly(i, cmd, desc)` | Bot owner only |
| `requireAdminOrLeadership(i)` | Admin or leadership |

**Permission check placement:**
- Always at TOP of `execute()`, before routing
- Handler-level checks only for different permissions per subcommand

---

### 4. Response Patterns

**Quick operation (no defer):**
```typescript
await interaction.reply({
  content: "Done!",
  flags: MessageFlags.Ephemeral,
});
```

**Long operation (with defer):**
```typescript
await withStep(ctx, "defer_reply", async () => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
});

// ... long operation ...

await withStep(ctx, "reply", async () => {
  await interaction.editReply({ content: "Done!" });
});
```

**Rule of thumb:** Defer if operation might take >1 second.

---

### 5. Subcommand Groups

For nested commands like `/config set mod_roles`:

```typescript
const group = interaction.options.getSubcommandGroup(false);
const subcommand = interaction.options.getSubcommand();
const routeKey = group ? `${group}:${subcommand}` : subcommand;

switch (routeKey) {
  case "set:mod_roles":
    await handleSetModRoles(ctx);
    break;
  case "set:channels":
    await handleSetChannels(ctx);
    break;
  case "get":
    await handleGet(ctx);
    break;
  // ...
}
```

---

## Common Gotchas

### 1. Missing `await` on withStep

```typescript
// WRONG - ticketInfo is a Promise
const ticketInfo = withStep(ctx, "inspect_roles", () => {
  return inspectTicketRoles(member);
});

// CORRECT
const ticketInfo = await withStep(ctx, "inspect_roles", () => {
  return inspectTicketRoles(member);
});
```

### 2. Passing `interaction` instead of `ctx`

```typescript
// WRONG - loses instrumentation
switch (subcommand) {
  case "foo": await handleFoo(interaction); break;  // Bad!
}

// CORRECT
switch (subcommand) {
  case "foo": await handleFoo(ctx); break;  // Good!
}
```

### 3. Missing `break` in switch

```typescript
// WRONG - falls through to bar!
switch (subcommand) {
  case "foo":
    await handleFoo(ctx);
    // missing break!
  case "bar":
    await handleBar(ctx);
    break;
}

// CORRECT
switch (subcommand) {
  case "foo":
    await handleFoo(ctx);
    break;  // Always include break
  case "bar":
    await handleBar(ctx);
    break;
}
```

### 4. Permission check after routing

```typescript
// WRONG - unauthorized users see subcommand routing
export async function execute(ctx) {
  const { interaction } = ctx;
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "foo":
      if (!requireStaff(interaction)) return;  // Too late!
      await handleFoo(ctx);
      break;
  }
}

// CORRECT - check first, route second
export async function execute(ctx) {
  const { interaction } = ctx;

  if (!requireStaff(interaction)) return;  // Check first!

  switch (interaction.options.getSubcommand()) {
    case "foo":
      await handleFoo(ctx);
      break;
  }
}
```

---

## File Header Template

Every command file should have this header:

```typescript
/**
 * Pawtropolis Tech -- src/commands/{name}.ts
 * WHAT: Brief description of what this command does.
 * WHY: Why this command exists / what problem it solves.
 * FLOWS:
 *  - /{name} {subcommand} -> description
 *  - /{name} {subcommand2} -> description
 * DOCS:
 *  - https://relevant-link.com (optional)
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0
```

---

## Quick Checklist

Before submitting a command:

- [ ] File header with WHAT/WHY/FLOWS
- [ ] Permission check at TOP of execute()
- [ ] Switch statement for routing (not if/else)
- [ ] All cases have `break`
- [ ] Handlers receive `ctx` (not just `interaction`)
- [ ] All async operations wrapped in `withStep()`
- [ ] All DB operations wrapped in `withSql()`
- [ ] Long operations deferred
- [ ] Default case handles unknown subcommand
- [ ] `npm run check` passes
