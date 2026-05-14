/**
 * Pawtropolis Tech -- src/features/review/handlers/buttonCooldown.ts
 * WHAT: Per-user per-app per-action rate limiter for review card buttons.
 * WHY: A per-app key swallowed sequential different actions (claim -> wrong_password),
 *      making the first click appear dead until the cooldown expired.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

export const BUTTON_COOLDOWN_MS = 3_000;

const buttonCooldowns = new Map<string, number>();

export function cooldownKeyFor(userId: string, code: string, action: string): string {
  return `${userId}:${code}:${action}`;
}

export function isRateLimited(key: string, now: number = Date.now()): boolean {
  const last = buttonCooldowns.get(key);
  return last !== undefined && now - last < BUTTON_COOLDOWN_MS;
}

export function recordClick(key: string, now: number = Date.now()): void {
  buttonCooldowns.set(key, now);
}

export function pruneStaleCooldowns(now: number = Date.now()): void {
  for (const [key, ts] of buttonCooldowns) {
    if (now - ts > BUTTON_COOLDOWN_MS * 2) buttonCooldowns.delete(key);
  }
}

// Exposed for tests only.
export function _resetCooldownsForTest(): void {
  buttonCooldowns.clear();
}

export function _sizeForTest(): number {
  return buttonCooldowns.size;
}
