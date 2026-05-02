# Discrepancy Matrix — Forward-Facing Documentation vs. Live Server

**Audit date:** 2026-05-02
**Source of truth:** [`live-server-snapshot.md`](live-server-snapshot.md) and the regenerated `docs/internal-info/*` (2026-05-02T14:07Z).
**Severity definitions:**
- **Critical** — could cause users to break rules, misunderstand moderation, access the wrong channel, or fail onboarding.
- **High** — incorrect role/channel/policy/bot command that affects normal use.
- **Medium** — outdated names, incomplete guidance, or confusing flow.
- **Low** — wording polish, minor stale references, formatting, or style.

---

## Section A — Role-name drift (high-leverage)

| ID | Area | Doc File | Existing Claim | Live Source of Truth | Severity | Required Fix | Status |
|---|---|---|---|---|---|---|---|
| A1 | Role hierarchy | `docs/PERMS-MATRIX.md:21` | "Server Owner" with ID `896070888779317254` | Live role `896070888779317254` is named **Community Founder** (Integration role, position 232, 1 member). The actual server owner is `wwerew0lf` (`958507309548584982`). | Critical | Rename the rank-1 row to "Community Founder" with note that this is the role currently held by the server owner. Mirror in `BOT-HANDBOOK.md:2326`. | Open |
| A2 | Role hierarchy | `docs/PERMS-MATRIX.md:30` | "Moderation Team" with ID `987662057069482024` | Live role `987662057069482024` is named **Community Staff** (position 214, 4 members per ticket-tool config; 19 members in ROLES.md count). | Critical | Rename "Moderation Team" → "Community Staff" everywhere it appears as a Discord role label. Mirror in `BOT-HANDBOOK.md:2335`, `BOT-HANDBOOK.md:605, 619`. | Open |
| A3 | Source code constants | `src/lib/roles.ts:73, 82` | `ROLE_NAMES[SERVER_OWNER] = "Server Owner"`, `ROLE_NAMES[MOD_TEAM] = "Moderation Team"` | These labels feed permission-denied embeds shown to staff. Live names are different. | High | Update display labels to "Community Founder" and "Community Staff". Code constant identifiers (`SERVER_OWNER`, `MOD_TEAM`) can stay; only the user-visible string should match the live role name. | Open |
| A4 | Permission-denied example | `docs/PERMS-MATRIX.md:309-311` | Lists "@Senior Moderator … @Server Owner" in a permission-denied example | Discord renders the actual role names, not the doc labels. After the A3 fix, this example needs to show "Community Founder" instead of "Server Owner". | Medium | Update example role list to live names. | Open |

## Section B — Permission gating drift

| ID | Area | Doc File | Existing Claim | Live Source of Truth | Severity | Required Fix | Status |
|---|---|---|---|---|---|---|---|
| B1 | `/audit` permissions | `docs/MOD-HANDBOOK.md:1143` | "Who can use it: Community Managers and Bot Developer only" | `src/commands/audit.ts:70-75` allows `ADMINISTRATOR`, `SENIOR_ADMIN`, `COMMUNITY_MANAGER`, `SERVER_DEV`. Floor is **Administrator**, not Community Manager. | High | Replace with "Administrator + Senior Administrator + Community Manager + Server Dev". | Open |
| B2 | `/audit` permissions | `docs/BOT-HANDBOOK.md:639` | "Community Managers and Bot Developer only (hardcoded role IDs)" | Same as B1. | High | Replace with the same Admin+/SA/CM/Server Dev list. Note the role IDs are imported from `ROLE_IDS`, not hardcoded in the audit command file. | Open |
| B3 | `/audit` permissions | `docs/BOT-HANDBOOK.md:2354` | "Community Manager+ … `/audit`" | Same as B1. | High | Move `/audit` from CM+ row to Admin+ row in the bucketed table. | Open |
| B4 | `/isitreal` permissions | `docs/MOD-HANDBOOK.md:1230` | "Who can use it: Staff (requires mod role)" | `PERMS-MATRIX.md:121-122` says JM+ specifically; `src/commands/isitreal.ts` confirms with `requireMinRole(JUNIOR_MOD)`. | Medium | Replace "Staff (requires mod role)" with "Junior Moderator and above". | Open |

