import { addDays, isWorkingDay, startOfUtcDay, type Commit, type Issue, type PullRequest } from "@/shared/domain";

/**
 * Record-linking helpers shared by the memory rules: who merged what, which
 * pull request closed an issue, which commit merged a pull request.
 */

/** Working days strictly after `instant`'s UTC day and strictly before `today`. */
export function fullWorkingDaysBetween(instant: string, today: Date): number {
  let count = 0;
  const end = startOfUtcDay(today).getTime();
  for (
    let cursor = addDays(startOfUtcDay(new Date(instant)), 1);
    cursor.getTime() < end;
    cursor = addDays(cursor, 1)
  ) {
    if (isWorkingDay(cursor)) count += 1;
  }
  return count;
}

export function isMerged(pr: PullRequest): boolean {
  return pr.state === "merged" && pr.mergedAt !== null;
}

/** Every pull request that references `issueKey`, oldest first. */
export function pullRequestsForIssue(
  pullRequests: readonly PullRequest[],
  issueKey: string,
): PullRequest[] {
  return pullRequests
    .filter((pr) => pr.linkedIssueKeys.includes(issueKey))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.number - b.number);
}

/** The merged pull request that closed `issueKey` (the last one merged), if any. */
export function mergedPullRequestForIssue(
  pullRequests: readonly PullRequest[],
  issueKey: string,
): PullRequest | null {
  const merged = pullRequestsForIssue(pullRequests, issueKey).filter(isMerged);
  return merged.at(-1) ?? null;
}

/** The commit a pull request was merged with, when the repository has it. */
export function mergeCommitOf(
  commits: readonly Commit[],
  pr: PullRequest,
): Commit | null {
  if (!pr.mergeCommitSha) return null;
  return commits.find((commit) => commit.sha === pr.mergeCommitSha) ?? null;
}

/** Last commit linked to `issueKey`, or `null` when the issue never had one. */
export function lastCommitForIssue(
  commits: readonly Commit[],
  issueKey: string,
): Commit | null {
  let latest: Commit | null = null;
  for (const commit of commits) {
    if (!commit.linkedIssueKeys.includes(issueKey)) continue;
    if (!latest || Date.parse(commit.committedAt) > Date.parse(latest.committedAt)) {
      latest = commit;
    }
  }
  return latest;
}

export function issuesByKey(issues: readonly Issue[]): Map<string, Issue> {
  return new Map(issues.map((issue) => [issue.key, issue]));
}
