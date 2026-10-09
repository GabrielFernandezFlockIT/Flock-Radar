import {
  shortSha,
  type Commit,
  type Evidence,
  type Issue,
  type IssueEvent,
  type Project,
  type PullRequest,
  type Sprint,
} from "@/shared/domain";

/**
 * Evidence builders: every detector points at the concrete records behind
 * its numbers. URLs always come from the records themselves (or, for
 * sprints and worklog tabs, from the tracker origin of those records), never
 * from free text.
 */

export function issueEvidence(issue: Issue, label?: string): Evidence {
  return {
    sourceType: "jira_issue",
    externalId: issue.key,
    url: issue.url,
    occurredAt: issue.updatedAt,
    ...(label ? { label } : {}),
  };
}

/** A changelog entry (status, resolution, sprint, or estimate change). */
export function issueChangeEvidence(
  issue: Issue,
  event: IssueEvent,
  label: string,
): Evidence {
  return {
    sourceType: "jira_transition",
    externalId: `${issue.key}#${event.externalId}`,
    url: issue.url,
    occurredAt: event.at,
    label,
  };
}

export function pullRequestEvidence(pr: PullRequest, label?: string): Evidence {
  return {
    sourceType: "github_pr",
    externalId: `#${pr.number}`,
    url: pr.url,
    occurredAt: pr.createdAt,
    ...(label ? { label } : {}),
  };
}

export function commitEvidence(commit: Commit, label?: string): Evidence {
  const firstLine = commit.message.split("\n")[0].trim().slice(0, 80);
  const text = label ?? firstLine;
  return {
    sourceType: "github_commit",
    externalId: shortSha(commit.sha),
    url: commit.url,
    occurredAt: commit.committedAt,
    ...(text ? { label: text } : {}),
  };
}

/** Jira's worklog tab of an issue: aggregates hours logged on it. */
export function worklogEvidence(
  issue: Issue,
  lastLoggedAt: string,
  label: string,
): Evidence {
  const url = new URL(issue.url);
  url.searchParams.set(
    "page",
    "com.atlassian.jira.plugin.system.issuetabpanels:worklog-tabpanel",
  );
  return {
    sourceType: "jira_worklog",
    externalId: `${issue.key} worklogs`,
    url: url.toString(),
    occurredAt: lastLoggedAt,
    label,
  };
}

/**
 * The sprint report on the project's board. Needs a board id and one issue
 * URL to learn the tracker origin; returns `null` otherwise (sprints carry
 * no URL of their own).
 */
export function sprintEvidence(
  sprint: Sprint,
  project: Project,
  issues: readonly Issue[],
  label?: string,
): Evidence | null {
  const sample = issues[0];
  if (!project.boardId || !sample) return null;
  const url = new URL("/secure/RapidBoard.jspa", new URL(sample.url).origin);
  url.searchParams.set("rapidView", project.boardId);
  url.searchParams.set("view", "reporting");
  url.searchParams.set("chart", "sprintRetrospective");
  url.searchParams.set("sprint", sprint.externalId);
  return {
    sourceType: "jira_sprint",
    externalId: sprint.name,
    url: url.toString(),
    occurredAt: sprint.startAt,
    ...(label ? { label } : {}),
  };
}
