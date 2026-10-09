import {
  shortSha,
  type Commit,
  type DocRef,
  type Evidence,
  type Issue,
  type IssueComment,
  type PullRequest,
} from "@/shared/domain";

/**
 * Evidence builders for memory items. Every URL comes from the record itself,
 * never from free text, so an evidence chip can only ever link to something
 * the pipeline actually read.
 *
 * These mirror `@/modules/forecast/domain/evidence` for the record types both
 * modules cite. They are intentionally not shared: the forecast builders are
 * tuned to detector labels, and a shared helper would make the two modules
 * move together for no gain. The duplication is four small functions.
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

export function commentEvidence(comment: IssueComment, label?: string): Evidence {
  return {
    sourceType: "jira_comment",
    externalId: `${comment.issueKey} comment ${comment.id}`,
    url: comment.url,
    occurredAt: comment.createdAt,
    ...(label ? { label } : {}),
  };
}

export function docEvidence(doc: DocRef, label?: string): Evidence {
  return {
    sourceType: "doc",
    externalId: doc.slug,
    url: doc.url,
    occurredAt: doc.updatedAt,
    ...(label ? { label } : {}),
  };
}