## Section C — Staff-roles section incompleteness

| ID | Area | Doc File | Existing Claim | Live Source of Truth | Severity | Required Fix | Status |
|---|---|---|---|---|---|---|---|
| C1 | Staff Roles list | `docs/MOD-HANDBOOK.md:79-107` | Lists only Community Manager, Administrator, Senior Moderator, Moderator. | Live hierarchy and `PERMS-MATRIX.md` both include Junior Moderator, Gatekeeper, Community Development Lead, Senior Administrator, Community Founder (rank-1). | High | Add the missing roles in correct hierarchy order with a one-paragraph description each, drawn from existing tier-specific guides (`GATEKEEPER-GUIDE.md`, `LEADERSHIP-GUIDE.md`, etc.). | Open |
| C2 | Bot Owner section | `docs/MOD-HANDBOOK.md` (no section) | Bot Owner / Server Dev concept missing from the Staff Roles list. | `PERMS-MATRIX.md:38-44` documents these as bypass roles. | Medium | Add a short "Bypass Roles" subsection noting that Server Dev and Bot Owner exist outside the regular hierarchy and bypass all permission checks. | Open |

## Section D — Ticket Guide drift

| ID | Area | Doc File | Existing Claim | Live Source of Truth | Severity | Required Fix | Status |
|---|---|---|---|---|---|---|---|
| D1 | Ticket types | `docs/MOD-HANDBOOK.md:738-775` | Four types: General Support, User Report, Staff Report, Verified Artist Program. | `_recon/ticket-tool-config.json:1523-1591` shows the live panel (msg `1498047878268981349`) carries six buttons: **Support, Report User, Report Staff, VRChat World Bug Report, VRC Sticker Wall, Art Ticket Redeem**. A separate verified-artist panel (msg `1450238500632006667`) carries **2D Artist Verification, 3D Artist Verification, Music Creator Program, Fursuit Creator Program**. | High | Rewrite ticket types to match the two live panels. Move "Verified Artist Program" details into a dedicated "Artist Verification Tickets" subsection that reflects the four sub-programs. | Open |
| D2 | Ticket access labels | `docs/MOD-HANDBOOK.md:746-774` | "Access: Moderators and Senior Moderators" / "Access: Senior Moderators" / "Access: Community Managers only". | Live overwrites use the **Community Staff** role (`987662057069482024`) and **Community Ambassador** role (`896070888762535967`) on every ticket channel. Specific access tiers (e.g., who can view a Staff Report ticket) are governed by ticket-tool's panel config, not directly visible from channel overwrites. | Medium | Replace the per-type "Access" line with: "Access: handled by ticket panel; Community Staff and Community Ambassadors gain channel access automatically once a ticket is opened. Staff Reports route only to Community Manager and above." (verify the last clause via the panel config or by testing.) | Open |
| D3 | Ticket entry channel | `docs/MOD-HANDBOOK.md` | Implies tickets live in some staff channel. | Live ticket entry is `「📥」tickets` (`1103728856294236160`) inside `[3] City Hall`. | Low | Add a clarifying sentence at the top of the Ticket Guide that members open tickets via the panel in `「📥」tickets`. | Open |

## Section E — `MEMBER-REWARDS.md` role-ID mismatches

