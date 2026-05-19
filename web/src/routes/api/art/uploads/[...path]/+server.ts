import { error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const UPLOADS_DIR = process.env.ART_UPLOADS_DIR ?? join(process.cwd(), "data", "art-uploads");

export const GET: RequestHandler = async ({ params }) => {
  // params.path is like "42/1234567890.webp"
  const parts = (params.path ?? "").split("/");

  // Strictly enforce: exactly 2 segments, numeric job ID, safe filename
  if (parts.length !== 2) error(404, "Not found");

  const [jobSegment, filename] = parts;
  if (!/^\d+$/.test(jobSegment)) error(404, "Not found");
  if (!/^[\w.-]+$/.test(filename) || filename.includes("..")) error(404, "Not found");

  const filePath = join(UPLOADS_DIR, jobSegment, filename);

  let fileBytes: ArrayBuffer;
  try {
    const buf = await readFile(filePath);
    fileBytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  } catch {
    error(404, "File not found");
  }

  // All our uploads are WebP (processed by sharp)
  return new Response(fileBytes, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
