import { z } from "zod";
import { Octokit } from "@octokit/rest";

export const GetFileSchema = z.object({
  repo: z
    .string()
    .describe("GitHub repository in owner/repo format (e.g. 'octocat/Hello-World')"),
  path: z
    .string()
    .describe("Path to the file within the repository (e.g. 'src/index.ts')"),
});

export type GetFileInput = z.infer<typeof GetFileSchema>;

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN || undefined,
});

export async function getFile(input: GetFileInput): Promise<string> {
  const [owner, repo] = input.repo.split("/");
  if (!owner || !repo) {
    throw new Error(
      `Invalid repo format "${input.repo}". Expected "owner/repo".`
    );
  }

  const response = await octokit.repos.getContent({
    owner,
    repo,
    path: input.path,
  });

  const data = response.data;
  if (Array.isArray(data) || data.type !== "file") {
    throw new Error(`Path "${input.path}" is not a file.`);
  }

  return Buffer.from(data.content, "base64").toString("utf-8");
}
