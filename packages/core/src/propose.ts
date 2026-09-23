import { ScillaError } from "./errors.ts";
import { git } from "./git.ts";
import { acceptReview, REVIEW_FILE, type Accepted, type ReferenceStatus } from "./review.ts";

/** The branch `scilla review propose` commits to; each run resets it onto the current branch. */
export const REVIEW_BRANCH = "scilla/review-updates";

export interface CommitMessage {
  readonly subject: string;
  readonly body: string;
}

export interface Proposal {
  /** The branch the proposal was made from, which its pull request targets. */
  readonly base: string;
  readonly branch: string;
  /** The proposal's commit. */
  readonly commit: string;
  readonly accepted: readonly Accepted[];
}

const currentBranch = async (dir: string) => {
  const branch = await git(["rev-parse", "--abbrev-ref", "HEAD"], dir);

  if (branch === "HEAD") {
    throw new ScillaError(
      "HEAD is detached. Check out the branch the pull request should target first.",
    );
  }

  return branch;
};

/**
 * In the git checkout of a Collection at `dir`: reset `scilla/review-updates` onto the current
 * branch, record the upstream commits of `accept` as reviewed there, commit only
 * `scilla-review.json`, and switch back. Other uncommitted changes are left as they are.
 */
export const commitProposal = async (
  dir: string,
  all: readonly ReferenceStatus[],
  accept: readonly ReferenceStatus[],
  message: (accepted: readonly Accepted[]) => CommitMessage,
): Promise<Proposal> => {
  const base = await currentBranch(dir);

  if ((await git(["status", "--porcelain", "--", REVIEW_FILE], dir)) !== "") {
    throw new ScillaError(`${REVIEW_FILE} has uncommitted changes; commit or stash them first.`);
  }

  await git(["checkout", "--quiet", "-B", REVIEW_BRANCH], dir);

  try {
    const accepted = await acceptReview(dir, all, accept);
    const { subject, body } = message(accepted);

    await git(["add", "--", REVIEW_FILE], dir);
    await git(["commit", "--quiet", "--message", subject, "--message", body], dir);

    return { base, branch: REVIEW_BRANCH, commit: await git(["rev-parse", "HEAD"], dir), accepted };
  } finally {
    await git(["checkout", "--quiet", base], dir);
  }
};

/** Push the proposal branch to `origin`, replacing what an earlier run pushed there. */
export const pushProposal = (dir: string, branch: string) =>
  git(["push", "--quiet", "--force", "origin", `${branch}:${branch}`], dir);

/** The URL of the checkout's `origin` remote. */
export const originUrl = (dir: string) => git(["remote", "get-url", "origin"], dir);
