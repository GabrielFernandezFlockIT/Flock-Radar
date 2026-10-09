/**
 * Deterministic memory item ids.
 *
 * The repository keys memory items by `id`, so re-running the memory pipeline
 * must produce the SAME id for the same fact, otherwise every run duplicates
 * the project's history. The id is derived from `(projectId, kind, primary
 * record key)` with a pure hash: no randomness, no clock, no `node:crypto`
 * (the domain layer stays runtime-agnostic, so this also runs on the Edge).
 *
 * The output is shaped like an RFC 4122 version-5 UUID (version nibble `5`,
 * variant bits `10`) so it passes `UuidSchema` and the Postgres `uuid` column
 * in live mode. It is NOT a real SHA-1 UUID: collision resistance here only
 * has to separate the handful of records of one project.
 */

/** Byte separator that cannot appear in ids, so ("a","bc") !== ("ab","c"). */
const SEPARATOR = "\u001f";

/** Fixed namespace for Flock-Radar memory ids. Never change it: ids would churn. */
const NAMESPACE = "radar.memory.v1";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a over the UTF-16 code units of `input`, seeded, as 32 unsigned bits. */
function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

function hex8(value: number): string {
  return (value >>> 0).toString(16).padStart(8, "0");
}

/**
 * 128 bits from four differently seeded FNV-1a passes over the same input.
 * Each pass also mixes its index into the seed, so the four words differ.
 */
function digest(input: string): string {
  let words = "";
  for (let round = 0; round < 4; round += 1) {
    words += hex8(fnv1a(`${round}${SEPARATOR}${input}`, FNV_OFFSET + round * FNV_PRIME));
  }
  return words;
}

/** Stable UUID-shaped id for `parts`; identical input always yields it again. */
export function memoryItemId(...parts: readonly string[]): string {
  const hex = digest([NAMESPACE, ...parts].join(SEPARATOR));
  const version = `5${hex.slice(13, 16)}`;
  const variantNibble = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const variant = `${variantNibble}${hex.slice(17, 20)}`;
  return [hex.slice(0, 8), hex.slice(8, 12), version, variant, hex.slice(20, 32)].join("-");
}
