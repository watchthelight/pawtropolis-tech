// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/features/review/kick.test.ts
 * WHAT: Tests for the kick flow (kickTx state transitions and audit insert).
 * WHY: kick is the third terminal action alongside approve and reject. kickTx
 *      is the database boundary; if it accepts a wrong state, audit history
 *      and application status drift apart and the bot misreports moderation
 *      decisions.
 *
 * Coverage:
 *   - submitted/needs_info -> kicked: changed
 *   - approved/rejected: terminal
 *   - kicked: already
 *   - draft: invalid
 *   - missing app: throws
 *   - review_action audit row inserted with action='kick'
 *   - resolver_id and resolution_reason populated on UPDATE
 *
 * Note: kickFlow (member.fetch, member.send, member.kick) is exercised
 * indirectly via tests/features/review/handlers/actionRunners.test.ts and is
 * not duplicated here. Discord-side behavior is intentionally separated from
 * the DB transaction so the boundary stays testable.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDbStatement = vi.hoisted(() => ({
  get: vi.fn(),
  run: vi.fn(),
}));

const mockTransaction = vi.hoisted(() => vi.fn((fn: () => unknown) => fn));

const mockDb = vi.hoisted(() => ({
  prepare: vi.fn(() => mockDbStatement),
  transaction: mockTransaction,
}));

vi.mock("../../../src/db/db.js", () => ({
  db: mockDb,
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("../../../src/lib/logger.js", () => ({
  logger: mockLogger,
}));

vi.mock("../../../src/lib/sentry.js", () => ({
  captureException: vi.fn(),
}));

vi.mock("../../../src/lib/time.js", () => ({
  nowUtc: vi.fn(() => "2026-05-02T10:00:00.000Z"),
}));

import { kickTx } from "../../../src/features/review/flows/kick.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation((fn: () => unknown) => () => fn());
  mockDbStatement.run.mockReturnValue({ lastInsertRowid: BigInt(1) });
});

describe("kickTx", () => {
  describe("reviewable -> kicked", () => {
    it("returns changed when transitioning from submitted", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      const result = kickTx("app-123", "mod-456", "Hostile applicant");

      expect(result.kind).toBe("changed");
    });

    it("returns changed when transitioning from needs_info", () => {
      mockDbStatement.get.mockReturnValue({ status: "needs_info" });

      const result = kickTx("app-123", "mod-456", "No response after request");

      expect(result.kind).toBe("changed");
    });

    it("returns the inserted reviewActionId on success", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });
      mockDbStatement.run.mockReturnValue({ lastInsertRowid: BigInt(2026) });

      const result = kickTx("app-123", "mod-456", "Reason");

      expect(result.kind).toBe("changed");
      if (result.kind === "changed") {
        expect(result.reviewActionId).toBe(2026);
      }
    });
  });

  describe("terminal states", () => {
    it("returns terminal for already-approved apps", () => {
      mockDbStatement.get.mockReturnValue({ status: "approved" });

      const result = kickTx("app-123", "mod-456", "Reason");

      expect(result.kind).toBe("terminal");
      if (result.kind === "terminal") {
        expect(result.status).toBe("approved");
      }
    });

    it("returns terminal for already-rejected apps", () => {
      mockDbStatement.get.mockReturnValue({ status: "rejected" });

      const result = kickTx("app-123", "mod-456", "Reason");

      expect(result.kind).toBe("terminal");
      if (result.kind === "terminal") {
        expect(result.status).toBe("rejected");
      }
    });
  });

  describe("idempotent already-kicked", () => {
    it("returns already when status is kicked", () => {
      mockDbStatement.get.mockReturnValue({ status: "kicked" });

      const result = kickTx("app-123", "mod-456", "Reason");

      expect(result.kind).toBe("already");
      if (result.kind === "already") {
        expect(result.status).toBe("kicked");
      }
    });
  });

  describe("invalid states", () => {
    it("returns invalid for draft apps", () => {
      mockDbStatement.get.mockReturnValue({ status: "draft" });

      const result = kickTx("app-123", "mod-456", "Reason");

      expect(result.kind).toBe("invalid");
      if (result.kind === "invalid") {
        expect(result.status).toBe("draft");
      }
    });
  });

  describe("missing application", () => {
    it("throws when application not found", () => {
      mockDbStatement.get.mockReturnValue(undefined);

      expect(() => kickTx("nonexistent", "mod-456", "Reason")).toThrow(
        "Application not found",
      );
    });
  });

  describe("audit + application updates", () => {
    it("inserts a review_action row with action='kick'", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      kickTx("app-555", "mod-999", "Disrespectful answers");

      const prepareCalls = mockDb.prepare.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      const hasInsert = prepareCalls.some(
        (sql: string) =>
          sql.includes("INSERT INTO review_action") && sql.includes("'kick'"),
      );
      expect(hasInsert).toBe(true);
    });

    it("updates application with resolver_id and resolution_reason", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      kickTx("app-555", "mod-999", "Disrespectful answers");

      const prepareCalls = mockDb.prepare.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      const hasUpdate = prepareCalls.some(
        (sql: string) =>
          sql.includes("UPDATE application") &&
          sql.includes("status = 'kicked'") &&
          sql.includes("resolver_id") &&
          sql.includes("resolution_reason"),
      );
      expect(hasUpdate).toBe(true);
    });

    it("passes the kick reason through to the audit insert", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      kickTx("app-555", "mod-999", "Disrespectful answers");

      // The INSERT INTO review_action call will be invoked with .run(appId, moderatorId, nowUtc, reason)
      const matchingCalls = mockDbStatement.run.mock.calls.filter(
        (call) =>
          call.length === 4 &&
          call[0] === "app-555" &&
          call[1] === "mod-999" &&
          call[3] === "Disrespectful answers",
      );
      expect(matchingCalls.length).toBeGreaterThan(0);
    });

    it("accepts a null reason", () => {
      mockDbStatement.get.mockReturnValue({ status: "submitted" });

      const result = kickTx("app-555", "mod-999", null);

      expect(result.kind).toBe("changed");
      // INSERT still happens; null reason just means no audit-row text.
      const matchingCalls = mockDbStatement.run.mock.calls.filter(
        (call) =>
          call.length === 4 &&
          call[0] === "app-555" &&
          call[1] === "mod-999" &&
          call[3] === null,
      );
      expect(matchingCalls.length).toBeGreaterThan(0);
    });
  });
});