| ID | Area | Doc File | Existing Claim | Live Source of Truth | Severity | Required Fix | Status |
|---|---|---|---|---|---|---|---|
| E1 | Activity Rewards | `docs/MEMBER-REWARDS.md:50` | "Weekly Winner role (`973375865306120232`)" | `ROLES.md` shows ID `973375865306120232` is named **Fur of the Week**. No role named "Weekly Winner" exists in the live server. | Critical | Either (a) drop the explicit role-ID claim and refer readers to the live `「🔍」server-info` thread for current numbers, or (b) replace with the actual live role name "Fur of the Week". Option (a) is safer because the doc itself states "the forum wins" if it drifts; the forum text I captured does not enumerate weekly newsletter rewards by role. | Open |
| E2 | Activity Rewards | `docs/MEMBER-REWARDS.md:60, 65` | "Second-place role (`1371630364178645102`)" used for both 2nd and 3rd place | `ROLES.md` shows ID `1371630364178645102` is named **Chatter Fox**. No "Second-place" role exists. | Critical | Same fix as E1 — replace explicit role-ID claims with a pointer to the live forum. | Open |
| E3 | Newsletter channel | `docs/MEMBER-REWARDS.md` (implicit) / `_recon/handbook-audit/2026-05-02/server-info.md` City Hall thread | Live City Hall thread links to `1384461753370415125` as the newsletter / weekly activity rewards channel. | This channel ID is not present in the regenerated `CHANNELS.md` (249-channel inventory). It may be a thread under news, or it may have been deleted, or restricted from the audit bot's view. | Medium | Document the uncertainty; if forwarding, prefer the in-Discord link rather than a hard-coded channel name. | Open |
| E4 | "Server Shop & Economy" channel list | `docs/MEMBER-REWARDS.md:185` | Drop channels: `896070890457018384, 896070889798508599, 896070889462976610, 896070889462976608, 1121191510642274354, 896070889198731286` | All present in CHANNELS.md except `896070889198731286`. Live channel `「❓」qotd` is `896070889198731288` (different last digit). The doc's `…286` is likely a typo or a stale ID. | High | Verify by grepping CHANNELS.md for `…286`. If absent, drop or replace with `…288` (qotd). | Open |
| E5 | Byte token AllByte staff activation | `docs/MEMBER-REWARDS.md:111` | "global XP boosts are announced in `1381923831102574675`" | Channel ID `1381923831102574675` does not appear in `CHANNELS.md`. Likely deleted or restricted. The live server-info Reward System thread instead says AllBytes are "announced in `<#1381923831102574675>`" — same ID, same source. | Medium | Either drop the specific channel ID or note that AllByte announcements are posted to a global staff-managed announcement thread; verify by re-fetching with elevated bot perms. | Open |

## Section F — Channel rename / channel-ID checks across docs

| ID | Area | Doc File | Existing Claim | Live Source of Truth | Severity | Required Fix | Status |
|---|---|---|---|---|---|---|---|
| F1 | "Known Chat" channel | `docs/MEMBER-REWARDS.md:31` (LVL 30 row) | "Known Chat access in `1437291915979522078`" | Live `「⭐」known-chat` is `1488258803928404069`; `1437291915979522078` is not in CHANNELS.md. | High | Update the channel ID to the live one (`1488258803928404069`). | Open |
| F2 | Adult-content reference | `docs/MOD-HANDBOOK.md:465` | "Suggestive content, even when posted in `<#1446602187655610461>`" | Live `「✍️」writing` is `1446602187655610461`. Match. | None | No change needed; verified. | Verified |
| F3 | Roleplay redirect | `docs/MOD-HANDBOOK.md:531` | "<#1393507326865969152> exists for content that doesn't fit elsewhere" | Live `「🗣️」yapping-space` is `1393507326865969152`. Match. | None | No change needed; verified. | Verified |
| F4 | Movie tier role IDs | `docs/MOD-QUICKREF.md:54-57`, `docs/LEADERSHIP-GUIDE.md` (movie section), `docs/MEMBER-REWARDS.md:121-126` | `1388676461657063505`, `1388676662337736804`, `1388675577778802748`, `1388677466993987677` | All four IDs present and named "Tier 1/2/3/4" in `_recon/handbook-audit/2026-05-02/server-info.md`. | None | No change needed; verified. | Verified |
| F5 | First-responder role | `docs/PERMS-MATRIX.md` (none) / `docs/MEMBER-REWARDS.md` (none) | Not currently documented forward-facing. | Live: role `1488629735293452418` named **Thin Line**, granted via `/verify` (announced 2026-04-01). | Low | Optional — add a small note in `MEMBER-REWARDS.md` or a new "Honor roles" subsection explaining the `/verify` self-assign. | Open |

