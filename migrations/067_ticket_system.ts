/**
 * Migration 067: First-party ticket system schema
 * WHAT:
 *   - Adds 7 tables backing a custom Discord ticket system that replaces
 *     the third-party Ticket Tool bot:
 *       * ticket_type        — type registry (10 seeded types: support, reports,
 *                              vrc-*, art-redeem, verification programs)
 *       * ticket_counter     — per-type monotonic number allocator, seeded to
 *                              continue from current Ticket Tool channel numbers
 *       * ticket             — one row per opened ticket (ours OR legacy ghost)
 *       * ticket_event       — append-only audit trail powering dashboard timeline
 *       * ticket_message     — transcript capture (main channel + staff thread)
 *       * ticket_attachment  — local-disk mirror of Discord attachments
 *   - Adds optional ticket_id FK column to art_job so the queue/redeemreward
 *     flow can link work-in-progress to its ticket without breaking legacy rows.
 *
 * WHY: Current /redeemreward emits a literal "$add <@artistId>" message to
 *      puppet Ticket Tool's roster. Channel naming, permission overwrites, and
 *      transcripts are owned by a third-party bot. Owning the surface ourselves
 *      lets us auto-rename art channels with the current artist, surface tickets
 *      on the web dashboard, and remove the puppet hack.
 *
 * SAFETY: Idempotent. CREATE TABLE IF NOT EXISTS guards every table; columnExists
 *         guards the ALTER TABLE on art_job. Re-running is a no-op. The existing
 *         26 Ticket Tool channels are NOT touched — they remain unmanaged by us
 *         and continue to function via the legacy $add path. /redeemreward
 *         branches on whether a `ticket` row exists for the channel.
 *
 * SEED DATA: 10 ticket_type rows + matching ticket_counter rows. Counter
 *            current_value reflects the most-recently-issued number under
 *            Ticket Tool, so the next allocation increments to the next slot
 *            (e.g. support=1098 means our first new support ticket is support-1099).
 */

import type { Database } from "better-sqlite3";
import { logger } from "../src/lib/logger.js";
import { columnExists, recordMigration, tableExists } from "./lib/helpers.js";

const TICKETS_PANEL_GREEN = 0x388e3c;
const VERIFICATION_PANEL_PINK = 0xff7eec;

const COMMUNITY_AMBASSADOR_ROLE_ID = "896070888762535967";
const COMMUNITY_STAFF_ROLE_ID = "987662057069482024";

const STD_OPENER_ALLOW = ["ViewChannel", "SendMessages", "EmbedLinks", "AttachFiles", "ReadMessageHistory"];
const STD_OPENER_DENY = ["ManageMessages"];

function permTemplate(roleAllow: string[]): string {
  return JSON.stringify({
    everyone_deny: ["ViewChannel"],
    roles: roleAllow.map((id) => ({ id, allow: ["ViewChannel", "SendMessages"] })),
    opener_allow: STD_OPENER_ALLOW,
    opener_deny: STD_OPENER_DENY,
  });
}

const PERM_AMBASSADOR_ONLY = permTemplate([COMMUNITY_AMBASSADOR_ROLE_ID]);
const PERM_BOTH_STAFF = permTemplate([COMMUNITY_AMBASSADOR_ROLE_ID, COMMUNITY_STAFF_ROLE_ID]);
const PERM_MOD_TEAM_ONLY = permTemplate([COMMUNITY_STAFF_ROLE_ID]);
const PERM_BARE = JSON.stringify({
  everyone_deny: ["ViewChannel"],
  roles: [],
  opener_allow: STD_OPENER_ALLOW,
  opener_deny: [],
});

function emojiCustom(name: string, id: string, animated = false): string {
  return JSON.stringify({ name, id, animated });
}
function emojiUnicode(glyph: string): string {
  return JSON.stringify({ name: glyph });
}

interface SeedRow {
  key: string;
  label: string;
  panel_stack: "tickets" | "verification";
  panel_position: number;
  button_emoji: string;
  button_style: 1 | 2 | 3 | 4;
  embed_color: number;
  num_counter_key: string;
  channel_name_template: string;
  greeting_md: string;
  ping_role_ids: string;
  perm_template_json: string;
  has_staff_thread: 0 | 1;
  counter_init: number;
}

const GREETING_SUPPORT = `**Welcome to our support section!**

Please explain your need of support. A representative will be here shortly.`;

const GREETING_REPORT = `**Welcome to the report area!**

Please provide the User ID of the user, and any related proof.

__How do I get a User ID?__
https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID`;

