import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { hasMinTier, ROLE_IDS } from "$lib/server/roles";
import { callBotApi } from "$lib/server/botApi";
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import sharp from "sharp";

// One decode at a time and no libvips operation cache: a burst of uploads would otherwise
// take several hundred MB in the web process.
sharp.concurrency(1);
sharp.cache(false);

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const UPLOADS_DIR = process.env.ART_UPLOADS_DIR ?? join(process.cwd(), "data", "art-uploads");

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.user) error(401, "Not authenticated");

  const isStaff = hasMinTier(locals.user.tier, "sm");
  const isArtist = (locals.user.roles ?? []).includes(ROLE_IDS.SERVER_ARTIST);
  if (!isStaff && !isArtist) error(403, "Insufficient permissions");

  const jobId = parseInt(params.jobId, 10);
  if (isNaN(jobId) || jobId <= 0) error(400, "Invalid job ID");

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    error(400, "Invalid form data");
  }

  const file = formData.get("file") as File | null;
  if (!file || !(file instanceof File)) error(400, "No file provided");
  if (!ALLOWED_MIME.has(file.type)) error(400, "Only JPEG, PNG, GIF, and WebP images are allowed");
  if (file.size > MAX_FILE_SIZE) error(400, "File exceeds 8 MB limit");

  const buffer = Buffer.from(await file.arrayBuffer());

  // Process with sharp: resize to max 800px wide, convert to WebP
  let outputBuffer: Buffer;
  let isAnimated = false;
  try {
    const meta = await sharp(buffer, { animated: true }).metadata();
    isAnimated = (meta.pages ?? 1) > 1;

    if (isAnimated) {
      // Preserve GIF animation — just resize, keep as webp animated
      outputBuffer = await sharp(buffer, { animated: true })
        .resize({ width: 800, withoutEnlargement: true })
        .webp({ quality: 85, effort: 3 })
        .toBuffer();
    } else {
      outputBuffer = await sharp(buffer)
        .resize({ width: 800, withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
    }
  } catch {
    error(400, "Failed to process image — ensure it is a valid image file");
  }

  // Write to disk: data/art-uploads/{jobId}/{timestamp}.webp
  const jobDir = join(UPLOADS_DIR, String(jobId));
  await mkdir(jobDir, { recursive: true });

  const filename = `${Date.now()}.webp`;
  const filePath = join(jobDir, filename);
  await writeFile(filePath, outputBuffer);

  // Relative URL for storage in DB
  const thumbnailUrl = `/api/art/uploads/${jobId}/${filename}`;

  // Call bot API to persist thumbnail_url to DB
  const result = await callBotApi("/api/art/jobs/thumbnail", {
    userId: locals.user.id,
    tier: locals.user.tier,
    jobId,
    thumbnailUrl,
  });

  if (!result.success) {
    return json(result, { status: result.error?.includes("own") ? 403 : 400 });
  }

  return json({ success: true, data: { thumbnailUrl } });
};
