import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Chunk } from "../pipeline/chunker";

const mockCloneRepo = vi.fn();
const mockChunkRepo = vi.fn();
const mockEmbedChunks = vi.fn();
const mockUpsert = vi.fn();
const mockGetCollection = vi.fn();
const mockGetOrCreateCollection = vi.fn();

vi.mock("../pipeline/cloner", () => ({
  cloneRepo: (...args: unknown[]) => mockCloneRepo(...args),
  CloneError: class CloneError extends Error {
    constructor(public readonly repo: string, cause: unknown) {
      super(String(cause));
      this.name = "CloneError";
    }
  },
}));

vi.mock("../pipeline/chunker", () => ({
  chunkRepo: (...args: unknown[]) => mockChunkRepo(...args),
}));

vi.mock("../pipeline/embedder", () => ({
  embedChunks: (...args: unknown[]) => mockEmbedChunks(...args),
  EmbedError: class EmbedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "EmbedError";
    }
  },
}));

vi.mock("../db/chroma", () => ({
  createChromaClient: () => ({
    getCollection: mockGetCollection,
    getOrCreateCollection: mockGetOrCreateCollection,
  }),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  indexRepo,
  collectionNameForRepo,
  IndexerError,
} from "../pipeline/indexer";

const sampleChunk: Chunk = {
  id: "chunk-1",
  content: "export function foo() {}",
  contentWithImports: "import x from 'y';\nexport function foo() {}",
  path: "src/foo.ts",
  repo: "octocat/Hello-World",
  language: "typescript",
  startLine: 1,
  endLine: 1,
  classNames: [],
  functionNames: ["foo"],
  fileKind: "source",
  jsdocSummary: null,
};

beforeEach(() => {
  mockCloneRepo.mockReset();
  mockChunkRepo.mockReset();
  mockEmbedChunks.mockReset();
  mockUpsert.mockReset();
  mockGetCollection.mockReset();
  mockGetOrCreateCollection.mockReset();

  mockGetCollection.mockRejectedValue(new Error("not found"));
  mockGetOrCreateCollection.mockResolvedValue({ upsert: mockUpsert });
});

describe("collectionNameForRepo", () => {
  it("sanitizes owner/repo into a collection name", () => {
    expect(collectionNameForRepo("octocat/Hello-World")).toBe(
      "code-octocat--Hello-World"
    );
  });
});

describe("indexRepo", () => {
  it("orchestrates clone → chunk → embed → chroma upsert", async () => {
    const localPath = "/tmp/github-pr-agent/octocat/Hello-World";
    mockCloneRepo.mockResolvedValue(localPath);
    mockChunkRepo.mockResolvedValue([sampleChunk]);
    mockEmbedChunks.mockResolvedValue([
      { ...sampleChunk, embedding: [0.1, 0.2] },
    ]);

    const result = await indexRepo("octocat/Hello-World");

    expect(mockCloneRepo).toHaveBeenCalledWith("octocat/Hello-World");
    expect(mockChunkRepo).toHaveBeenCalledWith(localPath);
    expect(mockEmbedChunks).toHaveBeenCalledWith([sampleChunk]);
    expect(mockGetOrCreateCollection).toHaveBeenCalledWith({
      name: "code-octocat--Hello-World",
      embeddingFunction: null,
      metadata: {
        repo: "octocat/Hello-World",
        source: "github-pr-agent",
        "hnsw:space": "cosine",
      },
    });
    expect(mockUpsert).toHaveBeenCalledWith({
      ids: ["chunk-1"],
      embeddings: [[0.1, 0.2]],
      documents: [sampleChunk.content],
      metadatas: [
        {
          path: "src/foo.ts",
          repo: "octocat/Hello-World",
          language: "typescript",
          startLine: 1,
          endLine: 1,
          classNames: "",
          functionNames: "foo",
          fileKind: "source",
        },
      ],
    });
    expect(result).toEqual({
      repo: "octocat/Hello-World",
      localPath,
      chunkCount: 1,
      collectionName: "code-octocat--Hello-World",
    });
  });

  it("skips embed and chroma when there are no chunks", async () => {
    const localPath = "/tmp/github-pr-agent/octocat/Hello-World";
    mockCloneRepo.mockResolvedValue(localPath);
    mockChunkRepo.mockResolvedValue([]);

    const result = await indexRepo("octocat/Hello-World");

    expect(mockEmbedChunks).not.toHaveBeenCalled();
    expect(mockGetOrCreateCollection).not.toHaveBeenCalled();
    expect(result.chunkCount).toBe(0);
  });

  it("skips clone and embed when the collection already has chunks", async () => {
    mockGetCollection.mockResolvedValue({
      count: vi.fn().mockResolvedValue(99),
    });

    const result = await indexRepo("octocat/Hello-World");

    expect(mockCloneRepo).not.toHaveBeenCalled();
    expect(mockChunkRepo).not.toHaveBeenCalled();
    expect(result).toEqual({
      repo: "octocat/Hello-World",
      chunkCount: 99,
      collectionName: "code-octocat--Hello-World",
      skipped: true,
    });
  });

  it("re-indexes when force is true even if chunks exist", async () => {
    const localPath = "/tmp/github-pr-agent/octocat/Hello-World";
    mockGetCollection.mockResolvedValue({
      count: vi.fn().mockResolvedValue(99),
    });
    mockCloneRepo.mockResolvedValue(localPath);
    mockChunkRepo.mockResolvedValue([sampleChunk]);
    mockEmbedChunks.mockResolvedValue([
      { ...sampleChunk, embedding: [0.1, 0.2] },
    ]);

    const result = await indexRepo("octocat/Hello-World", { force: true });

    expect(mockCloneRepo).toHaveBeenCalled();
    expect(result.skipped).toBeUndefined();
    expect(result.chunkCount).toBe(1);
  });

  it("wraps unexpected errors in IndexerError", async () => {
    mockCloneRepo.mockRejectedValue(new Error("network down"));

    await expect(indexRepo("octocat/Hello-World")).rejects.toBeInstanceOf(
      IndexerError
    );
  });
});
