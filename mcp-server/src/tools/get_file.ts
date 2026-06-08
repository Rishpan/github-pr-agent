import { z } from "zod";
import { Octokit } from "@octokit/rest";
import { retrieverConfig } from "github-pr-agent-rag/config";

export const GetFileSchema = z.object({
  repo: z
    .string()
    .describe("GitHub repository in owner/repo format (e.g. 'octocat/Hello-World')"),
  path: z
    .string()
    .describe("Path to the file within the repository (e.g. 'src/index.ts')"),
  startLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based start line (inclusive). Use with endLine or alone for context window."),
  endLine: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("1-based end line (inclusive). Use with startLine or alone for context window."),
  contextLines: z
    .number()
    .int()
    .nonnegative()
    .default(15)
    .describe("Lines of padding when only startLine or endLine is given"),
});

export type GetFileInput = z.input<typeof GetFileSchema>;

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN || undefined,
});

export interface SliceFileOptions {
  startLine?: number;
  endLine?: number;
  contextLines?: number;
  maxLines?: number;
}

/** Slice file content by 1-based line range; returns full content when no range given. */
export function sliceFileByLines(
  content: string,
  filePath: string,
  options: SliceFileOptions = {}
): string {
  const { startLine, endLine, contextLines = 15 } = options;
  if (startLine === undefined && endLine === undefined) {
    return content;
  }

  if (startLine !== undefined && startLine < 1) {
    throw new Error(`startLine must be >= 1, got ${startLine}`);
  }
  if (endLine !== undefined && endLine < 1) {
    throw new Error(`endLine must be >= 1, got ${endLine}`);
  }
  if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
    throw new Error(
      `startLine (${startLine}) must be <= endLine (${endLine})`
    );
  }

  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;

  let rangeStart: number;
  let rangeEnd: number;

  if (startLine !== undefined && endLine !== undefined) {
    rangeStart = startLine;
    rangeEnd = endLine;
  } else if (startLine !== undefined) {
    rangeStart = Math.max(1, startLine - contextLines);
    rangeEnd = Math.min(totalLines, startLine + contextLines);
  } else {
    rangeEnd = Math.min(totalLines, endLine! + contextLines);
    rangeStart = Math.max(1, endLine! - contextLines);
  }

  rangeStart = Math.max(1, Math.min(rangeStart, totalLines));
  rangeEnd = Math.max(rangeStart, Math.min(rangeEnd, totalLines));

  const maxLines = options.maxLines ?? retrieverConfig.maxGetFileLines;
  if (rangeEnd - rangeStart + 1 > maxLines) {
    rangeEnd = rangeStart + maxLines - 1;
  }

  const slice = lines.slice(rangeStart - 1, rangeEnd);
  return `# lines ${rangeStart}-${rangeEnd} of ${filePath}\n${slice.join("\n")}`;
}

export async function getFile(input: GetFileInput): Promise<string> {
  const parsed = GetFileSchema.parse(input);
  const { repo, path, startLine, endLine, contextLines } = parsed;

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    throw new Error(
      `Invalid repo format "${repo}". Expected "owner/repo".`
    );
  }

  const response = await octokit.repos.getContent({
    owner,
    repo: repoName,
    path,
  });

  const data = response.data;
  if (Array.isArray(data) || data.type !== "file") {
    throw new Error(`Path "${path}" is not a file.`);
  }

  const content = Buffer.from(data.content, "base64").toString("utf-8");
  return sliceFileByLines(content, path, { startLine, endLine, contextLines });
}
