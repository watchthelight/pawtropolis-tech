# Story 7.1: Art Query Layer & Queue View

Status: done

## Story

As a Senior Mod+,
I want to see the artist rotation queue and active art jobs,
so that I can track artist assignments and queue position.

## Acceptance Criteria

1. **Given** a Senior Mod navigates to `/dashboard/art` **When** the page loads **Then** `queries/art.ts` fetches from `artist_queue` and `art_job` tables, JOINing `user_cache` for display names.

2. **Given** queue data loaded **Then** artists display in position order showing: position number, display name, assignment count, last assigned date, skip status **And** the next-up artist is highlighted (first non-skipped at lowest position).

3. **Given** skipped artists exist **Then** they show `skip_reason` and are visually dimmed.

4. **Given** active jobs exist **Then** jobs display: job number, artist name, recipient name, ticket type, status badge, assigned date **And** sorted most recent first.

5. **Given** no artists in queue or no active jobs **When** the page renders **Then** appropriate `EmptyState` is shown for each section.

6. **Given** the tier gate **Then** SM+ is enforced (already in placeholder).

## Tasks / Subtasks

- [ ] Task 1: Create `web/src/lib/server/queries/art.ts` (AC: #1, #2, #3, #4)
  - [ ] 1.1 Add `ArtistItem` interface: `{ userId: string; displayName: string; position: number; assignmentsCount: number; lastAssignedAt: number | null; skipped: boolean; skipReason: string | null }`
  - [ ] 1.2 Add `ArtJobItem` interface: `{ id: number; jobNumber: number; artistJobNumber: number; artistName: string; artistId: string; recipientName: string; recipientId: string; ticketType: string; status: string; assignedAt: number; updatedAt: number }`
  - [ ] 1.3 Add `getArtistQueue(guildId: string): ArtistItem[]` — query `artist_queue` ORDER BY position, JOIN `user_cache` for names, use `normalizeTimestamp` for `added_at` and `last_assigned_at`
  - [ ] 1.4 Add `getActiveJobs(guildId: string): ArtJobItem[]` — query `art_job` WHERE status NOT IN ('done', 'cancelled'), JOIN `user_cache` for artist+recipient names, ORDER BY assigned_at DESC, use `normalizeTimestamp` for dates
- [ ] Task 2: Wire art data in `+page.server.ts` (AC: #1, #6)
  - [ ] 2.1 Import `getArtistQueue` and `getActiveJobs`
  - [ ] 2.2 Call in load function, return `{ queue, jobs }` in page data
- [ ] Task 3: Build Art page UI in `+page.svelte` (AC: #2, #3, #4, #5)
  - [ ] 3.1 Two-section layout: "Artist Queue" and "Active Jobs"
  - [ ] 3.2 Queue section: table/list with position, name, assignments count, last assigned (relative time), skip status
  - [ ] 3.3 Highlight next-up artist (first non-skipped) with accent border or badge
  - [ ] 3.4 Dimmed/muted style for skipped artists, show skip_reason as subtitle
  - [ ] 3.5 Jobs section: table/list with job number, artist, recipient, ticket type badge, status badge, assigned date
  - [ ] 3.6 StatusBadge must handle all 6 statuses: assigned, sketching, lining, coloring, done, cancelled
  - [ ] 3.7 Ticket type display: headshot, halfbody, fullbody, emoji
  - [ ] 3.8 Empty states for each section independently
  - [ ] 3.9 Responsive layout

## Dev Notes

### Database Schemas

**`artist_queue`** — Artist rotation order:
- `id` INTEGER PK
- `guild_id` TEXT
- `user_id` TEXT
- `position` INTEGER (contiguous 1-based)
- `added_at` TEXT datetime — use `normalizeTimestamp()`
- `assignments_count` INTEGER (lifetime total)
- `last_assigned_at` TEXT datetime nullable — use `normalizeTimestamp()`
- `skipped` INTEGER (0/1)
- `skip_reason` TEXT nullable
- UNIQUE on `(guild_id, user_id)`, INDEX on `(guild_id, position)`

**`art_job`** — Job tracking:
- `id` INTEGER PK
- `guild_id` TEXT
- `job_number` INTEGER (global monotonic)
- `artist_id` TEXT
- `artist_job_number` INTEGER (per-artist counter)
- `recipient_id` TEXT
- `ticket_type` TEXT — values: headshot, halfbody, fullbody, emoji
- `status` TEXT — values: assigned, sketching, lining, coloring, done, cancelled
- `assigned_at` TEXT datetime — use `normalizeTimestamp()`
- `updated_at` TEXT datetime — use `normalizeTimestamp()`
- `completed_at` TEXT datetime nullable
- `notes` TEXT nullable
- `assignment_log_id` INTEGER nullable
- UNIQUE on `(guild_id, job_number)`, INDEX on `(guild_id, status)`, `(artist_id, status)`

### Key Patterns

**User cache JOIN** (same as all other query files):
```sql
LEFT JOIN user_cache u ON aq.user_id = u.user_id AND u.guild_id = ?
COALESCE(u.display_name, u.global_name, u.username, 'User ' || substr(aq.user_id, -6))
```

**Timestamp normalization** (from `shared.ts`):
```typescript
import { normalizeTimestamp } from './shared';
// TEXT datetime -> ms epoch, INTEGER seconds -> ms epoch
```

**Active jobs filter**:
```sql
WHERE status NOT IN ('done', 'cancelled')
```

**Next-up artist**: first row WHERE `skipped = 0` in position-sorted results.

### Project Structure

- `web/src/lib/server/queries/art.ts` — NEW: ArtistItem, ArtJobItem, getArtistQueue(), getActiveJobs()
- `web/src/routes/dashboard/art/+page.server.ts` — MODIFY: add query calls
- `web/src/routes/dashboard/art/+page.svelte` — MODIFY: replace placeholder with queue + jobs view

### References

- [Source: epics.md — Stories 7.1, 7.2, 7.3 ACs and Ground Truth Notes]
- [Source: src/features/artistRotation/types.ts — ArtistQueueRow schema]
- [Source: src/features/artJobs/types.ts — ArtJobRow, JOB_STATUSES]
- [Source: web/src/lib/server/queries/shared.ts — normalizeTimestamp()]
- [Source: web/src/lib/server/queries/flags.ts — similar query pattern]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