## Section G — Bot-embedded user-visible text in `src/`

| ID | Area | File | Existing Claim | Live Source of Truth | Severity | Required Fix | Status |
|---|---|---|---|---|---|---|---|
| G1 | Permission-denied label | `src/lib/roles.ts:82` | `[ROLE_IDS.MOD_TEAM]: "Moderation Team"` | Live role ID is named "Community Staff". | High | Update label to "Community Staff". (Code constant `MOD_TEAM` left alone.) | Open |
| G2 | Permission-denied label | `src/lib/roles.ts:73` | `[ROLE_IDS.SERVER_OWNER]: "Server Owner"` | Live role ID is named "Community Founder". | High | Update label to "Community Founder". | Open |
| G3 | Welcome embed footer | `src/features/welcome.ts:124` and `src/features/review/welcome.ts:160` | "Pawtropolis Moderation Team" | This is a generic staff-team brand label, not a role mention. The live server still uses the term informally. | None | No change. Footer is a branding label, not a role reference. | Verified |
| G4 | NSFW alert role fallback | `src/features/avatarNsfwMonitor.ts:31` | `NSFW_ALERT_ROLE_ID_FALLBACK = "987662057069482024"` (Community Staff) | Live ID matches. The constant name is `MOD_TEAM`-style but ID is correct. | None | No change. | Verified |
| G5 | Verify channel intro embed | live `「❓」verify` channel | "Welcome to Pawtropolis | Furry • LGBTQ+. Before you enjoy your stay, you must go through our verification system which you can start by clicking **Verify** and answering 6 simple questions." | Match — bot posted the message 2026-04-08. | None | No change. | Verified |

## Section H — `BOT-HANDBOOK.md` cross-references that should mirror PERMS-MATRIX changes

| ID | Area | Doc File | Existing Claim | Live Source of Truth | Severity | Required Fix | Status |
|---|---|---|---|---|---|---|---|
| H1 | Hierarchy table | `docs/BOT-HANDBOOK.md:2326-2335` | Same hierarchy with "Server Owner" (rank 1) and "Moderation Team" (rank 10) | Same as A1, A2 — mismatch with live role names. | Critical | Update both labels to match live names. | Open |
| H2 | "Senior Mod+" inclusion list | `docs/BOT-HANDBOOK.md:2359-2367` | Lists "Server Owner" and assumes the rank-1 label | Live: "Community Founder". | Medium | Replace "Server Owner" → "Community Founder". | Open |
| H3 | `/report` description | `docs/BOT-HANDBOOK.md:605, 619` | "Automatically pings the Moderation Team" | Code mentions the role via ID; the live render shows "Community Staff". | Medium | "Automatically pings the Community Staff role" (or simply "the staff team"). | Open |

## Section I — `index.md` and `README.md` cross-checks

| ID | Area | Doc File | Existing Claim | Live Source of Truth | Severity | Required Fix | Status |
|---|---|---|---|---|---|---|---|
| I1 | Repo README — initial setup | `README.md:142-148` | Sample `/gate setup` command uses `gate_channel:#gate accepted_role:@Verified` | Live verification channel is `「❓」verify` (`896070891539169311`); the role granted on accept is **Community** (`140` in ROLES.md hierarchy, position 140, 6,764 members), not "Verified". | High | Replace `#gate` with `#verify` and `@Verified` with `@Community` to reflect the actual live setup that this guild's `/gate setup` would use. (For other servers, the example values are placeholders, but on the canonical server they should match what staff actually run.) | Open |
| I2 | Repo README — Required Env Vars | `README.md:122-125` | "DISCORD_TOKEN", "CLIENT_ID" | Match `.env.example` and live `.env`. | None | No change. | Verified |
| I3 | `docs/index.md` — Quick Reference | `docs/index.md:18` | "Server: ubuntu@34.193.75.138 (SSH alias bash-ec2)" | Per memory, this is the current Pawtropolis EC2 (Elastic IP `34.193.75.138`). Match. | None | No change. | Verified |
| I4 | Member Guides link | `docs/index.md:37` | "Member Rewards … Level rewards, weekly newsletter winners, credit system, Byte tokens, movie-night tiers, shop/economy" | Description is accurate to the live source-info forum (covers level rewards, byte tokens, movie tiers, shop/economy). The "weekly newsletter winners" line carries the same drift as MEMBER-REWARDS §E. | Low | Edit the description if MEMBER-REWARDS resolves §E by removing the weekly-newsletter section; otherwise leave. | Open |

