import { randomBytes } from "node:crypto";

let lastMs = -1;
let counter = 0;

/**
 * A UUIDv7: 48 bits of Unix milliseconds, a 12-bit counter, then random bits. Time-ordered, so new rows
 * land at the end of the primary-key index instead of all over it, and ids sort by creation, also within
 * one millisecond (RFC 9562's counter method: two order events written in the same millisecond keep
 * their order). (PostgreSQL 16 has no uuidv7().)
 */
export function uuidv7(now = Date.now()): string {
  const bytes = randomBytes(16);
  if (now === lastMs && counter < 0xfff) {
    counter += 1;
  } else {
    lastMs = now;
    counter = bytes.readUInt16BE(6) & 0x7ff; // a random start, with room to count up
  }
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = 0x70 | (counter >> 8); // version 7, then the counter's high bits
  bytes[7] = counter & 0xff;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 9562 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
