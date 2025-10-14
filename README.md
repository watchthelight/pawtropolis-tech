# Pawtropolis Tech Gatekeeper

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A transparent, server-owned Discord gatekeeping bot: pinned application, staff review actions, modmail bridge, and clean audit logs.

**Maintainer:** watchthelight (Bash) • admin@watchthelight.org • Discord: `watchthelight`
**License:** MIT © 2025 watchthelight (Bash)

## Contact

- Issues: https://github.com/watchthelight/pawtropolis-tech/issues
- Email: admin@watchthelight.org
- Discord: `watchthelight`

## Database

SQLite is used for durability and simple ops.

```bash
npm run db:migrate   # apply SQL migrations in ./migrations
npm run db:seed      # insert TEST guild config + question set
```

Seed uses environment variables:

- `TEST_GUILD_ID` (default 1427677679280324730)
- `TEST_REVIEWER_ROLE_ID` (default 896070888749940774)
- `DB_PATH` (default ./data/data.db)
