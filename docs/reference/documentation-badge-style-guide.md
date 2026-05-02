# Documentation Badge Style Guide

Use this guide whenever a doc would otherwise contain a raw Discord mention.

## Rules of thumb

1. Replace `<@&id>`, `<#id>`, and `<@id>` with a registered badge image.
2. Alt text is the badge label a sighted reader would expect, prefixed with
   `@` for roles or users and `#` for channels. Example:
   `![@Server Artist](https://status.pawtropolis.tech/badges/role-server-artist.svg)`.
3. Use the registry id, never the raw Discord ID. Registry ids are stable;
   Discord IDs are not human-friendly.
4. Code blocks that demonstrate Discord mention syntax are exempt because
   they teach the syntax; the docs guard test ignores fenced code blocks.
5. Avoid em-dashes in surrounding prose; use a colon or restructure.

## Patterns

### Role pill

```markdown
![@Director's Cut](https://status.pawtropolis.tech/badges/movie-tier-3.svg)
```

### Channel pill

```markdown
![#「✍️」writing](https://status.pawtropolis.tech/badges/channel-writing.svg)
```

### Pill with suffix (rendered inline by the SVG)

The suffix lives inside the badge itself; do not duplicate it in the alt
text body of the doc unless the visual context needs it.

### Linked badges

GitHub does not let SVG `<a>` tags link out, so wrap the image in a
Markdown link:

```markdown
[![#「✍️」writing](https://status.pawtropolis.tech/badges/channel-writing.svg)](https://discord.com/channels/<GUILD_ID>/<CHANNEL_ID>)
```

Only do this when a click target is genuinely useful; otherwise the bare
image is enough.

## Allowlist policy

The docs guard test (`tests/docs/badgeDocsIntegration.test.ts`) refuses raw
mention syntax outside fenced code blocks. The allowlist exists for:
- Dated audit snapshots that must preserve historical IDs.
- The badge documentation itself, which shows raw syntax in prose to
  explain why we have this system.

Do not extend the allowlist for new pages. Add a registry entry instead.