const GREETING_VRC_BUG = `**Welcome! Please describe the VRChat World bug you encountered.**

Include:
- Where the bug occurs (location / area / coordinates if known)
- Steps to reproduce
- Screenshots or video if possible`;

const GREETING_VRC_STICKER = `This ticket is for our sticker wall in the VRChat World. **[Sticker Wall Example](https://imgur.com/a/LJIUXL4)**.

\`Requirements:\`
- Has to be a transparent image
- Accepted File Types: Png, Jpg, Jpeg
- Has to be a direct cutout of the image (can't have pixels in the corner or bottom of the image).`;

const GREETING_ART_REDEEM = `Hey community member. Thank you for being part of this community, and as a thank you, you've earned your art ticket.

In order to redeem it, please follow the requirements below, and a representative will set you up!

- Your ref sheet (That **YOU** own)
- Any provided artwork MUST be SFW
- Your reward type (headshot / half-body / full-body / emoji)`;

const GREETING_2D_ARTIST = `**Welcome to the Verified Artist Program.**

Please send the following requirements and a member of our team will verify your work:
- WIPs / Layers from previous work
- Be able to provide speedpaints
- Need a commissions page or related info
- Have more than 6 months of experience
- Have to be a current artist that actively does commissions`;

const GREETING_3D_ARTIST = `**3D Verified Artist Program**

Dedicated program for skilled 3D artists creating avatars or models.

\`Requirements:\`
- Full Blender / Maya / ZBrush / etc. scene file (.blend, .fbx with history, .zpr) showing dated modification timestamps and logical layer / outliner organization
- Recorded sculpting / modeling timelapse or screen capture (minimum 1 minute; sped up acceptable if raw file provided)
- For prints: photograph of the physical print-proof next to a handwritten note with current date + client's username or reference
- Viewport wireframe + UV layout screenshots at multiple stages`;

const GREETING_MUSIC = `**Music Creation Program**

A program for musicians and sound designers to earn a verified role and showcase tracks, SFX, or custom music to the community.

\`Requirements:\`
- DAW project file (.flp, .als, .logicx, .band) with dated tracks and visible workflow
- Screen-recorded session of at least 45 seconds showing arrangement from empty project or clear continuation
- Stem export pack matching the final mix
- Photo of MIDI controller / keyboard setup with handwritten date + client name visible in frame`;

const GREETING_FURSUIT = `**Fursuit Commissions Program**

Verification for legit fursuit makers, giving a special role and dedicated channels to safely advertise full suits, parts, premades, and services.

\`Requirements:\`
- Dated duct-tape dummy (DTD) photos with measuring tape and client measurements written on tape
- In-progress photos of carving foam, fur cutting layout, resin casting, or sewing at multiple stages with handwritten date + client name in every photo
- Video walkthrough of finished suit / prop with clear lighting (minimum 20 seconds)
- Shipping tracking number + proof of insurance for items over $500`;

