// Mints a pawtropolis_session cookie value matching src/lib/server/session.ts
// (AES-256-GCM, key = sha256(SESSION_SECRET), payload = base64(iv|tag|ciphertext)).
const { createCipheriv, createHash, randomBytes } = require('node:crypto');

const SECRET = process.env.SESSION_SECRET || 'dev-local-session-secret-pawtropolis-observatory';
const key = createHash('sha256').update(SECRET).digest();

function encrypt(plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

const session = {
  userId: '1156287207997444156',
  username: 'cassiopeia',
  globalName: 'Cassiopeia',
  avatar: null,
  banner: null,
  accentColor: 0x5BA86E,
  avatarUrl: '/paw-logo.png',
  bannerUrl: null,
  tier: process.argv[2] || 'owner',
  roles: [],
  accessToken: 'dev',
  refreshToken: 'dev',
  expiresAt: Date.now() + 7 * 24 * 3600 * 1000
};

process.stdout.write(encrypt(JSON.stringify(session)));
