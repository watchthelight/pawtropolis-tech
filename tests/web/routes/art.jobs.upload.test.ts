// SPDX-License-Identifier: LicenseRef-ANW-1.0
/**
 * Pawtropolis Tech -- tests/web/routes/art.jobs.upload.test.ts
 * WHAT: Unit tests for /api/art/jobs/[jobId]/upload POST handler.
 * WHY: The only multipart upload route in the dashboard. Three guards
 *      gate before disk I/O: mime allowlist, 8 MB size cap, sharp image
 *      validation. Pin each guard so a future "permit SVG" or "raise
 *      cap" patch surfaces here. Real sharp is used for the happy paths
 *      (mocking it doesn't intercept the binding cleanly); fs + botApi
 *      are mocked so no real disk I/O occurs.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockMkdir, mockWriteFile, mockCallBotApi } = vi.hoisted(() => ({
  mockMkdir: vi.fn(async () => undefined),
  mockWriteFile: vi.fn(async () => undefined),
  mockCallBotApi: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: mockMkdir,
  writeFile: mockWriteFile,
}));
vi.mock("$lib/server/botApi", () => ({ callBotApi: mockCallBotApi }));

const { POST } = await import(
  "../../../web/src/routes/api/art/jobs/[jobId]/upload/+server.js"
);

const SERVER_ARTIST = "896070888749940770";
const smStaff = { id: "u1", tier: "sm" as const, roles: [] };
const artistViewer = {
  id: "u2",
  tier: "viewer" as const,
  roles: [SERVER_ARTIST],
};
const plainViewer = { id: "u3", tier: "viewer" as const, roles: [] };

// 1x1 transparent PNG. Real sharp can read this.
const ONE_BY_ONE_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

beforeEach(() => {
  mockMkdir.mockClear();
  mockWriteFile.mockClear();
  mockCallBotApi.mockReset();
  mockCallBotApi.mockResolvedValue({ success: true, data: {} });
});

function fileEvent(opts: {
  user?: typeof smStaff | typeof artistViewer | typeof plainViewer | null;
  jobId?: string;
  formData?: FormData;
  body?: BodyInit;
}) {
  const url = new URL(
    `http://localhost/api/art/jobs/${opts.jobId ?? "7"}/upload`,
  );
  let body: BodyInit | null;
  if (opts.body !== undefined) {
    body = opts.body;
  } else if (opts.formData !== undefined) {
    body = opts.formData;
  } else {
    body = null;
  }
  const request = new Request(url, { method: "POST", body });

  const locals: App.Locals = {} as App.Locals;
  if (opts.user) (locals as { user: unknown }).user = opts.user;

  return {
    locals,
    request,
    url,
    params: { jobId: opts.jobId ?? "7" },
    route: { id: null },
    cookies: { get: () => undefined } as never,
    fetch: globalThis.fetch as never,
    getClientAddress: () => "127.0.0.1",
    platform: undefined,
    setHeaders: () => undefined,
    isDataRequest: false,
    isSubRequest: false,
  } as unknown as Parameters<typeof POST>[0];
}

function buildForm(file?: File): FormData {
  const fd = new FormData();
  if (file) fd.append("file", file);
  return fd;
}

function makeFile(opts: {
  bytes?: Uint8Array | Buffer;
  name?: string;
  type?: string;
  size?: number;
}): File {
  let bytes: Uint8Array;
  if (opts.size !== undefined) {
    bytes = new Uint8Array(opts.size);
  } else if (opts.bytes !== undefined) {
    bytes = opts.bytes instanceof Buffer ? new Uint8Array(opts.bytes) : opts.bytes;
  } else {
    bytes = new Uint8Array(ONE_BY_ONE_PNG);
  }
  return new File([bytes], opts.name ?? "test.png", {
    type: opts.type ?? "image/png",
  });
}

describe("POST /api/art/jobs/[jobId]/upload", () => {
  it("401 when locals.user is absent", async () => {
    await expect(
      POST(fileEvent({ user: null, formData: buildForm(makeFile({})) })),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("403 when below sm AND no SERVER_ARTIST role", async () => {
    await expect(
      POST(
        fileEvent({
          user: plainViewer,
          formData: buildForm(makeFile({})),
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("400 when jobId is non-numeric", async () => {
    await expect(
      POST(
        fileEvent({
          user: smStaff,
          jobId: "abc",
          formData: buildForm(makeFile({})),
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when jobId is zero", async () => {
    await expect(
      POST(
        fileEvent({
          user: smStaff,
          jobId: "0",
          formData: buildForm(makeFile({})),
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when no file in form", async () => {
    await expect(
      POST(fileEvent({ user: smStaff, formData: buildForm() })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("400 when mime not in allowlist (text/plain)", async () => {
    const file = makeFile({ type: "text/plain", name: "evil.txt" });
    await expect(
      POST(fileEvent({ user: smStaff, formData: buildForm(file) })),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("400 when file size exceeds 8 MB", async () => {
    const file = makeFile({ size: 8 * 1024 * 1024 + 1 });
    await expect(
      POST(fileEvent({ user: smStaff, formData: buildForm(file) })),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("400 when bytes are not a valid image (sharp throws)", async () => {
    const file = makeFile({
      bytes: new Uint8Array([1, 2, 3, 4]),
      type: "image/png",
    });
    await expect(
      POST(fileEvent({ user: smStaff, formData: buildForm(file) })),
    ).rejects.toMatchObject({ status: 400 });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("200 happy path (real 1x1 PNG): mkdir + writeFile + callBotApi forward thumbnail URL", async () => {
    const res = await POST(
      fileEvent({ user: smStaff, formData: buildForm(makeFile({})) }),
    );
    expect(res.status).toBe(200);
    expect(mockMkdir).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);

    const botCall = mockCallBotApi.mock.calls[0];
    expect(botCall[0]).toBe("/api/art/jobs/thumbnail");
    expect(botCall[1]).toMatchObject({
      userId: "u1",
      tier: "sm",
      jobId: 7,
    });
    expect(botCall[1].thumbnailUrl).toMatch(
      /^\/api\/art\/uploads\/7\/\d+\.webp$/,
    );

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.thumbnailUrl).toMatch(/^\/api\/art\/uploads\/7\//);
  });

  it("200 artist (viewer + SERVER_ARTIST role) can upload", async () => {
    const res = await POST(
      fileEvent({
        user: artistViewer,
        formData: buildForm(makeFile({})),
      }),
    );
    expect(res.status).toBe(200);
    const botCall = mockCallBotApi.mock.calls[0];
    expect(botCall[1].userId).toBe("u2");
    expect(botCall[1].tier).toBe("viewer");
  });

  it("403 when bot error includes 'own'", async () => {
    mockCallBotApi.mockResolvedValueOnce({
      success: false,
      error: "Artists can only upload to their own jobs",
    });
    const res = await POST(
      fileEvent({
        user: artistViewer,
        formData: buildForm(makeFile({})),
      }),
    );
    expect(res.status).toBe(403);
  });
});
