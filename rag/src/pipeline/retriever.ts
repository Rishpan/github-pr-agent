// NOTE: Future task is to add: whereDocument filter + MMR
import type { Collection, Metadata, QueryResult, Where } from "chromadb";
import { createChromaClient } from "../db/chroma";
import { retrieverConfig } from "../lib/config";
import { classifyFileKind } from "./chunker";
import { embedText } from "./embedder";
import { collectionOptionsForRepo } from "./indexer";

export type MatchStrength = "strong" | "moderate" | "weak";

export interface SemanticSearchOptions {
  where?: Where;
  /** Omit chunks indexed with fileKind=test (also filters by path for older indexes). */
  excludeTests?: boolean;
  /** Boost src/lib paths and penalize test paths after vector search (default: true). */
  preferSource?: boolean;
}

export interface ChunkSearchResult {
  content: string;
  path: string;
  repo: string;
  startLine: number;
  endLine: number;
  language: string;
  classNames: string[];
  functionNames: string[];
  jsdocSummary: string | null;
  /** Raw cosine similarity from Chroma (1 - distance). */
  vectorScore: number;
  /** Score after optional path rerank; used for sorting and display. */
  similarityScore: number;
  matchStrength: MatchStrength;
}

function matchStrengthFromScore(score: number): MatchStrength {
  if (score >= 0.65) return "strong";
  if (score >= 0.55) return "moderate";
  return "weak";
}

function pathRerankDelta(filePath: string, preferSource: boolean): number {
  if (!preferSource) return 0;
  const kind = classifyFileKind(filePath);
  if (kind === "source") return retrieverConfig.sourcePathBoost;
  if (kind === "test") return -retrieverConfig.testPathPenalty;
  return 0;
}

interface RawSearchHit {
  content: string;
  path: string;
  repo: string;
  startLine: number;
  endLine: number;
  language: string;
  classNames: string[];
  functionNames: string[];
  jsdocSummary: string | null;
  fileKind: string | null;
  vectorScore: number;
}

function parseCommaSeparatedNames(raw: unknown): string[] {
  return typeof raw === "string" && raw.length > 0 ? raw.split(",") : [];
}

function buildSearchResult(
  id: string,
  document: string | null,
  metadata: Metadata | null,
  distance: number | null
): RawSearchHit | null {
  if (document === null || metadata === null || distance === null) {
    return null;
  }

  const classNames = parseCommaSeparatedNames(metadata.classNames);
  const functionNames = parseCommaSeparatedNames(metadata.functionNames);
  const jsdocRaw = metadata.jsdocSummary;

  const vectorScore = 1 - distance;
  const fileKindRaw = metadata.fileKind;

  return {
    content: document,
    path: String(metadata.path ?? id),
    repo: String(metadata.repo ?? ""),
    startLine: Number(metadata.startLine ?? 0),
    endLine: Number(metadata.endLine ?? 0),
    language: String(metadata.language ?? ""),
    classNames,
    functionNames,
    jsdocSummary:
      typeof jsdocRaw === "string" && jsdocRaw.length > 0 ? jsdocRaw : null,
    fileKind:
      typeof fileKindRaw === "string" && fileKindRaw.length > 0
        ? fileKindRaw
        : null,
    vectorScore,
  };
}

function parseQueryResults(response: QueryResult): RawSearchHit[] {
  const ids = response.ids[0] ?? [];
  return ids
    .map((id, index) =>
      buildSearchResult(
        id,
        response.documents?.[0]?.[index] ?? null,
        response.metadatas?.[0]?.[index] ?? null,
        response.distances?.[0]?.[index] ?? null
      )
    )
    .filter((result): result is NonNullable<typeof result> => result !== null);
}

function isTestHit(hit: RawSearchHit): boolean {
  if (hit.fileKind === "test") return true;
  if (hit.fileKind === "source" || hit.fileKind === "other") return false;
  return classifyFileKind(hit.path) === "test";
}

/** Keep the highest-scoring hit per file path so topK means distinct files. */
function dedupeByPath(ranked: ChunkSearchResult[]): ChunkSearchResult[] {
  const seen = new Set<string>();
  const deduped: ChunkSearchResult[] = [];
  for (const hit of ranked) {
    if (seen.has(hit.path)) continue;
    seen.add(hit.path);
    deduped.push(hit);
  }
  return deduped;
}

