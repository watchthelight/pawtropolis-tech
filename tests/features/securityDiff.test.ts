// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  computeSnapshotDiff,
  getDangerousChanges,
  hasMeaningfulChanges,
} from "../../src/features/securityDiff.js";
import type {
  SecuritySnapshot,
  RoleSnapshot,
} from "../../src/store/securitySnapshotStore.js";

function makeSnap(opts: Partial<SecuritySnapshot> = {}): SecuritySnapshot {
  return {
    id: opts.id ?? 1,
    guildId: opts.guildId ?? "guild-1",
    createdAt: opts.createdAt ?? 1_700_000_000,
    roleCount: 0,
    channelCount: 0,
    issueCount: 0,
    criticalCount: 0,
    highCount: 0,
    mediumCount: 0,
    lowCount: 0,
    rolesSnapshot: opts.rolesSnapshot ?? [],
    channelsSnapshot: opts.channelsSnapshot ?? [],
    issuesSnapshot: opts.issuesSnapshot ?? [],
    contentHash: opts.contentHash ?? "hash-x",
  };
}

function makeRole(opts: Partial<RoleSnapshot> = {}): RoleSnapshot {
  return {
    id: opts.id ?? "r1",
    name: opts.name ?? "Member",
    position: opts.position ?? 1,
    color: 0,
    managed: false,
    permissions: opts.permissions ?? "0",
    memberCount: 0,
  };
}

describe("computeSnapshotDiff", () => {
  it("empty snapshots produce empty diff", () => {
    const diff = computeSnapshotDiff(makeSnap(), makeSnap());
    expect(diff.rolesAdded).toEqual([]);
    expect(diff.rolesRemoved).toEqual([]);
    expect(diff.rolesChanged).toEqual([]);
    expect(diff.channelsAdded).toEqual([]);
    expect(diff.issuesNew).toEqual([]);
  });

  it("detects added role", () => {
    const before = makeSnap();
    const after = makeSnap({ rolesSnapshot: [makeRole({ id: "new-role", name: "Newbie" })] });
    const diff = computeSnapshotDiff(before, after);
    expect(diff.rolesAdded).toHaveLength(1);
    expect(diff.rolesAdded[0].id).toBe("new-role");
  });

  it("detects removed role", () => {
    const before = makeSnap({ rolesSnapshot: [makeRole({ id: "gone", name: "Gone" })] });
    const after = makeSnap();
    const diff = computeSnapshotDiff(before, after);
    expect(diff.rolesRemoved).toHaveLength(1);
    expect(diff.rolesRemoved[0].id).toBe("gone");
  });

  it("ignores roles with no real permission change", () => {
    // Same role on both sides, no permission delta
    const role = makeRole({ id: "r1", permissions: "0" });
    const diff = computeSnapshotDiff(
      makeSnap({ rolesSnapshot: [role] }),
      makeSnap({ rolesSnapshot: [role] })
    );
    expect(diff.rolesChanged).toEqual([]);
  });

  it("diffs roles by named permissions without throwing (#00071)", () => {
    // Snapshots store comma-separated permission NAMES, not numeric bitfields.
    // The old BigInt() parse threw SyntaxError on names like "ViewChannel".
    const before = makeSnap({
      rolesSnapshot: [makeRole({ id: "r1", permissions: "ViewChannel,SendMessages" })],
    });
    const after = makeSnap({
      rolesSnapshot: [makeRole({ id: "r1", permissions: "ViewChannel,ManageRoles" })],
    });
    const diff = computeSnapshotDiff(before, after);
    expect(diff.rolesChanged).toHaveLength(1);
    expect(diff.rolesChanged[0].permissionsAdded).toEqual(["ManageRoles"]);
    expect(diff.rolesChanged[0].permissionsRemoved).toEqual(["SendMessages"]);
  });

  it("flags an added role with dangerous named permissions (#00071)", () => {
    const after = makeSnap({
      rolesSnapshot: [makeRole({ id: "admin", name: "Admin", permissions: "Administrator,ManageGuild" })],
    });
    const diff = computeSnapshotDiff(makeSnap(), after);
    const dangerous = getDangerousChanges(diff);
    expect(dangerous).toHaveLength(1);
    expect(dangerous[0].severity).toBe("critical");
    expect(dangerous[0].permissions).toContain("Administrator");
  });

  it("detects new and resolved issues by key", () => {
    const before = makeSnap({
      issuesSnapshot: [
        { key: "i-1", severity: "high", title: "old", description: "", targetId: "t", targetName: "T", permissionHash: "h1" },
      ],
    });
    const after = makeSnap({
      issuesSnapshot: [
        { key: "i-2", severity: "medium", title: "new", description: "", targetId: "t", targetName: "T", permissionHash: "h2" },
      ],
    });
    const diff = computeSnapshotDiff(before, after);
    expect(diff.issuesNew.map((i) => i.key)).toEqual(["i-2"]);
    expect(diff.issuesResolved.map((i) => i.key)).toEqual(["i-1"]);
  });
});

describe("hasMeaningfulChanges", () => {
  it("returns false for empty diff", () => {
    const diff = computeSnapshotDiff(makeSnap(), makeSnap());
    expect(hasMeaningfulChanges(diff)).toBe(false);
  });

  it("returns true when a role is added", () => {
    const diff = computeSnapshotDiff(
      makeSnap(),
      makeSnap({ rolesSnapshot: [makeRole({ id: "x" })] })
    );
    expect(hasMeaningfulChanges(diff)).toBe(true);
  });
});

describe("getDangerousChanges", () => {
  it("empty diff yields no dangerous changes", () => {
    const diff = computeSnapshotDiff(makeSnap(), makeSnap());
    expect(getDangerousChanges(diff)).toEqual([]);
  });
});
