import { z } from "zod";
import { Octokit } from "@octokit/rest";
import { logger } from "../logger.js";

export const CreateDraftPRSchema = z.object({
  repo: z
    .string()
    .describe(
      'Upstream GitHub repository for context in the PR description only (e.g. "facebook/react")'
    ),
  forkRepo: z
    .string()
    .describe(
      'Bot fork in owner/repo format (e.g. "pr-agent-demo/react")'
    ),
  branch: z
    .string()
    .describe(
      'New branch name (e.g. "fix/null-pointer-createFiber")'
    ),
  filePath: z
    .string()
    .describe(
      'Path to the file being fixed (e.g. "src/reconciler/ReactFiber.ts")'
    ),
  newContent: z
    .string()
    .describe("Complete new file content with the fix applied"),
  title: z
    .string()
    .describe(
      'PR title in conventional commits format (e.g. "fix: null check in createFiber")'
    ),
  description: z
    .string()
    .describe(
      "PR body explaining bug, cause, fix, and issue reference"
    ),
});

export type CreateDraftPRInput = z.infer<typeof CreateDraftPRSchema>;

export interface CreateDraftPRResult {
  prUrl: string;
  branch: string;
  filePath: string;
  prNumber: number;
}

export class CreateDraftPRError extends Error {
  readonly step: string;

  constructor(step: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CreateDraftPRError";
    this.step = step;
  }
}

function getBotOctokit(): Octokit {
  return new Octokit({
    auth: process.env.GITHUB_BOT_TOKEN || undefined,
  });
}

function parseRepo(
  repo: string,
  fieldName: string
): { owner: string; name: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) {
    throw new CreateDraftPRError(
      "parse_input",
      `Invalid ${fieldName} format "${repo}". Expected "owner/repo".`
    );
  }
  return { owner, name };
}

function requireBotToken(): void {
  if (!process.env.GITHUB_BOT_TOKEN) {
    throw new CreateDraftPRError(
      "authenticate",
      "GITHUB_BOT_TOKEN is required to create a draft PR. Set it in mcp-server/.env."
    );
  }
}

async function runStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof CreateDraftPRError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CreateDraftPRError(step, message, { cause: error });
  }
}

export function formatCreateDraftPRResult(result: CreateDraftPRResult): string {
  return `Draft PR opened: ${result.prUrl}
- Branch: ${result.branch}
- File: ${result.filePath}
- PR number: ${result.prNumber}`;
}

export async function createDraftPR(
  input: CreateDraftPRInput
): Promise<string> {
  const log = logger.child({ tool: "create_draft_pr" });
  requireBotToken();

  const octokit = getBotOctokit();
  const { owner: forkOwner, name: forkName } = parseRepo(
    input.forkRepo,
    "forkRepo"
  );

  log.info(
    {
      repo: input.repo,
      forkRepo: input.forkRepo,
      branch: input.branch,
      filePath: input.filePath,
      title: input.title,
    },
    "create_draft_pr_start"
  );

  log.info({ forkRepo: input.forkRepo }, "get_default_branch_ref_start");
  const { defaultBranch, baseSha } = await runStep(
    "get_default_branch_ref",
    async () => {
      const { data: forkMeta } = await octokit.repos.get({
        owner: forkOwner,
        repo: forkName,
      });
      const defaultBranch = forkMeta.default_branch ?? "main";
      const { data: ref } = await octokit.git.getRef({
        owner: forkOwner,
        repo: forkName,
        ref: `heads/${defaultBranch}`,
      });
      return { defaultBranch, baseSha: ref.object.sha };
    }
  );
  log.info(
    { forkRepo: input.forkRepo, defaultBranch, baseSha },
    "get_default_branch_ref_success"
  );

  log.info(
    { forkRepo: input.forkRepo, branch: input.branch, baseSha },
    "create_branch_start"
  );
  await runStep("create_branch", async () => {
    await octokit.git.createRef({
      owner: forkOwner,
      repo: forkName,
      ref: `refs/heads/${input.branch}`,
      sha: baseSha,
    });
  });
  log.info(
    { forkRepo: input.forkRepo, branch: input.branch },
    "create_branch_success"
  );

  log.info(
    { forkRepo: input.forkRepo, filePath: input.filePath },
    "get_file_blob_start"
  );
  const fileSha = await runStep("get_file_blob", async () => {
    const { data: content } = await octokit.repos.getContent({
      owner: forkOwner,
      repo: forkName,
      path: input.filePath,
      ref: defaultBranch,
    });

    if (Array.isArray(content) || content.type !== "file" || !content.sha) {
      throw new Error(`Path "${input.filePath}" is not a file in the fork.`);
    }

    return content.sha;
  });
  log.info(
    { forkRepo: input.forkRepo, filePath: input.filePath, fileSha },
    "get_file_blob_success"
  );

  log.info(
    {
      forkRepo: input.forkRepo,
      branch: input.branch,
      filePath: input.filePath,
    },
    "commit_file_start"
  );
  await runStep("commit_file", async () => {
    await octokit.repos.createOrUpdateFileContents({
      owner: forkOwner,
      repo: forkName,
      path: input.filePath,
      message: input.title,
      content: Buffer.from(input.newContent, "utf-8").toString("base64"),
      sha: fileSha,
      branch: input.branch,
    });
  });
  log.info(
    {
      forkRepo: input.forkRepo,
      branch: input.branch,
      filePath: input.filePath,
    },
    "commit_file_success"
  );

  log.info(
    { forkRepo: input.forkRepo, branch: input.branch, base: defaultBranch },
    "open_draft_pr_start"
  );
  const pr = await runStep("open_draft_pr", async () => {
    const { data: pullRequest } = await octokit.pulls.create({
      owner: forkOwner,
      repo: forkName,
      title: input.title,
      body: input.description,
      head: input.branch,
      base: defaultBranch,
      draft: true,
    });

    if (!pullRequest.html_url || !pullRequest.number) {
      throw new Error("GitHub returned an incomplete pull request response.");
    }

    return pullRequest;
  });
  log.info(
    {
      forkRepo: input.forkRepo,
      prUrl: pr.html_url,
      prNumber: pr.number,
    },
    "open_draft_pr_success"
  );

  const result: CreateDraftPRResult = {
    prUrl: pr.html_url!,
    branch: input.branch,
    filePath: input.filePath,
    prNumber: pr.number,
  };

  log.info(result, "create_draft_pr_success");
  return formatCreateDraftPRResult(result);
}
