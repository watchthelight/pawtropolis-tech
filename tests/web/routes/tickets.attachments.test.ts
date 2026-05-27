// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/tickets.attachments.test.ts
 * WHAT: Unit tests for /api/tickets/[ticketId]/attachments/[attachmentId] GET.
 * WHY: The single most security-sensitive route in the dashboard. Three
 *      gates protect it: (1) auth + tier, (2) per-ticket-type tier (report
 *      attachments require mod), (3) path-traversal validation before
 *      readFile. The traversal guard runs entirely off the DB-stored
 *      `local_path` -- pin it so a future "trust local_path" patch can't
 *      let a malicious row pull arbitrary files off disk.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockReadFile, dbRef } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  dbRef: {
    current: null as null | import("better-sqlite3").Database,
  },
}));

vi.mock("node:fs/promises", () => ({ readFile: mockReadFile }));
vi.mock("$lib/server/db", () => ({ db: () => dbRef.current! }));

const { makeDb } = await import("../_helpers/db.js");
const { GET } = await import(
  "../../../web/src/routes/api/tickets/[ticketId]/attachments/[attachmentId]/+server.js"
);

const viewerUser = { id: "u1", tier: "viewer" as const, roles: [] };
const modUser = { id: "u2", tier: "mod" as const, roles: [] };

beforeEach(() => {
  dbRef.current?.close();
  dbRef.current = makeDb();
  // This route is exercised in isolation: we insert ticket + ticket_attachment
  // rows directly without seeding their FK parents (ticket_type, ticket_message),
  // which are irrelevant to the auth/path-traversal logic under test. Disable FK
  // enforcement so those minimal inserts succeed. (#00045 replaced the FK-free
  // MISSING_DDL ticket shims with the real schema.)
  dbRef.current.pragma("foreign_keys = OFF");
  mockReadFile.mockReset();
});

afterAll(() => {
  dbRef.current?.close();
});

function seedTicket(opts: {
  ticketId?: string;
  typeKey?: string;
}) {
  const id = opts.ticketId ?? "t1";
  dbRef.current!
    .prepare(
      "INSERT INTO ticket (id, type_key, number, channel_id, guild_id, opener_user_id, status, opened_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(id, opts.typeKey ?? "support", 1, `chan-${id}`, "g1", "opener1", "open", 0);
  return id;
}

function seedAttachment(opts: {
  id?: string;
  ticketId?: string;
  filename?: string;
  mime?: string | null;
  local_path?: string | null;
}) {
  const id = opts.id ?? "a1";
  const ticketId = opts.ticketId ?? "t1";
  dbRef.current!
    .prepare(
      "INSERT INTO ticket_attachment (id, message_id, ticket_id, filename, mime, size_bytes, local_path, original_url) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      `m-${id}`,
      ticketId,
      opts.filename ?? "screenshot.png",
      opts.mime === undefined ? "image/png" : opts.mime,
      1024,
      opts.local_path === undefined
        ? `ticket-attachments/${ticketId}/abc123-screenshot.png`
        : opts.local_path,
      "https://cdn.discord.com/attachments/...",
    );
  return id;
}

function evt(
  user: typeof viewerUser | typeof modUser | null,
  ticketId = "t1",
  attachmentId = "a1",
) {
  return makeEvent({
    user,
    method: "GET",
    params: { ticketId, attachmentId },
  });
}

describe("GET /api/tickets/[ticketId]/attachments/[attachmentId]", () => {
  it("401 when locals.user is absent", async () => {
    await expect(GET(evt(null))).rejects.toMatchObject({ status: 401 });
  });

  it("403 when tier below viewer (none)", async () => {
    await expect(
      GET(evt({ id: "u1", tier: "none", roles: [] } as never)),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("404 when DB returns no row", async () => {
    await expect(GET(evt(viewerUser))).rejects.toMatchObject({ status: 404 });
  });

  it("200 viewer can view non-report attachment", async () => {
    seedTicket({ typeKey: "support" });
    seedAttachment({});
    mockReadFile.mockResolvedValueOnce(Buffer.from("hello"));
    const res = await GET(evt(viewerUser));
    expect(res.status).toBe(200);
  });

  it("403 viewer denied report-user attachment (mod required)", async () => {
    seedTicket({ typeKey: "report-user" });
    seedAttachment({});
    await expect(GET(evt(viewerUser))).rejects.toMatchObject({ status: 403 });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("403 viewer denied report-staff attachment", async () => {
    seedTicket({ typeKey: "report-staff" });
    seedAttachment({});
    await expect(GET(evt(viewerUser))).rejects.toMatchObject({ status: 403 });
  });

  it("200 mod can view report-user attachment", async () => {
    seedTicket({ typeKey: "report-user" });
    seedAttachment({});
    mockReadFile.mockResolvedValueOnce(Buffer.from("hello"));
    const res = await GET(evt(modUser));
    expect(res.status).toBe(200);
  });

  it("410 when local_path is null (not mirrored)", async () => {
    seedTicket({});
    seedAttachment({ local_path: null });
    await expect(GET(evt(viewerUser))).rejects.toMatchObject({ status: 410 });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("404 when local_path escapes ATTACHMENTS_ROOT (path traversal blocked BEFORE readFile)", async () => {
    seedTicket({});
    seedAttachment({ local_path: "../../etc/passwd" });
    await expect(GET(evt(viewerUser))).rejects.toMatchObject({ status: 404 });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("404 when readFile throws (file missing on disk)", async () => {
    seedTicket({});
    seedAttachment({});
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    await expect(GET(evt(viewerUser))).rejects.toMatchObject({ status: 404 });
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it("200 happy path returns bytes with mime + private cache header", async () => {
    seedTicket({});
    seedAttachment({ mime: "image/png", filename: "shot.png" });
    mockReadFile.mockResolvedValueOnce(Buffer.from("pixels"));
    const res = await GET(evt(viewerUser));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=3600");
    const text = await res.text();
    expect(text).toBe("pixels");
  });

  it("200 with mime=null falls back to application/octet-stream", async () => {
    seedTicket({});
    seedAttachment({ mime: null });
    mockReadFile.mockResolvedValueOnce(Buffer.from("x"));
    const res = await GET(evt(viewerUser));
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
  });

  it("200 URL-encodes filename in Content-Disposition", async () => {
    seedTicket({});
    seedAttachment({ filename: "weird name & sym.png" });
    mockReadFile.mockResolvedValueOnce(Buffer.from("x"));
    const res = await GET(evt(viewerUser));
    const disp = res.headers.get("Content-Disposition") ?? "";
    expect(disp).toMatch(/^inline; filename="/);
    expect(disp).toContain("weird%20name%20%26%20sym.png");
  });
});