const SEED_ROWS: SeedRow[] = [
  // ─── Tickets stack ─────────────────────────────────────────────
  {
    key: "support",
    label: "Support",
    panel_stack: "tickets",
    panel_position: 0,
    button_emoji: emojiCustom("uufaq", "1233580984746770504", true),
    button_style: 2, // gray
    embed_color: TICKETS_PANEL_GREEN,
    num_counter_key: "support",
    channel_name_template: "support-{num:0000}",
    greeting_md: GREETING_SUPPORT,
    ping_role_ids: JSON.stringify([COMMUNITY_AMBASSADOR_ROLE_ID]),
    perm_template_json: PERM_BOTH_STAFF,
    has_staff_thread: 1,
    counter_init: 1098,
  },
  {
    key: "report-user",
    label: "Report User",
    panel_stack: "tickets",
    panel_position: 1,
    button_emoji: emojiCustom("IIsocialwarning", "1279843058854400021"),
    button_style: 1, // blue
    embed_color: TICKETS_PANEL_GREEN,
    num_counter_key: "report-user",
    channel_name_template: "user-{num:0000}",
    greeting_md: GREETING_REPORT,
    ping_role_ids: JSON.stringify([COMMUNITY_STAFF_ROLE_ID]),
    perm_template_json: PERM_MOD_TEAM_ONLY,
    has_staff_thread: 1,
    counter_init: 524,
  },
  {
    key: "report-staff",
    label: "Report Staff",
    panel_stack: "tickets",
    panel_position: 2,
    button_emoji: emojiCustom("z_report", "1244329866015539312"),
    button_style: 4, // red
    embed_color: TICKETS_PANEL_GREEN,
    num_counter_key: "report-staff",
    channel_name_template: "staff-{num:0000}",
    greeting_md: GREETING_REPORT,
    ping_role_ids: JSON.stringify([COMMUNITY_STAFF_ROLE_ID]),
    perm_template_json: PERM_MOD_TEAM_ONLY,
    has_staff_thread: 1,
    counter_init: 23,
  },
  {
    key: "vrc-bug",
    label: "VRChat World Bug Report",
    panel_stack: "tickets",
    panel_position: 3,
    button_emoji: emojiCustom("4r_sharkpuppysitnew", "1405472414078599268"),
    button_style: 3, // green
    embed_color: TICKETS_PANEL_GREEN,
    num_counter_key: "vrc-bug",
    channel_name_template: "vrc-bug-{num:0000}",
    greeting_md: GREETING_VRC_BUG,
    ping_role_ids: JSON.stringify([COMMUNITY_AMBASSADOR_ROLE_ID]),
    perm_template_json: PERM_AMBASSADOR_ONLY,
    has_staff_thread: 1,
    counter_init: 0,
  },
  {
    key: "vrc-sticker",
    label: "VRC Sticker Wall",
    panel_stack: "tickets",
    panel_position: 4,
    button_emoji: emojiCustom("Paw_Mod", "1460401261437390949"),
    button_style: 3, // green
    embed_color: TICKETS_PANEL_GREEN,
    num_counter_key: "vrc-sticker",
    channel_name_template: "stickerwall-{num:0000}",
    greeting_md: GREETING_VRC_STICKER,
    ping_role_ids: JSON.stringify([COMMUNITY_AMBASSADOR_ROLE_ID]),
    perm_template_json: PERM_BARE,
    has_staff_thread: 1,
    counter_init: 12,
  },
  {
    key: "art-redeem",
    label: "Art Ticket Redeem",
    panel_stack: "tickets",
    panel_position: 5,
    button_emoji: emojiUnicode("🎨"),
    button_style: 3, // green
    embed_color: TICKETS_PANEL_GREEN,
    num_counter_key: "art-redeem",
    channel_name_template: "art-{num:0000}-{artist?}",
    greeting_md: GREETING_ART_REDEEM,
    ping_role_ids: JSON.stringify([COMMUNITY_AMBASSADOR_ROLE_ID]),
    perm_template_json: PERM_AMBASSADOR_ONLY,
    has_staff_thread: 1,
    counter_init: 3,
  },

  // ─── Verification stack ────────────────────────────────────────
  {
    key: "2d-artist",
    label: "2D Artist Verification",
    panel_stack: "verification",
    panel_position: 0,
    button_emoji: emojiUnicode("🎨"),
    button_style: 1, // blue
    embed_color: VERIFICATION_PANEL_PINK,
    num_counter_key: "2d-artist",
    channel_name_template: "2d-artist-{num:0000}",
    greeting_md: GREETING_2D_ARTIST,
    ping_role_ids: JSON.stringify([COMMUNITY_AMBASSADOR_ROLE_ID]),
    perm_template_json: PERM_AMBASSADOR_ONLY,
    has_staff_thread: 1,
    counter_init: 144,
  },
  {
    key: "3d-artist",
    label: "3D Artist Verification",
    panel_stack: "verification",
    panel_position: 1,
    button_emoji: emojiUnicode("🐴"),
    button_style: 1, // blue
    embed_color: VERIFICATION_PANEL_PINK,
    num_counter_key: "3d-artist",
    channel_name_template: "3d-artist-{num:0000}",
    greeting_md: GREETING_3D_ARTIST,
    ping_role_ids: JSON.stringify([COMMUNITY_AMBASSADOR_ROLE_ID]),
    perm_template_json: PERM_AMBASSADOR_ONLY,
    has_staff_thread: 1,
    counter_init: 0,
  },
  {
    key: "music-creator",
    label: "Music Creator Program",
    panel_stack: "verification",
    panel_position: 2,
    button_emoji: emojiUnicode("🎹"),
    button_style: 1, // blue
    embed_color: VERIFICATION_PANEL_PINK,
    num_counter_key: "music-creator",
    channel_name_template: "music-{num:0000}",
    greeting_md: GREETING_MUSIC,
    ping_role_ids: JSON.stringify([COMMUNITY_AMBASSADOR_ROLE_ID]),
    perm_template_json: PERM_AMBASSADOR_ONLY,
    has_staff_thread: 1,
    counter_init: 0,
  },
  {
    key: "fursuit-creator",
    label: "Fursuit Creator Program",
    panel_stack: "verification",
    panel_position: 3,
    button_emoji: emojiUnicode("🧶"),
    button_style: 1, // blue
    embed_color: VERIFICATION_PANEL_PINK,
    num_counter_key: "fursuit-creator",
    channel_name_template: "fursuit-{num:0000}",
    greeting_md: GREETING_FURSUIT,
    ping_role_ids: JSON.stringify([COMMUNITY_AMBASSADOR_ROLE_ID]),
    perm_template_json: PERM_AMBASSADOR_ONLY,
    has_staff_thread: 1,
    counter_init: 0,
  },
];

