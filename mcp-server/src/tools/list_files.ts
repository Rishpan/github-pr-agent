import { z } from "zod";
import { Octokit } from "@octokit/rest";

export const ListFilesSchema = z.object({
  repo: z
    .string()
    .describe("GitHub repository in owner/repo format (e.g. 'octocat/Hello-World')"),
  directory: z
    .string()
    .describe("Directory to list files from (e.g. 'src')"),
});

export type ListFilesInput = z.infer<typeof ListFilesSchema>;

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN || undefined,
});

export async function listFiles(input: ListFilesInput): Promise<string> {
  const [owner, repo] = input.repo.split("/");
  if (!owner || !repo) {
    throw new Error(
      `Invalid repo format "${input.repo}". Expected "owner/repo".`
    );
  }

  const response = await octokit.repos.getContent({
    owner,
    repo,
    path: input.directory,
  });

  const data = response.data;
  if (!Array.isArray(data)) {
    throw new Error(`Path "${input.directory}" is not a directory.`);
  }

  // return the list of files in the directory
  // should be in format: 
  /*
  {
    "files": [
      {
        "name": "file1.txt",
        "path": "src/file1.txt"
        "size": 100
        "extension": "txt"
        },
      {
        "name": "file2.txt",
        "path": "src/file2.txt"
        "size": 200
        "extension": "txt"
      }
    ]
  }
  */
  const files = data.map((item) => ({
    name: item.name,
    type: item.type,
    path: item.path,
    size: item.size,
    extension: item.name.includes(".") ? item.name.split(".").pop() : null,
  }));
  return JSON.stringify({ files });
}
