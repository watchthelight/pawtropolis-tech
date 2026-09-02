// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- src/features/review/cardEvents.ts
 * WHAT: In-process signal that a review card message now exists for an application.
 * WHY: The avatar scan used to poll review_card every 200ms for up to 5s waiting for the
 *      card the submit flow was creating in parallel. Waiting on this event costs nothing
 *      while the card is still being posted.
 */

import { EventEmitter } from "node:events";

const MAPPED = "mapped";

const reviewCardEvents = new EventEmitter();
reviewCardEvents.setMaxListeners(500);

export function emitReviewCardMapped(appId: string): void {
  reviewCardEvents.emit(MAPPED, appId);
}

/** Resolves true when the card for `appId` is mapped, false when `timeoutMs` passes first. */
export function waitForReviewCardMapped(appId: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onMapped = (id: string) => {
      if (id !== appId) return;
      cleanup();
      resolve(true);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    timer.unref();
    const cleanup = () => {
      clearTimeout(timer);
      reviewCardEvents.off(MAPPED, onMapped);
    };
    reviewCardEvents.on(MAPPED, onMapped);
  });
}
