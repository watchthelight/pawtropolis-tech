/**
 * Cookie-based session management with AES-256-GCM encryption.
 * Session data (including OAuth tokens) is encrypted before being stored in the cookie.
 */

import { type Cookies } from "@sveltejs/kit";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import type { DashboardTier } from "./roles";
import { getSessionSecret } from "./env";

const SESSION_COOKIE = "pawtropolis_session";
const MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const ALGORITHM = "aes-256-gcm";

/** Derive a 32-byte encryption key from the session secret (lazy) */
let _encryptionKey: Buffer | undefined;
function getEncryptionKey(): Buffer {
  return (_encryptionKey ??= createHash("sha256").update(getSessionSecret()).digest());
}

export interface SessionData {
  userId: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
  banner: string | null;
  accentColor: number | null;
  avatarUrl: string;
  bannerUrl: string | null;
  tier: DashboardTier;
  roles: string[];
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(encoded: string): string | null {
  try {
    const buf = Buffer.from(encoded, "base64");
    if (buf.length < 28) return null; // 12 (iv) + 16 (tag) minimum
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function setSession(cookies: Cookies, data: SessionData): void {
  const encrypted = encrypt(JSON.stringify(data));
  cookies.set(SESSION_COOKIE, encrypted, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: MAX_AGE,
  });
}

export function getSession(cookies: Cookies): SessionData | null {
  const raw = cookies.get(SESSION_COOKIE);
  if (!raw) return null;

  // Try encrypted format first
  const decrypted = decrypt(raw);
  if (decrypted) {
    try {
      return JSON.parse(decrypted) as SessionData;
    } catch {
      return null;
    }
  }

  // Fallback: try reading as plain JSON (pre-encryption sessions)
  // These will be re-encrypted on next setSession call
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export function clearSession(cookies: Cookies): void {
  cookies.delete(SESSION_COOKIE, { path: "/" });
}
