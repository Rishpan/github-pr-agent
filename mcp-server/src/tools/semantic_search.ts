import { z } from "zod";
import {
  semanticSearch as semanticSearchPipeline,
  formatSearchResultsText,
} from "github-pr-agent-rag/retriever";

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
    .describe(
      "Maximum number of distinct files to return (3 is enough for agents; results are metadata-only locations)"
    ),
  excludeTests: z
    .boolean()
    .default(false)
    .describe("Exclude test/__tests__ paths and fileKind=test chunks"),
  preferSource: z
    .boolean()
    .default(true)
    .describe("Boost src/lib paths and penalize test paths in ranking"),
});
/** Caller input; fields with `.default()` in the schema are optional. */
export type SemanticSearchInput = z.input<typeof SemanticSearchSchema>;

export async function semanticSearch(input: SemanticSearchInput): Promise<string> {
  const { query, repo, topK, excludeTests, preferSource } =
    SemanticSearchSchema.parse(input);
  const results = await semanticSearchPipeline(query, repo, topK, {
    excludeTests,
    preferSource,
  });

  return formatSearchResultsText(results, query);
}
