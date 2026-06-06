import { z } from "zod";
import {
  semanticSearch as semanticSearchPipeline,
  type MatchStrength,
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
    .default(12)
    .describe(
      "Maximum number of chunks to return (use 12+ on small repos; over-fetch retrieves more before ranking)"
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

function formatMatchStrength(strength: MatchStrength): string {
  return strength;
}

export async function semanticSearch(input: SemanticSearchInput): Promise<string> {
  const { query, repo, topK, excludeTests, preferSource } =
    SemanticSearchSchema.parse(input);
  const results = await semanticSearchPipeline(query, repo, topK, {
    excludeTests,
    preferSource,
  });

  if (results.length === 0) {
    return "No relevant chunks found for query: " + query;
  }

  return results
    .map(
      (r, i) => `
    Result ${i + 1} (similarity: ${r.similarityScore.toFixed(2)}, match: ${formatMatchStrength(r.matchStrength)})
    File: ${r.path}
    Lines: ${r.startLine}-${r.endLine}
    Language: ${r.language}
    Classes: ${r.classNames.length > 0 ? r.classNames.join(", ") : "none"}

    ${r.content}

    ---`
    )
    .join("\n");
}
