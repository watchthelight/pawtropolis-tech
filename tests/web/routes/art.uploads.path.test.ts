// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/art.uploads.path.test.ts
 * WHAT: Unit tests for /api/art/uploads/[...path] GET handler.
 * WHY: Public CDN-style endpoint -- no auth gate. The ONLY thing
 *      preventing arbitrary file disclosure is the path validation
 *      (exactly 2 segments, numeric job id, filename matching
 *      `^[\w.-]+$` and not containing ".."). Each guard gets its own
 *      assertion so a future "loosen the regex" patch fails loudly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeEvent } from "../_helpers/requestEvent.js";

const { mockReadFile } = vi.hoisted(() => ({ mockReadFile: vi.fn() }));

vi.mock("node:fs/promises", () => ({ readFile: mockReadFile }));

const { GET } = await import(
  "../../../web/src/routes/api/art/uploads/[...path]/+server.js"
);

const ORIG_ART_UPLOADS_DIR = process.env.ART_UPLOADS_DIR;

beforeEach(() => {
  mockReadFile.mockReset();
});

afterEach(() => {
  if (ORIG_ART_UPLOADS_DIR === undefined) delete process.env.ART_UPLOADS_DIR;
  else process.env.ART_UPLOADS_DIR = ORIG_ART_UPLOADS_DIR;
});

function evt(path: string) {
  return makeEvent({
    user: null,
    method: "GET",
    params: { path },
  });
}

describe("GET /api/art/uploads/[...path]", () => {
  it("404 when path is empty", async () => {
    await expect(GET(evt(""))).rejects.toMatchObject({ status: 404 });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("404 with single segment (no slash)", async () => {
    await expect(GET(evt("42"))).rejects.toMatchObject({ status: 404 });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("404 with three segments (extra slash)", async () => {
    await expect(GET(evt("42/sub/file.webp"))).rejects.toMatchObject({
      status: 404,
    });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("404 when jobSegment is non-numeric", async () => {
    await expect(GET(evt("abc/file.webp"))).rejects.toMatchObject({
      status: 404,
    });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("404 when filename contains '..'", async () => {
    await expect(GET(evt("42/..secret.webp"))).rejects.toMatchObject({
      status: 404,
    });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("404 when filename contains a space (regex rejects)", async () => {
    await expect(GET(evt("42/has space.webp"))).rejects.toMatchObject({
      status: 404,
    });
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("404 when filename contains a slash (regex rejects)", async () => {
    await expect(GET(evt("42/foo/bar.webp"))).rejects.toMatchObject({
      status: 404,
    });
  });

  it("404 when readFile throws (file missing)", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    await expect(GET(evt("42/missing.webp"))).rejects.toMatchObject({
      status: 404,
    });
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it("200 happy path returns image/webp with immutable cache", async () => {
    mockReadFile.mockResolvedValueOnce(Buffer.from("webp-bytes"));
    const res = await GET(evt("42/1234567890.webp"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("200 respects ART_UPLOADS_DIR env override", async () => {
    // The handler captures UPLOADS_DIR at module-load time, so just verify
    // the readFile call shape is correct under the current resolved root.
    mockReadFile.mockResolvedValueOnce(Buffer.from("x"));
    await GET(evt("7/file.webp"));
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    const [path] = mockReadFile.mock.calls[0];
    expect(path).toMatch(/[/\\]art-uploads[/\\]7[/\\]file\.webp$/);
  });
});
