import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueryResult } from "chromadb";

const mockQuery = vi.fn();
const mockCount = vi.fn();
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

import {
  semanticSearch,
  getCollection,
  rankSearchResults,
  formatSearchResultsText,
} from "../pipeline/retriever";

const sampleMetadata = {
  path: "src/foo.ts",
  repo: "octocat/Hello-World",
  language: "typescript",
  startLine: 1,
  endLine: 10,
  classNames: "Foo,Bar",
  fileKind: "source",
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
  mockCount.mockReset();
  mockGetOrCreateCollection.mockReset();
  mockEmbedText.mockReset();

  mockCount.mockResolvedValue(100);
  mockGetOrCreateCollection.mockResolvedValue({
    query: mockQuery,
    count: mockCount,
  });
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

describe("rankSearchResults", () => {
  it("boosts source paths when preferSource is true", () => {
    const ranked = rankSearchResults(
      [
        {
          content: "test",
          path: "test/index_test.ts",
          repo: "o/r",
          startLine: 1,
          endLine: 2,
          language: "typescript",
          classNames: [],
          functionNames: [],
          jsdocSummary: null,
          fileKind: "test",
          vectorScore: 0.6,
        },
        {
          content: "src",
          path: "src/index.ts",
          repo: "o/r",
          startLine: 1,
          endLine: 2,
          language: "typescript",
          classNames: [],
          functionNames: [],
          jsdocSummary: null,
          fileKind: "source",
          vectorScore: 0.58,
        },
      ],
      2,
      { preferSource: true }
    );

    expect(ranked[0].path).toBe("src/index.ts");
    expect(ranked[0].similarityScore).toBeGreaterThan(0.58);
  });

  it("keeps at least one hit when relative cutoff would remove all", () => {
    const ranked = rankSearchResults(
      [
        {
          content: "a",
          path: "src/a.ts",
          repo: "o/r",
          startLine: 1,
          endLine: 1,
          language: "typescript",
          classNames: [],
          functionNames: [],
          jsdocSummary: null,
          fileKind: "source",
          vectorScore: 0.46,
        },
      ],
      5
    );

    expect(ranked).toHaveLength(1);
    expect(ranked[0].matchStrength).toBe("weak");
  });

  it("dedupes multiple hits from the same file path", () => {
    const ranked = rankSearchResults(
      [
        {
          content: "a",
          path: "src/foo.ts",
          repo: "o/r",
          startLine: 1,
          endLine: 10,
          language: "typescript",
          classNames: [],
          functionNames: ["a"],
          jsdocSummary: null,
          fileKind: "source",
          vectorScore: 0.7,
        },
        {
          content: "b",
          path: "src/foo.ts",
          repo: "o/r",
          startLine: 20,
          endLine: 30,
          language: "typescript",
          classNames: [],
          functionNames: ["b"],
          jsdocSummary: null,
          fileKind: "source",
          vectorScore: 0.65,
        },
        {
          content: "c",
          path: "src/bar.ts",
          repo: "o/r",
          startLine: 1,
          endLine: 5,
          language: "typescript",
          classNames: [],
          functionNames: [],
          jsdocSummary: null,
          fileKind: "source",
          vectorScore: 0.68,
        },
      ],
      3
    );

    expect(ranked).toHaveLength(2);
    expect(ranked.map((r) => r.path)).toEqual(["src/foo.ts", "src/bar.ts"]);
    expect(ranked[0].startLine).toBe(1);
  });
});

describe("formatSearchResultsText", () => {
  it("returns metadata-only output in metadata mode", () => {
    const text = formatSearchResultsText(
      [
        {
          content: "secret code body",
          path: "lib/app.js",
          repo: "o/r",
          startLine: 10,
          endLine: 20,
          language: "javascript",
          classNames: ["App"],
          functionNames: ["listen"],
          jsdocSummary: "Start server.",
          vectorScore: 0.64,
          similarityScore: 0.64,
          matchStrength: "moderate",
        },
      ],
      "listen handler"
    );

    expect(text).toContain("File: lib/app.js");
    expect(text).toContain("Symbols: App, listen");
    expect(text).toContain("JSDoc: Start server.");
    expect(text).toContain("call get_file with startLine/endLine");
    expect(text).not.toContain("secret code body");
  });
});

describe("semanticSearch", () => {
  it("over-fetches, filters nulls, and returns ranked hits", async () => {
    mockQuery.mockResolvedValue(queryResult());

    const results = await semanticSearch("auth bug", "octocat/Hello-World", 3);

    expect(mockCount).toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledWith({
      queryEmbeddings: [[0.1, 0.2, 0.3]],
      nResults: 9,
      where: undefined,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      content: "valid doc",
      path: "src/foo.ts",
      repo: "octocat/Hello-World",
      classNames: ["Foo", "Bar"],
      vectorScore: 0.9,
      matchStrength: "strong",
    });
    expect(results[0].similarityScore).toBeCloseTo(0.94, 5);
  });

  it("returns empty results when every hit is below the absolute floor", async () => {
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

  it("passes merged where filters for excludeTests", async () => {
    mockQuery.mockResolvedValue(queryResult());

    await semanticSearch("auth bug", "octocat/Hello-World", 3, {
      excludeTests: true,
    });

    expect(mockQuery).toHaveBeenCalledWith({
      queryEmbeddings: [[0.1, 0.2, 0.3]],
      nResults: 9,
      where: { fileKind: { $ne: "test" } },
    });
  });

  it("passes an optional metadata where filter to Chroma", async () => {
    mockQuery.mockResolvedValue(queryResult());
    const where = { language: "typescript" };

    await semanticSearch("auth bug", "octocat/Hello-World", 3, { where });

    expect(mockQuery).toHaveBeenCalledWith({
      queryEmbeddings: [[0.1, 0.2, 0.3]],
      nResults: 9,
      where,
    });
  });

  it("post-filters test paths when excludeTests is set", async () => {
    mockQuery.mockResolvedValue(
      queryResult({
        ids: [["t1", "s1"]],
        documents: [["test body", "src body"]],
        metadatas: [
          [
            { ...sampleMetadata, path: "test/foo.test.ts", fileKind: "test" },
            { ...sampleMetadata, path: "src/foo.ts", fileKind: "source" },
          ],
        ],
        distances: [[0.15, 0.2]],
      })
    );

    const results = await semanticSearch("auth", "octocat/Hello-World", 5, {
      excludeTests: true,
    });

    expect(results).toHaveLength(1);
    expect(results[0].path).toBe("src/foo.ts");
  });
});
