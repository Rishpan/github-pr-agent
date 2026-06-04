import { z } from "zod";
import { semanticSearch as semanticSearchPipeline } from "github-pr-agent-rag/retriever";

export const SemanticSearchSchema = z.object({
  query: z.string().describe("Natural-language search query"),
  repo: z
    .string()
    .describe('Indexed repository in owner/repo format (e.g. "octocat/Hello-World")'),
  topK: z
    .number()
    .int()
    .positive()
    .default(5)
    .describe("Maximum number of chunks to return"),
});
export type SemanticSearchInput = z.infer<typeof SemanticSearchSchema>;

export async function semanticSearch(input: SemanticSearchInput): Promise<string> {
  const { query, repo, topK } = input;
  const results = await semanticSearchPipeline(query, repo, topK);

  if (results.length === 0) {
    return "No relevant chunks found for query: " + query;
  }

  return results.map((r, i) => `
    Result ${i + 1} (similarity: ${r.similarityScore.toFixed(2)})
    File: ${r.path}
    Lines: ${r.startLine}-${r.endLine}
    Language: ${r.language}
    Classes: ${r.classNames.length > 0 ? r.classNames.join(", ") : "none"}

    ${r.content}

    ---`).join("\n");
}
