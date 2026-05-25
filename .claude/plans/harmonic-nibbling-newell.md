# Plan: Three Web Dashboard Improvements

## Context
Three quality-of-life improvements to the web dashboard: better theme contrast, improved modmail UX, and stale application visibility.

---

## Task 1: Darken Ranger Theme Steel Grey

**File:** `web/src/lib/styles/skeuomorphism.css`

Darken the three steel color variables significantly for better readability:

```
--steel:       #4a4e54 → #2a2d32   (much darker main steel)
--steel-light: #5a5e64 → #363a40   (darker raised surfaces)
--steel-dark:  #3a3e42 → #1e2125   (very dark panel backgrounds)
```

Also update the surface overrides that use these colors:
```
--surface:        #4a4e54 → #2a2d32
--surface-raised: #5a5e64 → #363a40
--surface-overlay: #5a5e64 → #363a40
```

And all hardcoded hex references to the old steel values throughout the file (cards, tabs, detail panels, chips, etc.).

---

## Task 2: Modmail Auto-Scroll to Bottom

**File:** `web/src/lib/components/review/ModmailViewer.svelte`

**Problem:** `scrollToBottom()` calls `messagesEnd.scrollIntoView()`, but `messagesEnd` is outside the scrollable `.thread-messages` containers (which have `max-height: 400px; overflow-y: auto`). So the inner containers never scroll to show the latest messages.

**Fix:**
1. Add a `use:autoScrollEnd` Svelte action that scrolls a container to its bottom on mount
2. Apply it to each `.thread-messages` div so all threads show their latest messages on open
3. Bind a `panelEl` ref on `.modmail-panel` and rewrite `scrollToBottom()` to find the last `.thread-messages` child and scroll it (used after sending a message)
4. Remove the old `messagesEnd` div and binding

---

## Task 3: Red Stale Application Highlighting

### 3a. Add `modmailAwaitingSince` to review queue data

**File:** `web/src/lib/server/queries/reviews.ts`

Add a subquery to `getReviewQueue` that returns the timestamp of the last staff-to-user message in an open modmail ticket (when the user hasn't responded):

```sql
(
    SELECT mm.created_at FROM modmail_ticket mt
    INNER JOIN modmail_message mm ON mm.ticket_id = mt.id
    WHERE mt.guild_id = a.guild_id AND mt.user_id = a.user_id
        AND mt.status = 'open'
        AND mm.id = (SELECT MAX(mm2.id) FROM modmail_message mm2 WHERE mm2.ticket_id = mt.id)
        AND mm.direction = 'to_user'
) as modmail_awaiting_since
```

Add `modmailAwaitingSince: number | null` to `ReviewQueueItem` and `ReviewQueueRow`.

### 3b. Compute `isStale` in queue layout and pass to ReviewCard

**File:** `web/src/routes/dashboard/reviews/+layout.svelte`

When rendering ReviewCard, compute staleness:
```typescript
const isStale = (item.submittedAt && Date.now() - item.submittedAt > 24 * 60 * 60 * 1000)
    || (item.modmailAwaitingSince && Date.now() - item.modmailAwaitingSince > 24 * 60 * 60 * 1000);
```

Pass `isStale` as a prop to ReviewCard.

### 3c. Add red stale styling to ReviewCard

**File:** `web/src/lib/components/review/ReviewCard.svelte`

- Add `isStale` boolean prop
- Add `class:review-card-stale={isStale}` to the card div
- CSS: red left border (`border-left: 3px solid var(--status-danger)`), subtle red background tint, and maybe a "Stale" label similar to the modmail label

---

## Files Modified
1. `web/src/lib/styles/skeuomorphism.css` - darken steel colors
2. `web/src/lib/components/review/ModmailViewer.svelte` - fix scroll behavior
3. `web/src/lib/server/queries/reviews.ts` - add modmailAwaitingSince field
4. `web/src/lib/components/review/ReviewCard.svelte` - add isStale prop + red styling
5. `web/src/routes/dashboard/reviews/+layout.svelte` - compute isStale, pass to ReviewCard

## Verification
- Build: `npm run build` to ensure no TypeScript errors
- Visual: deploy or use dev mode to check ranger theme contrast, modmail scroll, and stale card highlighting
