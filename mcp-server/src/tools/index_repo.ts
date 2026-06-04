import { z } from "zod";
import { indexRepo as indexRepoPipeline } from "github-pr-agent-rag/indexer";

export const IndexRepoSchema = z.object({
  repo: z
    .string()
    .describe('GitHub repository in owner/repo format (e.g. "octocat/Hello-World")'),
});

export type IndexRepoInput = z.infer<typeof IndexRepoSchema>;

export async function indexRepo(input: IndexRepoInput): Promise<string> {
  const { repo } = input;
  const result = await indexRepoPipeline(repo);

  if (result.chunkCount === 0) {
    return `Warning: indexed ${repo} but produced 0 chunks. 
            Repo may have no supported code files.`;
  }

  return `Successfully indexed ${repo}:
    - Chunks: ${result.chunkCount}
    - Collection: ${result.collectionName}
    - Local path: ${result.localPath}
    Ready for semantic_search.`;
}
