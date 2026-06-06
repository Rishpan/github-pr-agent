import { z } from "zod";
import { Octokit } from "@octokit/rest";
import { logger } from "../logger.js";

export const ListIssuesSchema = z.object({
  repo: z
    .string()
    .describe('Upstream GitHub repository in owner/repo format (e.g. "facebook/react")'),
  label: z
    .string()
    .optional()
    .describe('Optional label filter (e.g. "good-first-issue")'),
});

export type ListIssuesInput = z.infer<typeof ListIssuesSchema>;

export class ListIssuesError extends Error {
  readonly repo: string;
  readonly label?: string;

  constructor(
    repo: string,
    message: string,
    options?: ErrorOptions & { label?: string }
  ) {
    super(message, options);
    this.name = "ListIssuesError";
    this.repo = repo;
    this.label = options?.label;
  }
}

function getOctokit(): Octokit {
  return new Octokit({
    auth: process.env.GITHUB_TOKEN || undefined,
  });
}

function parseRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new ListIssuesError(
      repo,
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

function formatIssueBlock(issue: {
  number: number;
  title?: string | null;
  html_url: string;
  labels?: (
    | string
    | { name?: string | null | undefined }
  )[];
}): string {
  const number = issue.number;
  const title = issue.title ?? "";
  const url = issue.html_url;
  const labels = formatLabels(issue.labels);

  return `#${number} — ${title}
URL: ${url}
Labels: ${labels}`;
}

export async function listIssues(input: ListIssuesInput): Promise<string> {
  const log = logger.child({ tool: "list_issues" });
  const { repo, label } = input;

  log.info({ repo, label }, "list_issues_start");

  const { owner, name } = parseRepo(repo);
  const octokit = getOctokit();

  try {
    const { data: items } = await octokit.issues.list({
      owner,
      repo: name,
      state: "open",
      labels: label,
      per_page: 10,
    });

    const issues = items.filter((item) => !item.pull_request);

    if (issues.length === 0) {
      const emptyMessage = label
        ? `No open issues found for ${repo} with label ${label}`
        : `No open issues found for ${repo}`;
      log.info({ repo, label, count: 0 }, "list_issues_success");
      return emptyMessage;
    }

    const header = label
      ? `Open issues for ${repo} (label: ${label}):`
      : `Open issues for ${repo}:`;

    const body = issues.map(formatIssueBlock).join("\n\n---\n\n");

    log.info({ repo, label, count: issues.length }, "list_issues_success");

    return `${header}

${body}

---`;
  } catch (error) {
    if (error instanceof ListIssuesError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ListIssuesError(repo, message, { cause: error, label });
  }
}
