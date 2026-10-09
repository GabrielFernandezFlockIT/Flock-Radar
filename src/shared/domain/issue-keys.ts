/**
 * Finds issue keys (`BCN-123`) referenced in free text: PR titles, branch
 * names, commit messages, comment bodies.
 *
 * - Uppercase only, like Jira keys: `bcn-123` or `api-2` in prose are not
 *   treated as references (common words would otherwise match).
 * - Only keys whose project part is in `knownProjectKeys` are returned, which
 *   filters look-alikes such as `UTF-8`, `SHA-256`, or `ISO-8601`.
 * - A key must not be glued to other letters or digits (`XBCN-1`, `BCN-12a`).
 * - Results are unique and keep first-occurrence order; leading zeros in the
 *   number are normalized (`BCN-007` -> `BCN-7`).
 */
export function extractIssueKeys(
  text: string,
  knownProjectKeys: readonly string[],
): string[] {
  if (!text || knownProjectKeys.length === 0) return [];

  const known = new Set(knownProjectKeys);
  const pattern = /(^|[^A-Za-z0-9])([A-Z][A-Z0-9]+)-(\d+)(?![A-Za-z0-9])/g;
  const keys: string[] = [];
  const seen = new Set<string>();

  for (const match of text.matchAll(pattern)) {
    const projectKey = match[2];
    if (!known.has(projectKey)) continue;
    const issueNumber = Number.parseInt(match[3], 10);
    if (issueNumber <= 0) continue;
    const key = `${projectKey}-${issueNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }

  return keys;
}
