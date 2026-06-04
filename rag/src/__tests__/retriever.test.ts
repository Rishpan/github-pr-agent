import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryResult } from "chromadb";

const mockQuery = vi.fn();
const mockGetOrCreateCollection = vi.fn();
const mockEmbedText = vi.fn();

vi.mock("../db/chroma", () => ({
  createChromaClient: () => ({
    getOrCreateCollection: mockGetOrCreateCollection,
  }),
}));

vi.mock("../pipeline/embedder", () => ({
  embedText: (...args: unknown[]) => mockEmbedText(...args),
}));

import { semanticSearch, getCollection } from "../pipeline/retriever";

const sampleMetadata = {
  path: "src/foo.ts",
  repo: "octocat/Hello-World",
  language: "typescript",
  startLine: 1,
  endLine: 10,
  classNames: "Foo,Bar",
};

function queryResult(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    ids: [["chunk-1", "chunk-2", "chunk-3"]],
    documents: [["valid doc", null, "weak doc"]],
    metadatas: [[sampleMetadata, sampleMetadata, sampleMetadata]],
    distances: [[0.1, 0.2, 0.8]],
    embeddings: [[]],
    uris: [[]],
    include: [],
    rows: () => [
      [
        { id: "chunk-1", document: "valid doc", metadata: sampleMetadata, distance: 0.1 },
        { id: "chunk-2", document: null, metadata: sampleMetadata, distance: 0.2 },
        { id: "chunk-3", document: "weak doc", metadata: sampleMetadata, distance: 0.8 },
      ],
    ],
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
  mockGetOrCreateCollection.mockReset();
  mockEmbedText.mockReset();

  mockGetOrCreateCollection.mockResolvedValue({ query: mockQuery });
  mockEmbedText.mockResolvedValue([0.1, 0.2, 0.3]);
});

describe("getCollection", () => {
  it("uses the same collection name as the indexer", async () => {
    await getCollection("octocat/Hello-World");

    expect(mockGetOrCreateCollection).toHaveBeenCalledWith({
      name: "code-octocat--Hello-World",
      embeddingFunction: null,
      metadata: {
        repo: "octocat/Hello-World",
        source: "github-pr-agent",
        "hnsw:space": "cosine",
      },
    });
  });
});

describe("semanticSearch", () => {
  it("queries the indexed collection and applies null + similarity filters", async () => {
    mockQuery.mockResolvedValue(queryResult());

    const results = await semanticSearch("auth bug", "octocat/Hello-World", 3);

    expect(mockGetOrCreateCollection).toHaveBeenCalledWith({
      name: "code-octocat--Hello-World",
      embeddingFunction: null,
      metadata: {
        repo: "octocat/Hello-World",
        source: "github-pr-agent",
        "hnsw:space": "cosine",
      },
    });
    expect(mockEmbedText).toHaveBeenCalledWith("auth bug", "query");
    expect(mockQuery).toHaveBeenCalledWith({
      queryEmbeddings: [[0.1, 0.2, 0.3]],
      nResults: 3,
      where: undefined,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      content: "valid doc",
      path: "src/foo.ts",
      repo: "octocat/Hello-World",
      classNames: ["Foo", "Bar"],
      similarityScore: 0.9,
    });
  });

  it("returns empty results when every hit is below the threshold", async () => {
    mockQuery.mockResolvedValue(
      queryResult({
        ids: [["chunk-1"]],
        documents: [["irrelevant doc"]],
        metadatas: [[sampleMetadata]],
        distances: [[0.9]],
      })
    );

    const results = await semanticSearch("auth bug", "octocat/Hello-World", 1);

    expect(results).toEqual([]);
  });

  it("passes an optional metadata where filter to Chroma", async () => {
    mockQuery.mockResolvedValue(queryResult());
    const where = { language: "typescript" };

    await semanticSearch("auth bug", "octocat/Hello-World", 3, where);

    expect(mockQuery).toHaveBeenCalledWith({
      queryEmbeddings: [[0.1, 0.2, 0.3]],
      nResults: 3,
      where,
    });
  });
});
