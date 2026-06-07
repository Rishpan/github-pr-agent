import { z } from "zod";
import { Octokit } from "@octokit/rest";
import { logger } from "../logger.js";

const PatchEditSchema = z.object({
  search: z
    .string()
    .min(1)
    .describe(
      "Exact substring from get_file — must match exactly once when applied (include surrounding lines if needed)"
    ),
  replace: z.string().describe("Replacement text for this region"),
});

const FileChangeSchema = z.object({
  filePath: z
    .string()
    .describe('Path to the file being fixed (e.g. "package.json")'),
  edits: z
    .array(PatchEditSchema)
    .min(1)
    .max(20)
    .describe(
      "Ordered search/replace edits for this file. One item for a single change; multiple for separate regions."
    ),
});

export const CreateDraftPRSchema = z
  .object({
    repo: z
      .string()
      .describe(
        "Upstream GitHub repository (owner/repo). Used to strip upstream links from PR text."
      ),
    forkRepo: z
      .string()
      .describe('Bot fork in owner/repo format (e.g. "pr-agent-demo/react")'),
    branch: z
      .string()
      .describe('New branch name (e.g. "fix/bump-qs-dependency")'),
    fileChanges: z
      .array(FileChangeSchema)
      .min(1)
      .max(10)
      .describe(
        "Files to patch on the fork in one PR. Each entry has filePath + edits[]. Use one entry for a single-file fix."
      ),
    title: z
      .string()
      .describe('PR title in conventional commits format (e.g. "fix: bump qs")'),
    description: z
      .string()
      .describe(
        "PR body explaining bug, cause, and fix. No upstream issue numbers, URLs, or Closes/Fixes keywords."
      ),
  })
  .superRefine((data, ctx) => {
    const paths = data.fileChanges.map((c) => c.filePath);
    const dupes = paths.filter((p, i) => paths.indexOf(p) !== i);
    if (dupes.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `Duplicate filePath in fileChanges: ${[...new Set(dupes)].join(", ")}`,
      });
    }
  });

export type CreateDraftPRInput = z.infer<typeof CreateDraftPRSchema>;

export type PatchEdit = z.infer<typeof PatchEditSchema>;

export type FileChange = z.infer<typeof FileChangeSchema>;

