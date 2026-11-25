import { createHash, randomBytes } from "node:crypto";

/** 256 random bits, URL-safe (43 characters). Session cookies and emailed links. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored as SHA-256: they're random, so a slow hash adds nothing, and a leaked table is useless. */
export function hashToken(token: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash("sha256").update(token).digest());
}
