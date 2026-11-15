/**
 * Pawtropolis Tech -- src/features/serviceKeys.ts
 * WHAT: The outside services whose keys the owner sets from Discord: which
 *       environment names each one uses, what it is for, and one test call
 *       that shows whether the service takes a key.
 * WHY: /service-keys stores a key only after the service accepted it, so a
 *      mistyped key never replaces a working one. The lookup tests go through
 *      the same adapters /investigate-artist uses, so "accepted" means the
 *      lookup itself works, not only that some endpoint answered.
 * NOTE: The SauceNAO and e621 tests have not been run against a real account:
 *       none existed when this was written. Their refusals were checked live.
 */
// SPDX-License-Identifier: LicenseRef-ANW-1.0

import sharp from "sharp";
import { getSettings, type InvestigationSettings } from "./artistInvestigation/config.js";
import { e621 } from "./artistInvestigation/provenance/e621.js";
import { saucenao } from "./artistInvestigation/provenance/saucenao.js";
import {
  LookupError,
  type LookupImage,
  type LookupService,
} from "./artistInvestigation/provenance/shared.js";
import { resumeVision, testVisionKey } from "./googleVision.js";

export type KeyTest = { ok: true } | { ok: false; reason: string };

interface KeyField {
  /** Name in the .env file and in process.env. Also the id of the form field. */
  env: string;
  label: string;
}

export interface KeyService {
  id: string;
  name: string;
  /** What the key is for, worded to follow "Used for". */
  usedFor: string;
  /** What happens while no key is stored, as a sentence. */
  without: string;
  fields: readonly KeyField[];
  /** What one test call spends, when that is worth telling the owner. */
  testCost: string | null;
  /** Values by env name. Resolves for an answer either way; throws only on a bug. */
  test(values: Record<string, string>): Promise<KeyTest>;
}

/**
 * A small picture with a pattern in it, so the answer does not hang on what a
 * service makes of a blank or one-pixel image.
 */
async function testImage(): Promise<LookupImage> {
  const size = 256;
  const pixels = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      pixels.set([x, y, x ^ y], (y * size + x) * 3);
    }
  }
  const bytes = await sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
    .jpeg({ quality: 80 })
    .toBuffer();
  return { bytes, mediaType: "image/jpeg" };
}

/** One real search through a lookup adapter. No hits is a pass: the key was taken. */
async function lookupTest(
  service: LookupService,
  keys: Partial<InvestigationSettings>
): Promise<KeyTest> {
  try {
    await service.search(await testImage(), {
      settings: { ...getSettings(), ...keys },
      pace: async () => {},
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof LookupError) return { ok: false, reason: err.message };
    throw err;
  }
}

export const KEY_SERVICES: readonly KeyService[] = [
  {
    id: "vision",
    name: "Google Vision",
    usedFor: "the avatar scan when a member joins or changes their avatar, and `/audit nsfw`",
    without: "Avatars are not scanned, and `/audit nsfw` runs but flags nobody.",
    fields: [{ env: "GOOGLE_VISION_API_KEY", label: "API key" }],
    testCost: null,
    async test(values) {
      const image = await testImage();
      const result = await testVisionKey(
        values.GOOGLE_VISION_API_KEY ?? "",
        image.bytes.toString("base64")
      );
      // Scans stop for six hours after Google refuses one. An accepted call is
      // the proof that they can run again.
      if (result.ok) resumeVision();
      return result;
    },
  },
  {
    id: "saucenao",
    name: "SauceNAO",
    usedFor: "the SauceNAO lookup in `/investigate-artist`",
    without: "`/investigate-artist` skips the SauceNAO lookup and names it as skipped.",
    fields: [{ env: "SAUCENAO_API_KEY", label: "API key" }],
    testCost: "one search of the account's daily allowance",
    test: (values) => lookupTest(saucenao, { sauceNaoApiKey: values.SAUCENAO_API_KEY ?? null }),
  },
  {
    id: "e621",
    name: "e621",
    usedFor: "the e621 lookup in `/investigate-artist`",
    without: "`/investigate-artist` skips the e621 lookup and names it as skipped.",
    fields: [
      { env: "E621_LOGIN", label: "Account name" },
      { env: "E621_API_KEY", label: "API key" },
    ],
    testCost: null,
    test: (values) =>
      lookupTest(e621, {
        e621Login: values.E621_LOGIN ?? null,
        e621ApiKey: values.E621_API_KEY ?? null,
      }),
  },
];

export function findKeyService(id: string): KeyService | null {
  return KEY_SERVICES.find((service) => service.id === id) ?? null;
}

/** The values in use right now, by env name. A blank one counts as missing. */
export function storedValues(service: KeyService): Record<string, string> {
  const values: Record<string, string> = {};
  for (const { env } of service.fields) {
    const value = process.env[env]?.trim();
    if (value) values[env] = value;
  }
  return values;
}