## Section J — Modmail-guide and reference docs

| ID | Area | Doc File | Existing Claim | Live Source of Truth | Severity | Required Fix | Status |
|---|---|---|---|---|---|---|---|
| J1 | Modmail Guide | `docs/how-to/modmail-guide.md:84-86` | "You need one of: Manage Guild permission OR Reviewer Role" | Live gating per `src/features/modmail.ts` may differ; need to read source to confirm. PERMS-MATRIX shows modmail context-menu is registered but does not enumerate gating directly. | Medium | Read modmail source, verify gating, update guide if needed. | Open (verify) |
| J2 | Modmail thread location | `docs/how-to/modmail-guide.md:5-12` | "Private threads in the review channel" | Code likely creates private threads in the modmail-log channel configured via `/config set modmail_log_channel`. | Low | Sentence-level rewrite to clarify that the location is configurable and on this guild lives in the staff-only modmail-logs channel. | Open |
| J3 | Reference: gate-review-flow | `docs/reference/gate-review-flow.md` (not yet read) | TBD | Live gate flow: 6-question modal in `「❓」verify`. | TBD | Read and verify. | Open (read) |
| J4 | Reference: send-command | `docs/reference/send-command.md` (not yet read) | TBD | `/send` requires ManageMessages per PERMS-MATRIX. | TBD | Read and verify. | Open (read) |
| J5 | Reference: logging-and-modstats | `docs/reference/logging-and-modstats.md` (not yet read) | TBD | TBD | TBD | Read and verify. | Open (read) |
| J6 | Reference: modmail-system | `docs/reference/modmail-system.md` (not yet read) | TBD | TBD | TBD | Read and verify. | Open (read) |
| J7 | Reference: slash-commands | `docs/reference/slash-commands.md` (not yet read) | TBD | TBD | TBD | Read and verify. | Open (read) |

---

## Items intentionally out of scope

- `docs/internal-info/*` — internal evidence, not forward-facing. Used as the source of truth here; not edited from the audit.
- `docs/audits/**` and `docs/_archive/**` — historical / not forward-facing.
- `docs/audit-security-flow.md`, `docs/INCIDENTS.md`, `docs/DEVNOTES.md`, `docs/api-contracts.md`, `docs/data-models.md`, `docs/source-tree-analysis.md`, `docs/development-guide.md`, `docs/operations/**`, `docs/architecture*.md`, `docs/roadmap/**` — engineering-only documentation.
- `CHANGELOG.md`, `TODO.md`, `CREDENTIALS.md`, `finances.md` — release log / private notes.

## Items where I will NOT silently change content

- Specific channel IDs that are live and used unchanged (per F2, F3, F4).
- The "Pawtropolis Moderation Team" branding string in welcome embeds (G3) — this is a friendly umbrella label, not a Discord role reference.
- Code constants `ROLE_IDS.SERVER_OWNER` and `ROLE_IDS.MOD_TEAM` (only the rendered display labels in `ROLE_NAMES` are updated).

---

*Status legend:* Open = needs patching. Verified = no change required. Open (verify) / Open (read) = additional inspection needed during Phase 3 before patching.
