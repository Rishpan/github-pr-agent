import { z } from "zod";
import { Octokit } from "@octokit/rest";
import { logger } from "../logger.js";

export const GetIssueSchema = z.object({
  repo: z
    .string()
    .describe('Upstream GitHub repository in owner/repo format (e.g. "facebook/react")'),
  issueNumber: z
    .number()
    .int()
    .positive()
    .describe("The issue number (e.g. 1234)"),
});

export type GetIssueInput = z.infer<typeof GetIssueSchema>;

export class GetIssueError extends Error {
  readonly repo: string;
  readonly issueNumber: number;

  constructor(
    repo: string,
    issueNumber: number,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "GetIssueError";
    this.repo = repo;
    this.issueNumber = issueNumber;
  }
}

function getOctokit(): Octokit {
  return new Octokit({
    auth: process.env.GITHUB_TOKEN || undefined,
  });
}

function parseRepo(repo: string, issueNumber: number): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new GetIssueError(
      repo,
      issueNumber,
      `Invalid repo format "${repo}". Expected "owner/repo".`
    );
  }
  return { owner, name };
}

function formatLabels(
  labels:
    | (
        | string
        | { name?: string | null | undefined }
      )[]
    | undefined
): string {
  const names = (labels ?? [])
    .map((label) => (typeof label === "string" ? label : label.name))
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(", ") : "none";
}

function formatComments(
  comments: { user?: { login?: string | null } | null; body?: string | null }[]
): string {
  if (comments.length === 0) {
    return "Comments (0):";
  }

  const blocks = comments.map((comment) => {
    const username = comment.user?.login ?? "unknown";
    const body = comment.body ?? "";
    return `---\n@${username}:\n${body}`;
  });

  return `Comments (${comments.length}):\n${blocks.join("\n")}\n---`;
}

export async function getIssue(input: GetIssueInput): Promise<string> {
  const log = logger.child({ tool: "get_issue" });
  const { repo, issueNumber } = input;

  log.info({ repo, issueNumber }, "get_issue_start");

  const { owner, name } = parseRepo(repo, issueNumber);
  const octokit = getOctokit();

  try {
    const [{ data: issue }, { data: comments }] = await Promise.all([
      octokit.issues.get({
        owner,
        repo: name,
        issue_number: issueNumber,
      }),
      octokit.issues.listComments({
        owner,
        repo: name,
        issue_number: issueNumber,
      }),
    ]);

    if (issue.pull_request) {
      throw new Error(`#${issueNumber} is a pull request, not an issue.`);
    }

    const title = issue.title ?? "";
    const body = issue.body ?? "";
    const labels = formatLabels(
      issue.labels as (string | { name?: string | null | undefined })[]
    );
    const state = issue.state ?? "unknown";

    log.info({ repo, issueNumber, title }, "get_issue_success");

    return `Issue #${issueNumber}: ${title}
Repo: ${repo}
Labels: ${labels}
State: ${state}

Body:
${body}

${formatComments(comments)}`;
  } catch (error) {
    if (error instanceof GetIssueError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new GetIssueError(repo, issueNumber, message, { cause: error });
  }
}
