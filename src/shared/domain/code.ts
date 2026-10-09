import { z } from "zod";

import {
  CommitShaSchema,
  HttpUrlSchema,
  IsoDateTimeSchema,
  IssueKeySchema,
  NonEmptyStringSchema,
  UuidSchema,
} from "./primitives";

export const PULL_REQUEST_STATES = ["open", "closed", "merged"] as const;
export const PullRequestStateSchema = z.enum(PULL_REQUEST_STATES);
export type PullRequestState = z.infer<typeof PullRequestStateSchema>;

export const PullRequestSchema = z.object({
  projectId: UuidSchema,
  /** PR number, unique per repository. */
  number: z.number().int().positive(),
  title: NonEmptyStringSchema,
  state: PullRequestStateSchema,
  author: NonEmptyStringSchema,
  createdAt: IsoDateTimeSchema,
  mergedAt: IsoDateTimeSchema.nullable(),
  firstReviewAt: IsoDateTimeSchema.nullable(),
  /** Issue keys referenced by the title, branch, or body (see `extractIssueKeys`). */
  linkedIssueKeys: z.array(IssueKeySchema),
  url: HttpUrlSchema,
  headSha: CommitShaSchema.optional(),
  mergeCommitSha: CommitShaSchema.optional(),
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

export const CommitSchema = z.object({
  projectId: UuidSchema,
  sha: CommitShaSchema,
  author: NonEmptyStringSchema,
  message: z.string(),
  committedAt: IsoDateTimeSchema,
  linkedIssueKeys: z.array(IssueKeySchema),
  url: HttpUrlSchema,
});
export type Commit = z.infer<typeof CommitSchema>;

/** Abbreviated SHA used as the human-facing evidence id. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