export function migrate067TicketSystem(db: Database): void {
  logger.info("[migration 067] Starting: ticket system schema");

  // 0. Drop orphan `ticket` table if empty.
  // Older modmail precursor with schema (app_id, guild_id, number, thread_id, created_at).
  // Superseded by `modmail_ticket`; no code references it. Halt if non-empty so an
  // operator investigates rather than silently destroying data.
  if (tableExists(db, "ticket")) {
    const ticketCols = db.pragma("table_info(ticket)") as Array<{ name: string }>;
    const isOrphan =
      ticketCols.some((c) => c.name === "app_id") &&
      !ticketCols.some((c) => c.name === "type_key");
    if (isOrphan) {
      const row = db.prepare(`SELECT COUNT(*) AS c FROM ticket`).get() as { c: number };
      if (row.c > 0) {
        throw new Error(
          `[migration 067] Found unexpected data in legacy 'ticket' table (${row.c} rows). ` +
            `This table is the older modmail precursor and was expected to be empty. ` +
            `Aborting to avoid data loss — investigate before retrying.`
        );
      }
      db.exec(`DROP TABLE ticket`);
      logger.info("[migration 067] Dropped empty orphan 'ticket' table (legacy modmail precursor)");
    }
  }

  // 1. ticket_type — type registry
  if (!tableExists(db, "ticket_type")) {
    db.exec(`
      CREATE TABLE ticket_type (
        key                    TEXT PRIMARY KEY,
        label                  TEXT NOT NULL,
        panel_stack            TEXT NOT NULL,
        panel_position         INTEGER NOT NULL,
        button_emoji           TEXT,
        button_style           INTEGER NOT NULL,
        embed_color            INTEGER NOT NULL,
        num_counter_key        TEXT NOT NULL,
        channel_name_template  TEXT NOT NULL,
        greeting_md            TEXT NOT NULL,
        ping_role_ids          TEXT NOT NULL,
        perm_template_json     TEXT NOT NULL,
        has_staff_thread       INTEGER NOT NULL DEFAULT 1,
        is_active              INTEGER NOT NULL DEFAULT 1,
        created_at             INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at             INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    logger.info("[migration 067] Created table ticket_type");
  }

  // 2. ticket_counter — per-type monotonic allocator
  if (!tableExists(db, "ticket_counter")) {
    db.exec(`
      CREATE TABLE ticket_counter (
        key            TEXT PRIMARY KEY,
        current_value  INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    logger.info("[migration 067] Created table ticket_counter");
  }

  // 3. ticket — one row per opened ticket
  if (!tableExists(db, "ticket")) {
    db.exec(`
      CREATE TABLE ticket (
        id                    TEXT PRIMARY KEY,
        type_key              TEXT NOT NULL REFERENCES ticket_type(key),
        number                INTEGER NOT NULL,
        channel_id            TEXT NOT NULL UNIQUE,
        staff_thread_id       TEXT,
        guild_id              TEXT NOT NULL,
        opener_user_id        TEXT NOT NULL,
        claimed_by_user_id    TEXT,
        status                TEXT NOT NULL,
        close_reason          TEXT,
        closed_by_user_id     TEXT,
        archive_path          TEXT,
        legacy_source         TEXT,
        opened_at             INTEGER NOT NULL,
        claimed_at            INTEGER,
        closed_at             INTEGER,
        UNIQUE (type_key, number)
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ticket_status ON ticket(status)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ticket_channel ON ticket(channel_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ticket_opener ON ticket(opener_user_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_ticket_claimer ON ticket(claimed_by_user_id)`);
    logger.info("[migration 067] Created table ticket + indexes");
  }

  // 4. ticket_event — append-only audit log
  if (!tableExists(db, "ticket_event")) {
    db.exec(`
      CREATE TABLE ticket_event (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id       TEXT NOT NULL REFERENCES ticket(id),
        event_type      TEXT NOT NULL,
        actor_user_id   TEXT,
        payload_json    TEXT,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_event_ticket ON ticket_event(ticket_id, created_at)`);
    logger.info("[migration 067] Created table ticket_event + index");
  }

  // 5. ticket_message — transcript
  if (!tableExists(db, "ticket_message")) {
    db.exec(`
      CREATE TABLE ticket_message (
        id                     TEXT PRIMARY KEY,
        ticket_id              TEXT NOT NULL REFERENCES ticket(id),
        in_thread              INTEGER NOT NULL DEFAULT 0,
        author_user_id         TEXT NOT NULL,
        author_is_bot          INTEGER NOT NULL,
        content                TEXT,
        embeds_json            TEXT,
        reply_to_message_id    TEXT,
        created_at             INTEGER NOT NULL,
        edited_at              INTEGER,
        deleted_at             INTEGER
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_msg_ticket ON ticket_message(ticket_id, created_at)`);
    logger.info("[migration 067] Created table ticket_message + index");
  }

  // 6. ticket_attachment — local-disk mirror
  if (!tableExists(db, "ticket_attachment")) {
    db.exec(`
      CREATE TABLE ticket_attachment (
        id              TEXT PRIMARY KEY,
        message_id      TEXT NOT NULL REFERENCES ticket_message(id),
        ticket_id       TEXT NOT NULL REFERENCES ticket(id),
        filename        TEXT NOT NULL,
        mime            TEXT,
        size_bytes      INTEGER NOT NULL,
        local_path      TEXT,
        sha256          TEXT,
        original_url    TEXT NOT NULL,
        created_at      INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_attach_ticket ON ticket_attachment(ticket_id)`);
    logger.info("[migration 067] Created table ticket_attachment + index");
  }

  // 7. art_job.ticket_id FK — nullable so legacy rows untouched
  if (!columnExists(db, "art_job", "ticket_id")) {
    db.exec(`ALTER TABLE art_job ADD COLUMN ticket_id TEXT REFERENCES ticket(id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_art_job_ticket ON art_job(ticket_id)`);
    logger.info("[migration 067] Added art_job.ticket_id + index");
  }

  // 8. Seed ticket_type rows (idempotent: INSERT OR IGNORE; later edits via separate migration)
  const upsertType = db.prepare(`
    INSERT INTO ticket_type (
      key, label, panel_stack, panel_position, button_emoji, button_style,
      embed_color, num_counter_key, channel_name_template, greeting_md,
      ping_role_ids, perm_template_json, has_staff_thread, is_active,
      created_at, updated_at
    ) VALUES (
      @key, @label, @panel_stack, @panel_position, @button_emoji, @button_style,
      @embed_color, @num_counter_key, @channel_name_template, @greeting_md,
      @ping_role_ids, @perm_template_json, @has_staff_thread, 1,
      unixepoch(), unixepoch()
    )
    ON CONFLICT(key) DO NOTHING
  `);
  const upsertCounter = db.prepare(`
    INSERT INTO ticket_counter (key, current_value, updated_at)
    VALUES (?, ?, unixepoch())
    ON CONFLICT(key) DO NOTHING
  `);

  let typeInserts = 0;
  let counterInserts = 0;
  for (const row of SEED_ROWS) {
    const r = upsertType.run({
      key: row.key,
      label: row.label,
      panel_stack: row.panel_stack,
      panel_position: row.panel_position,
      button_emoji: row.button_emoji,
      button_style: row.button_style,
      embed_color: row.embed_color,
      num_counter_key: row.num_counter_key,
      channel_name_template: row.channel_name_template,
      greeting_md: row.greeting_md,
      ping_role_ids: row.ping_role_ids,
      perm_template_json: row.perm_template_json,
      has_staff_thread: row.has_staff_thread,
    });
    if (r.changes > 0) typeInserts++;
    const c = upsertCounter.run(row.num_counter_key, row.counter_init);
    if (c.changes > 0) counterInserts++;
  }
  logger.info(
    { typeInserts, counterInserts, total: SEED_ROWS.length },
    "[migration 067] Seeded ticket_type and ticket_counter"
  );

  recordMigration(db, "067", "ticket_system");
  logger.info("[migration 067] Complete");
}
