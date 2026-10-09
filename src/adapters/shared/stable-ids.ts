import { createHash } from "node:crypto";

/**
 * Deterministic identifiers derived from names, for adapters that must map
 * external ids (Jira sprint ids, demo records) to stable UUIDs.
 */

/** Fixed namespace for Flock-Radar's name-based UUIDs. Never change it. */
const RADAR_NAMESPACE = "3f6c1d2e-8b4a-4f0e-9a51-7c2d9e4b1a60";

function sha1(namespace: string, name: string): Buffer {
  return createHash("sha1")
    .update(Buffer.from(namespace.replaceAll("-", ""), "hex"))
    .update(name, "utf8")
    .digest();
}

/**
 * RFC 4122 version-5 style UUID (SHA-1 of namespace + name). Parts are joined
 * with a separator that cannot appear in normal ids, so `("a", "bc")` and
 * `("ab", "c")` never collide.
 */
export function stableUuid(...parts: readonly string[]): string {
  const bytes = sha1(RADAR_NAMESPACE, parts.join("\u001f")).subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/** Deterministic 40-character hex string, shaped like a git commit SHA. */
export function stableSha(...parts: readonly string[]): string {
  return sha1(RADAR_NAMESPACE, `sha\u001f${parts.join("\u001f")}`).toString(
    "hex",
  );
}
