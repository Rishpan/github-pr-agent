import { z } from "zod";
import { indexRepo as indexRepoPipeline } from "github-pr-agent-rag/indexer";

export const IndexRepoSchema = z.object({
  repo: z
    .string()
    .describe('GitHub repository in owner/repo format (e.g. "octocat/Hello-World")'),
  force: z
    .boolean()
    .default(false)
    .describe(
      "Re-index even if the repo is already in Chroma. Default false skips when chunks exist."
    ),
});

export type IndexRepoInput = z.input<typeof IndexRepoSchema>;

export async function indexRepo(input: IndexRepoInput): Promise<string> {
  const { repo, force } = IndexRepoSchema.parse(input);
  const result = await indexRepoPipeline(repo, { force });

  if (result.skipped) {
    return `Already indexed: ${repo} (${result.chunkCount} chunks). Skipping. Use force=true to re-index.`;
  }

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
