/**
 * VAPID key management for Web Push authentication.
 * Lazy getters — same pattern as $lib/server/env.ts.
 *
 * Generate keys: npx web-push generate-vapid-keys
 */

let _publicKey: string | undefined;
let _privateKey: string | undefined;
let _subject: string | undefined;

export function getVapidPublicKey(): string {
  if (!_publicKey) {
    _publicKey = process.env.VAPID_PUBLIC_KEY;
    if (!_publicKey)
      throw new Error("Missing VAPID_PUBLIC_KEY — run: npx web-push generate-vapid-keys");
  }
  return _publicKey;
}

export function getVapidPrivateKey(): string {
  if (!_privateKey) {
    _privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!_privateKey)
      throw new Error("Missing VAPID_PRIVATE_KEY — run: npx web-push generate-vapid-keys");
  }
  return _privateKey;
}

export function getVapidSubject(): string {
  return (_subject ??= process.env.VAPID_SUBJECT || "https://pawtropolis.tech");
}
