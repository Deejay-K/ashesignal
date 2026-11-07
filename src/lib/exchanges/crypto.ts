// AES-256-GCM encryption for exchange API keys at rest. The key comes from EXCHANGE_KEY_SECRET
// (any long random string); without it exchange accounts are disabled.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const EXCHANGE_KEYS_ENABLED = () => Boolean(process.env.EXCHANGE_KEY_SECRET && process.env.EXCHANGE_KEY_SECRET.length >= 16);

function key() {
  return createHash("sha256").update(process.env.EXCHANGE_KEY_SECRET ?? "").digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

export function decrypt(blob: string): string {
  const [iv, tag, data] = blob.split(".");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}
