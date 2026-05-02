// SPDX-License-Identifier: LicenseRef-ANW-1.0
import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { resolveBadge } from "../../../src/features/badges/resolve.js";
import type {
  BadgeDefinition,
  BadgeManifestEntry,
} from "../../../src/features/badges/types.js";

function makeClient(opts: {
  guild?: { roles: Map<string, { name: string; color: number }>; channels: Map<string, { name: string }> } | null;
  guildFetchThrows?: boolean;
}): unknown {
  const guild = opts.guild;
  return {
    isReady: () => true,
    users: {
      fetch: vi.fn(async () => ({ globalName: "Bash", username: "bash" })),
    },
    guilds: {
      cache: { get: () => guild ?? undefined },
      fetch: vi.fn(async () => {
        if (opts.guildFetchThrows) throw new Error("boom");
        return guild;
      }),
    },
  };
}

function priorEntry(): BadgeManifestEntry {
  return {
    id: "movie-tier-1",
    kind: "role",
    guildId: "g",
    discordId: "1",
    displayName: "Movie Tier I (cached)",
    prefix: "@",
    colorHex: "#FFAA00",
    backgroundHex: "#3A3A3A",
    foregroundHex: "#FFFFFF",
    stale: false,
    resolvedAt: new Date().toISOString(),
    style: "discord-role",
    url: "x",
    generatedAt: new Date().toISOString(),
  };
}

describe("resolveBadge role", () => {
  const def: BadgeDefinition = {
    id: "movie-tier-1",
    guildId: "",
    kind: "role",
    discordId: "role-1",
    suffix: "1+ movies",
    style: "discord-role",
    enabled: true,
  };

  it("returns fresh values when role exists", async () => {
    const guild = {
      roles: { cache: new Map([["role-1", { name: "Movie Tier I", color: 0xffaa00 }]]), fetch: vi.fn() },
      channels: { cache: new Map(), fetch: vi.fn() },
    };
    const result = await resolveBadge(def, {
      client: makeClient({ guild }) as never,
      guildId: "g",
    });
    expect(result.stale).toBe(false);
    expect(result.displayName).toBe("Movie Tier I");
    expect(result.colorHex).toBe("#FFAA00");
  });

  it("marks stale and reuses prior on guild fetch failure", async () => {
    const result = await resolveBadge(def, {
      client: makeClient({ guild: null, guildFetchThrows: true }) as never,
      guildId: "g",
      prior: priorEntry(),
    });
    expect(result.stale).toBe(true);
    expect(result.displayName).toBe("Movie Tier I (cached)");
  });

  it("falls back with unknown-role when no prior cache", async () => {
    const result = await resolveBadge(def, {
      client: makeClient({ guild: null, guildFetchThrows: true }) as never,
      guildId: "g",
    });
    expect(result.stale).toBe(true);
    expect(result.displayName).toBe("unknown-role");
  });
});

describe("resolveBadge channel", () => {
  it("uses channel name when available", async () => {
    const def: BadgeDefinition = {
      id: "channel-writing",
      guildId: "",
      kind: "channel",
      discordId: "c-1",
      style: "discord-channel",
      enabled: true,
    };
    const guild = {
      roles: { cache: new Map(), fetch: vi.fn() },
      channels: { cache: new Map([["c-1", { name: "writing" }]]), fetch: vi.fn() },
    };
    const r = await resolveBadge(def, { client: makeClient({ guild }) as never, guildId: "g" });
    expect(r.displayName).toBe("writing");
    expect(r.prefix).toBe("#");
  });
});
