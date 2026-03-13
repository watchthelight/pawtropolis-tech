/**
 * Pawtropolis Tech — tests/web/pulse.test.ts
 * WHAT: Unit tests for pulse page helpers — midnight format, trend derivation, flag breakdown, modmail preview, activity trend.
 * WHY: Verify pulse card logic for TEXT column comparison, trend arrows, flag type breakdown, modmail time preview, and activity summary.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// KEEP IN SYNC with web/src/lib/server/queries/pulse.ts (todayMidnightISO computation)
// Mirrored here because the web module uses SvelteKit aliases ($lib/) not resolvable by vitest.
// If you change the midnight format logic in pulse.ts, update this mirror too.
function getTodayMidnightISO(): string {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  return midnight.toISOString().slice(0, 19).replace("T", " ");
}

// KEEP IN SYNC with web/src/routes/dashboard/pulse/+page.svelte (pendingTrend $derived)
// If you change the trend derivation logic in +page.svelte, update this mirror too.
function derivePendingTrend(
  submittedToday: number,
  decisionsToday: number
): "up" | "down" | undefined {
  if (submittedToday === 0 && decisionsToday === 0) return undefined;
  if (submittedToday > decisionsToday) return "up";
  if (decisionsToday > submittedToday) return "down";
  return undefined;
}

describe("pulse helpers", () => {
  describe("getTodayMidnightISO", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns YYYY-MM-DD HH:MM:SS format", () => {
      vi.setSystemTime(new Date("2026-03-13T15:30:00Z"));
      const result = getTodayMidnightISO();
      expect(result).toBe("2026-03-13 00:00:00");
    });

    it("uses UTC midnight, not local midnight", () => {
      vi.setSystemTime(new Date("2026-03-13T23:59:59Z"));
      const result = getTodayMidnightISO();
      expect(result).toBe("2026-03-13 00:00:00");
    });

    it("handles day boundary at UTC midnight exactly", () => {
      vi.setSystemTime(new Date("2026-03-14T00:00:00Z"));
      const result = getTodayMidnightISO();
      expect(result).toBe("2026-03-14 00:00:00");
    });

    it("handles month boundary", () => {
      vi.setSystemTime(new Date("2026-04-01T05:00:00Z"));
      const result = getTodayMidnightISO();
      expect(result).toBe("2026-04-01 00:00:00");
    });

    it("matches SQLite datetime format (no T separator, no Z suffix)", () => {
      vi.setSystemTime(new Date("2026-03-13T12:00:00Z"));
      const result = getTodayMidnightISO();
      expect(result).not.toContain("T");
      expect(result).not.toContain("Z");
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });

  describe("derivePendingTrend", () => {
    it("returns 'up' when more submissions than decisions (queue growing)", () => {
      expect(derivePendingTrend(5, 2)).toBe("up");
    });

    it("returns 'down' when more decisions than submissions (queue shrinking)", () => {
      expect(derivePendingTrend(2, 5)).toBe("down");
    });

    it("returns undefined when both are zero (no activity)", () => {
      expect(derivePendingTrend(0, 0)).toBeUndefined();
    });

    it("returns undefined when equal non-zero (balanced)", () => {
      expect(derivePendingTrend(3, 3)).toBeUndefined();
    });

    it("returns 'up' when submissions but no decisions", () => {
      expect(derivePendingTrend(1, 0)).toBe("up");
    });

    it("returns 'down' when decisions but no submissions", () => {
      expect(derivePendingTrend(0, 1)).toBe("down");
    });
  });

  // KEEP IN SYNC with web/src/routes/dashboard/pulse/+page.svelte (flagBreakdown $derived)
  describe("flagBreakdown", () => {
    function flagBreakdown(activeFlags: number, behavioralFlags: number): string {
      const parts: string[] = [];
      if (activeFlags > 0) parts.push(`${activeFlags} avatar`);
      if (behavioralFlags > 0) parts.push(`${behavioralFlags} behavioral`);
      return parts.join(" \u00b7 ");
    }

    it("shows both types with separator when both have counts", () => {
      expect(flagBreakdown(2, 1)).toBe("2 avatar \u00b7 1 behavioral");
    });

    it("shows only avatar when behavioral is 0", () => {
      expect(flagBreakdown(3, 0)).toBe("3 avatar");
    });

    it("shows only behavioral when avatar is 0", () => {
      expect(flagBreakdown(0, 2)).toBe("2 behavioral");
    });

    it("returns empty string when both are 0", () => {
      expect(flagBreakdown(0, 0)).toBe("");
    });

    it("handles large counts", () => {
      expect(flagBreakdown(15, 8)).toBe("15 avatar \u00b7 8 behavioral");
    });
  });

  // KEEP IN SYNC with web/src/routes/dashboard/pulse/+page.svelte (activityTrend $derived)
  // If you change the activity trend logic in +page.svelte, update this mirror too.
  describe("activityTrend", () => {
    function activityTrend(
      messagesToday: number,
      messagesAvg7d: number
    ): "up" | "down" | undefined {
      if (messagesToday === 0 || messagesAvg7d === 0) return undefined;
      if (messagesToday > messagesAvg7d * 1.2) return "up";
      if (messagesToday < messagesAvg7d * 0.8) return "down";
      return undefined;
    }

    it("returns 'up' when today exceeds 7d avg by more than 20%", () => {
      expect(activityTrend(130, 100)).toBe("up");
    });

    it("returns 'down' when today is below 7d avg by more than 20%", () => {
      expect(activityTrend(70, 100)).toBe("down");
    });

    it("returns undefined when within normal range", () => {
      expect(activityTrend(100, 100)).toBeUndefined();
    });

    it("returns undefined at exact upper boundary (120% of avg)", () => {
      expect(activityTrend(120, 100)).toBeUndefined();
    });

    it("returns undefined at exact lower boundary (80% of avg)", () => {
      expect(activityTrend(80, 100)).toBeUndefined();
    });

    it("returns undefined when messagesToday is 0", () => {
      expect(activityTrend(0, 100)).toBeUndefined();
    });

    it("returns undefined when messagesAvg7d is 0 (no historical data)", () => {
      expect(activityTrend(50, 0)).toBeUndefined();
    });

    it("returns undefined when both are 0", () => {
      expect(activityTrend(0, 0)).toBeUndefined();
    });
  });

  // KEEP IN SYNC with web/src/lib/server/queries/pulse.ts (hourlyDistribution mapping)
  // If you change the hour_bucket to array mapping logic, update this mirror too.
  describe("hourlyDistribution mapping", () => {
    function mapHourlyRows(
      rows: { hour_bucket: number; count: number }[],
      todayMidnightS: number
    ): number[] {
      const distribution = new Array(24).fill(0);
      for (const row of rows) {
        distribution[(row.hour_bucket - todayMidnightS) / 3600] = row.count;
      }
      return distribution;
    }

    it("maps hour_bucket epoch values to 24-element array", () => {
      const midnight = 1773532800; // 2026-03-13 00:00:00 UTC
      const rows = [
        { hour_bucket: midnight, count: 5 },
        { hour_bucket: midnight + 3600, count: 12 },
        { hour_bucket: midnight + 23 * 3600, count: 3 },
      ];
      const result = mapHourlyRows(rows, midnight);
      expect(result).toHaveLength(24);
      expect(result[0]).toBe(5);
      expect(result[1]).toBe(12);
      expect(result[23]).toBe(3);
      expect(result[2]).toBe(0); // gap hours are 0
    });

    it("returns all zeros for empty rows", () => {
      const result = mapHourlyRows([], 1773532800);
      expect(result).toHaveLength(24);
      expect(result.every((v) => v === 0)).toBe(true);
    });

    it("sum of distribution equals total messages", () => {
      const midnight = 1773532800;
      const rows = [
        { hour_bucket: midnight + 5 * 3600, count: 10 },
        { hour_bucket: midnight + 14 * 3600, count: 20 },
      ];
      const result = mapHourlyRows(rows, midnight);
      expect(result.reduce((a, b) => a + b, 0)).toBe(30);
    });
  });

  // KEEP IN SYNC with web/src/routes/dashboard/pulse/+page.svelte (modmailPreview $derived)
  describe("modmailPreview", () => {
    function modmailPreview(latestModmailAt: string | null): string | null {
      if (!latestModmailAt) return null;
      // relativeTime is tested separately in its own module;
      // here we verify the derivation pattern produces the right prefix
      const ms = new Date(latestModmailAt).getTime();
      return ms ? `latest: mock-time` : null;
    }

    it("returns null when latestModmailAt is null", () => {
      expect(modmailPreview(null)).toBeNull();
    });

    it("returns prefixed string when latestModmailAt exists", () => {
      const result = modmailPreview("2026-03-13 15:30:00");
      expect(result).toMatch(/^latest: /);
    });

    it("correctly parses ISO8601 without T separator", () => {
      const ms = new Date("2026-03-13 15:30:00").getTime();
      expect(ms).toBeGreaterThan(0);
      expect(Number.isNaN(ms)).toBe(false);
    });
  });
});