/** Apply absolute floor, relative cutoff, path rerank, dedupe by path, sort, and trim to topK. */
export function rankSearchResults(
  raw: RawSearchHit[],
  topK: number,
  options: { preferSource?: boolean } = {}
): ChunkSearchResult[] {
  const preferSource = options.preferSource !== false;

  const aboveFloor = raw.filter(
    (r) => r.vectorScore >= retrieverConfig.minSimilarity
  );
  if (aboveFloor.length === 0) return [];

  const best = Math.max(...aboveFloor.map((r) => r.vectorScore));
  const relativeCutoff = best - retrieverConfig.relativeCutoffDelta;
  const relativeFiltered = aboveFloor.filter(
    (r) => r.vectorScore >= relativeCutoff
  );
  const candidates =
    relativeFiltered.length > 0 ? relativeFiltered : [aboveFloor[0]];

  const ranked: ChunkSearchResult[] = candidates
    .map((r) => {
      const similarityScore = Math.min(
        1,
        r.vectorScore + pathRerankDelta(r.path, preferSource)
      );
      return {
        ...r,
        similarityScore,
        matchStrength: matchStrengthFromScore(r.vectorScore),
      };
    })
    .sort((a, b) => b.similarityScore - a.similarityScore);

  return dedupeByPath(ranked).slice(0, topK);
}

function mergeWhere(
  base: Where | undefined,
  extra: Where | undefined
): Where | undefined {
  if (!base) return extra;
  if (!extra) return base;
  return { $and: [base, extra] };
}

function overFetchCount(topK: number, collectionSize: number): number {
  if (collectionSize <= 0) return topK;
  const requested = topK * retrieverConfig.overFetchMultiplier;
  return Math.min(
    Math.max(requested, topK),
    retrieverConfig.maxOverFetch,
    collectionSize
  );
}

export async function semanticSearch(
  query: string,
  repo: string,
  topK: number,
  options: SemanticSearchOptions = {}
): Promise<ChunkSearchResult[]> {
  const collection = await getCollection(repo);
  const queryEmbedding = await embedQuery(query);

  const preferSource = options.preferSource !== false;
  const excludeTests = options.excludeTests === true;

  let where = options.where;
  if (excludeTests) {
    where = mergeWhere(where, { fileKind: { $ne: "test" } });
  }

  const collectionSize = await collection.count();
  const nResults = overFetchCount(topK, collectionSize);

  const response = await collection.query({
    queryEmbeddings: [queryEmbedding],
    nResults,
    where,
  });

  let raw = parseQueryResults(response);

  if (excludeTests) {
    raw = raw.filter((r) => !isTestHit(r));
  }

  return rankSearchResults(raw, topK, { preferSource });
}

export function truncateChunkContent(
  content: string,
  maxChars: number = retrieverConfig.maxResultChunkChars
): string {
  if (content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, maxChars)}\n... [truncated — use get_file with the path above for full content]`;
}

export function formatSearchResultsText(
  results: ChunkSearchResult[],
  query: string
): string {
  if (results.length === 0) {
    return `No relevant chunks found for query: ${query}`;
  }

  const mode = retrieverConfig.searchResultMode;

  return results
    .map((r, i) => {
      const symbols = [...r.classNames, ...r.functionNames];
      const header = `Result ${i + 1} (similarity: ${r.similarityScore.toFixed(2)}, match: ${r.matchStrength})
File: ${r.path}
Lines: ${r.startLine}-${r.endLine}
Language: ${r.language}
Symbols: ${symbols.length > 0 ? symbols.join(", ") : "none"}`;

      if (mode === "metadata") {
        const jsdocLine = r.jsdocSummary ? `\nJSDoc: ${r.jsdocSummary}` : "";
        return `${header}${jsdocLine}
Action: call get_file with startLine/endLine (add ±15 line context) to read this region.
---`;
      }

      return `${header}

${truncateChunkContent(r.content)}

---`;
    })
    .join("\n");
}

export async function embedQuery(query: string): Promise<number[]> {
  return await embedText(query, "query");
}

export async function getCollection(repo: string): Promise<Collection> {
  const client = createChromaClient();
  return client.getOrCreateCollection(collectionOptionsForRepo(repo));
}
