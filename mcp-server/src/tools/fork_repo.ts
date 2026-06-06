import { z } from "zod";
import { Octokit } from "@octokit/rest";

export const ForkRepoSchema = z.object({
  repo: z
    .string()
    .describe(
      'Upstream GitHub repository in owner/repo format (e.g. "octocat/Hello-World")'
    ),
});

export type ForkRepoInput = z.infer<typeof ForkRepoSchema>;

export interface ForkRepoResult {
  upstream: string;
  fork: string;
  status: "created" | "already_exists";
  htmlUrl: string;
  defaultBranch: string;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_RETRIES = 15;

function getBotOctokit(): Octokit {
  return new Octokit({
    auth: process.env.GITHUB_BOT_TOKEN || undefined,
  });
}

function parseRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new Error(
      `Invalid repo format "${repo}". Expected "owner/repo".`
    );
  }
  return { owner, name };
}

function requireBotToken(): void {
  if (!process.env.GITHUB_BOT_TOKEN) {
    throw new Error(
      "GITHUB_BOT_TOKEN is required to fork a repository. Set it in mcp-server/.env."
    );
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status: number }).status === 404
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toResult(
  upstream: string,
  fork: {
    full_name?: string | null;
    html_url?: string | null;
    default_branch?: string | null;
  },
  status: ForkRepoResult["status"]
): ForkRepoResult {
  if (!fork.full_name || !fork.html_url) {
    throw new Error("GitHub returned an incomplete fork response.");
  }

  return {
    upstream,
    fork: fork.full_name,
    status,
    htmlUrl: fork.html_url,
    defaultBranch: fork.default_branch ?? "main",
  };
}

export function formatForkRepoResult(result: ForkRepoResult): string {
  return `Fork ready: ${result.fork}
- Upstream: ${result.upstream}
- Status: ${result.status}
- Default branch: ${result.defaultBranch}
- URL: ${result.htmlUrl}`;
}

async function waitForForkReady(
  octokit: Octokit,
  botUsername: string,
  repoName: string,
  upstream: string
) {
  for (let attempt = 0; attempt < MAX_POLL_RETRIES; attempt++) {
    try {
      return await octokit.repos.get({
        owner: botUsername,
        repo: repoName,
      });
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      if (attempt === MAX_POLL_RETRIES - 1) {
        throw new Error(
          `Timed out waiting for fork of "${upstream}" to become ready after ${MAX_POLL_RETRIES} attempts.`
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  throw new Error(
    `Timed out waiting for fork of "${upstream}" to become ready after ${MAX_POLL_RETRIES} attempts.`
  );
}

export async function forkRepo(input: ForkRepoInput): Promise<string> {
  requireBotToken();

  const octokit = getBotOctokit();
  const { owner, name } = parseRepo(input.repo);
  const upstream = `${owner}/${name}`;

  const { data: user } = await octokit.users.getAuthenticated();
  const botUsername = user.login;

  try {
    const { data: existing } = await octokit.repos.get({
      owner: botUsername,
      repo: name,
    });
    return formatForkRepoResult(toResult(upstream, existing, "already_exists"));
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }

  await octokit.repos.createFork({
    owner,
    repo: name,
  });

  const { data: ready } = await waitForForkReady(
    octokit,
    botUsername,
    name,
    upstream
  );

  return formatForkRepoResult(toResult(upstream, ready, "created"));
}