export interface CreateDraftPRResult {
  prUrl: string;
  branch: string;
  filePaths: string[];
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

const GET_FILE_SLICE_HEADER = /^#\s*lines\s+\d+-\d+\s+of\s/m;

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip text that would show as "mentioned in" on upstream issues or link upstream. */
export function sanitizeUpstreamReferences(
  text: string,
  upstreamRepo: string
): string {
  const [upstreamOwner, upstreamName] = upstreamRepo.split("/");
  if (!upstreamOwner || !upstreamName) {
    return text.trim();
  }

  const owner = escapeRegExp(upstreamOwner);
  const name = escapeRegExp(upstreamName);

  let sanitized = text;

  sanitized = sanitized.replace(
    new RegExp(
      `https?://github\\.com/${owner}/${name}/issues/\\d+[^\\s)]*`,
      "gi"
    ),
    ""
  );
  sanitized = sanitized.replace(
    new RegExp(`https?://github\\.com/${owner}/${name}/pull/\\d+[^\\s)]*`, "gi"),
    ""
  );
  sanitized = sanitized.replace(
    new RegExp(`${owner}/${name}#\\d+`, "gi"),
    ""
  );
  sanitized = sanitized.replace(
    /\b(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s+#?\d+\b/gi,
    ""
  );
  sanitized = sanitized.replace(/\bissue\s+#?\d+\b/gi, "");
  sanitized = sanitized.replace(/#\d+\b/g, "");
  sanitized = sanitized.replace(/[ \t]+\n/g, "\n");
  sanitized = sanitized.replace(/\n{3,}/g, "\n\n").trim();

  return sanitized;
}

export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

export function assertNoSliceHeader(text: string, fieldName: string): void {
  if (GET_FILE_SLICE_HEADER.test(text)) {
    throw new CreateDraftPRError(
      "parse_input",
      `${fieldName} contains a get_file slice header — copy exact text from a full get_file result, not a line range.`
    );
  }
}

/** Normalize CRLF/CR to LF so search strings from get_file match GitHub file bytes. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Apply one search/replace on fork file content; search must match exactly once. */
export function applySingleReplacement(
  content: string,
  filePath: string,
  search: string,
  replace: string
): string {
  assertNoSliceHeader(search, "search");

  const normalizedContent = normalizeLineEndings(content);
  const normalizedSearch = normalizeLineEndings(search);
  const normalizedReplace = normalizeLineEndings(replace);

  const matches = countOccurrences(normalizedContent, normalizedSearch);
  if (matches === 0) {
    throw new CreateDraftPRError(
      "apply_patch",
      `search string not found in "${filePath}". Copy the exact substring from get_file on the fork (including quotes and whitespace).`
    );
  }
  if (matches > 1) {
    throw new CreateDraftPRError(
      "apply_patch",
      `search string matched ${matches} times in "${filePath}". Include more surrounding lines so the match is unique.`
    );
  }

  return normalizedContent.replace(normalizedSearch, normalizedReplace);
}

/** Apply ordered edits anywhere in the file; each search must match exactly once at apply time. */
export function applyReplacements(
  content: string,
  filePath: string,
  edits: PatchEdit[]
): string {
  let result = content;
  for (let i = 0; i < edits.length; i++) {
    const { search, replace } = edits[i];
    try {
      result = applySingleReplacement(result, filePath, search, replace);
    } catch (error) {
      if (error instanceof CreateDraftPRError) {
        throw new CreateDraftPRError(
          error.step,
          `Edit ${i + 1}/${edits.length}: ${error.message}`,
          { cause: error }
        );
      }
      throw error;
    }
  }
  return result;
}

export function validatePatchedContent(filePath: string, content: string): void {
  assertNoSliceHeader(content, "patched content");

  if (filePath.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch {
      throw new CreateDraftPRError(
        "validate_content",
        `Patched "${filePath}" is not valid JSON after applying the replacement.`
      );
    }
    if (/\b(function|class)\s+\w/.test(content)) {
      throw new CreateDraftPRError(
        "validate_content",
        `Patched "${filePath}" contains JavaScript-like code — wrong content was applied.`
      );
    }
  }
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

function decodeFileContent(data: {
  content?: string;
  encoding?: string;
}): string {
  if (!data.content) {
    throw new Error("GitHub returned empty file content.");
  }
  return Buffer.from(data.content, "base64").toString("utf-8");
}

export function formatCreateDraftPRResult(result: CreateDraftPRResult): string {
  const files =
    result.filePaths.length === 1
      ? result.filePaths[0]
      : result.filePaths.join(", ");
  return `Draft PR opened: ${result.prUrl}
- Branch: ${result.branch}
- Files: ${files}
- PR number: ${result.prNumber}`;
}

async function readForkFile(
  octokit: Octokit,
  forkOwner: string,
  forkName: string,
  filePath: string,
  ref: string
): Promise<{ sha: string; content: string }> {
  const { data: content } = await octokit.repos.getContent({
    owner: forkOwner,
    repo: forkName,
    path: filePath,
    ref,
  });

  if (Array.isArray(content) || content.type !== "file" || !content.sha) {
    throw new Error(`Path "${filePath}" is not a file in the fork.`);
  }

  return {
    sha: content.sha,
    content: decodeFileContent(content),
  };
}

export async function createDraftPR(
  input: CreateDraftPRInput
): Promise<string> {
  const parsed = CreateDraftPRSchema.parse(input);
  const log = logger.child({ tool: "create_draft_pr" });
  requireBotToken();

  const octokit = getBotOctokit();
  const { owner: forkOwner, name: forkName } = parseRepo(
    parsed.forkRepo,
    "forkRepo"
  );
  parseRepo(parsed.repo, "repo");

  const prTitle = sanitizeUpstreamReferences(parsed.title, parsed.repo);
  const prBody =
    sanitizeUpstreamReferences(parsed.description, parsed.repo) ||
    "Demo draft PR on bot fork.";

  log.info(
    {
      repo: parsed.repo,
      forkRepo: parsed.forkRepo,
      branch: parsed.branch,
      filePaths: parsed.fileChanges.map((c) => c.filePath),
      title: parsed.title,
    },
    "create_draft_pr_start"
  );

  log.info({ forkRepo: parsed.forkRepo }, "get_default_branch_ref_start");
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
    { forkRepo: parsed.forkRepo, defaultBranch, baseSha },
    "get_default_branch_ref_success"
  );

  log.info(
    { forkRepo: parsed.forkRepo, branch: parsed.branch, baseSha },
    "create_branch_start"
  );
  await runStep("create_branch", async () => {
    await octokit.git.createRef({
      owner: forkOwner,
      repo: forkName,
      ref: `refs/heads/${parsed.branch}`,
      sha: baseSha,
    });
  });
  log.info(
    { forkRepo: parsed.forkRepo, branch: parsed.branch },
    "create_branch_success"
  );

  const committedPaths: string[] = [];

  for (let i = 0; i < parsed.fileChanges.length; i++) {
    const { filePath, edits } = parsed.fileChanges[i];
    const label = `file ${i + 1}/${parsed.fileChanges.length} (${filePath})`;

    log.info({ forkRepo: parsed.forkRepo, filePath }, "read_fork_file_start");
    const { sha: fileSha, content: originalContent } = await runStep(
      "read_fork_file",
      async () =>
        readForkFile(octokit, forkOwner, forkName, filePath, parsed.branch)
    );
    log.info(
      { forkRepo: parsed.forkRepo, filePath, fileSha },
      "read_fork_file_success"
    );

    log.info({ forkRepo: parsed.forkRepo, filePath }, "apply_patch_start");
    let patchedContent: string;
    try {
      patchedContent = applyReplacements(originalContent, filePath, edits);
    } catch (error) {
      if (error instanceof CreateDraftPRError) {
        throw new CreateDraftPRError(
          error.step,
          `${label}: ${error.message}`,
          { cause: error }
        );
      }
      throw error;
    }
    await runStep("validate_content", async () => {
      validatePatchedContent(filePath, patchedContent);
    });
    log.info(
      { forkRepo: parsed.forkRepo, filePath },
      "apply_patch_success"
    );

    const commitMessage =
      parsed.fileChanges.length === 1
        ? prTitle
        : `${prTitle} (${filePath})`;

    log.info(
      { forkRepo: parsed.forkRepo, branch: parsed.branch, filePath },
      "commit_file_start"
    );
    await runStep("commit_file", async () => {
      await octokit.repos.createOrUpdateFileContents({
        owner: forkOwner,
        repo: forkName,
        path: filePath,
        message: commitMessage,
        content: Buffer.from(patchedContent, "utf-8").toString("base64"),
        sha: fileSha,
        branch: parsed.branch,
      });
    });
    log.info(
      { forkRepo: parsed.forkRepo, branch: parsed.branch, filePath },
      "commit_file_success"
    );
    committedPaths.push(filePath);
  }

  log.info(
    { forkRepo: parsed.forkRepo, branch: parsed.branch, base: defaultBranch },
    "open_draft_pr_start"
  );
  const pr = await runStep("open_draft_pr", async () => {
    const { data: pullRequest } = await octokit.pulls.create({
      owner: forkOwner,
      repo: forkName,
      title: prTitle,
      body: prBody,
      head: parsed.branch,
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
      forkRepo: parsed.forkRepo,
      prUrl: pr.html_url,
      prNumber: pr.number,
    },
    "open_draft_pr_success"
  );

  const result: CreateDraftPRResult = {
    prUrl: pr.html_url!,
    branch: parsed.branch,
    filePaths: committedPaths,
    prNumber: pr.number,
  };

  log.info(result, "create_draft_pr_success");
  return formatCreateDraftPRResult(result);
}
