# Dashboard API security model

The dashboard API (`src/web/dashboardApi.ts`) is the bot's second mutation surface — it lets the web dashboard at pawtropolis.tech proxy review actions, modmail messages, QOTD lifecycle, art job updates, and config changes through the same Discord client the slash commands use.

This doc explains the auth model, the trust boundary, and the rules each route enforces.

## Trust boundary

The Fastify server runs on `127.0.0.1:DASHBOARD_API_PORT` (default `3003`). Nginx in front of the dashboard proxies dashboard-issued requests to this port. The bot does not trust the dashboard wholesale; it re-validates the caller and the action on every request.

Three things must line up for a write to succeed:

1. **Header secret** — `X-Dashboard-Secret` must equal `DASHBOARD_API_SECRET` from the bot's environment. Enforced by a Fastify `onRequest` hook before any route handler runs.
2. **Caller tier** — the request body must contain a `tier` string the bot accepts (see `TIER_ORDER` in `src/web/dashboardAuth.ts`). The dashboard derives this from the user's Discord roles via the OAuth session.
3. **Per-route authority** — each route calls `hasMinTier(tier, minTier)` with its own minimum. Routes that touch resolved applications also check claim ownership; admin-tier callers can override.

If any of those three fails the bot returns 401 / 403 / 409 without performing the side effect.

## Tier hierarchy

`TIER_ORDER` in `src/web/dashboardAuth.ts` is the canonical ordering, lowest index = highest authority:

```
owner > cm > cdl > sa > admin > sm > mod > jm > gk > viewer > none
```

Failure modes the comparator must cover (asserted by `tests/web/dashboardAuth.test.ts`):

- Owner outranks every named tier.
- `gk` cannot run admin operations.
- `viewer` cannot run any write operation.
- Unknown user-tier strings (e.g. `"hacker"`) fail closed.
- Unknown min-tier strings fail closed.
- `null`, `undefined`, empty string all fail closed.

`hasMinTier` is the only place tier comparisons happen. Adding a new tier means updating `TIER_ORDER` and the docs here.

## Per-route authority

| Route | Min tier | Notes |
|------|----------|-------|
| `POST /api/review/claim` | `gk` | also blocks if applicant is permanently_rejected |
| `POST /api/review/unclaim` | `gk` | claim-owner OR admin override |
| `POST /api/review/approve` | `gk` | claim-ownership check |
| `POST /api/review/reject` | `gk` | claim-ownership check |
| `POST /api/review/wrong_password` | `gk` | claim-ownership check; reject preset reason |
| `POST /api/review/stale_modmail` | `gk` | claim-ownership check; reject preset reason |
| `POST /api/review/kick` | `gk` | claim-ownership check; reason required |
| `POST /api/review/permreject` | `admin` | reason required; sets permanently_rejected |
| `POST /api/review/vote_out` | `gk` | one vote per gk; threshold from guild config |
| `POST /api/users/resolve` | `gk` | max 50 IDs per request |
| `POST /api/review/profile` | `gk` | reads Discord profile data |
| `POST /api/modmail/send` | `gk` | content cap 2000 chars |
| `POST /api/modmail/open` | `gk` | rejects if user already has open ticket |
| `POST /api/modmail/close` | `gk` | |
| `POST /api/modmail/reopen` | `gk` | |
| `POST /api/qotd/*` | (varies by route — see source) | |
| `POST /api/config/*` | (varies; some require admin) | |

Authoritative list lives in `src/web/dashboardApi.ts`. This table is a tour; if the two ever diverge, treat the source as the source of truth and update the doc.

## Claim ownership rules

For applications that are claimed (`review_claim` row exists for the appId):

- Approve, reject (any variant), kick: caller must be the claim owner.
- Unclaim: caller must be the claim owner OR have `admin` tier.
- Vote out: claim ownership is NOT required — any GK can vote regardless of who claimed.

The admin override on unclaim bypasses `unclaimTx` (which has its own ownership check) and writes the audit row directly with `meta = { type: "admin_override", previousClaimer: <id> }`. This pattern is intentional: it preserves audit fidelity while letting an admin recover from an absent reviewer.

## Body validation

Every route that takes mutation parameters validates them. The standard pattern:

```ts
const { userId, tier, appId } = request.body ?? {};
if (!userId || !tier || !appId) {
  return reply.code(400).send({ success: false, error: "Missing userId, tier, or appId" });
}
```

The `missingStringFields` and `missingIntegerFields` helpers in `dashboardAuth.ts` express this contract for tests. Each route currently inlines the check; if the patterns ever diverge from the helpers, adopt the helper or update the helper to match — they should not stay subtly different.

## What the dashboard cannot do

- It cannot modify guild_config values that fail validation in `lib/configValidation.ts`.
- It cannot grant the Owner tier to itself (the OAuth session derives tier from real Discord roles).
- It cannot bypass tier enforcement by passing an unknown tier string — `hasMinTier` returns false for anything outside `TIER_ORDER`.
- It cannot run actions on resolved applications (the underlying transaction enforces terminal-state rejections regardless of HTTP authorization).

## Failure semantics

- Missing or wrong `X-Dashboard-Secret` → 401, no telemetry on the request body.
- Missing required body field → 400 with the specific missing field listed.
- Insufficient tier → 403.
- Stale state (already claimed by someone else, terminal status, etc.) → 409.
- Application or thread not found → 404.
- Unhandled error → 500 with no stack trace; full error logged with `evt: dashboardApi`.

The 207 status appears for partial success — for example, an approve that records the DB transition and audit row but fails to grant the accepted role on Discord. The dashboard renders that as a warning so a human can grant the role manually.
