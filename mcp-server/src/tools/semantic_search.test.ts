import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSemanticSearch = vi.fn();

vi.mock("github-pr-agent-rag/retriever", async (importOriginal) => {
  const actual = await importOriginal<typeof import("github-pr-agent-rag/retriever")>();
  return {
    ...actual,
    semanticSearch: (...args: unknown[]) => mockSemanticSearch(...args),
  };
});

import { semanticSearch } from "./semantic_search.js";

const sampleHit = {
  content: "export function auth() {}",
  path: "src/auth.ts",
  repo: "octocat/Hello-World",
  startLine: 1,
  endLine: 10,
  language: "typescript",
  classNames: ["AuthService"],
  functionNames: ["auth"],
  jsdocSummary: "Authenticate a user.",
  vectorScore: 0.91,
  similarityScore: 0.91,
  matchStrength: "strong" as const,
};

beforeEach(() => {
  mockSemanticSearch.mockReset();
});

describe("semanticSearch", () => {
  it("calls the RAG pipeline with query, repo, topK, and options", async () => {
    mockSemanticSearch.mockResolvedValue([sampleHit]);

    await semanticSearch({
      query: "where is auth handled?",
      repo: "octocat/Hello-World",
      topK: 3,
      excludeTests: true,
      preferSource: false,
    });

    expect(mockSemanticSearch).toHaveBeenCalledWith(
      "where is auth handled?",
      "octocat/Hello-World",
      3,
      { excludeTests: true, preferSource: false }
    );
  });

  it("formats pipeline results as metadata-only locations by default", async () => {
    mockSemanticSearch.mockResolvedValue([sampleHit]);

    const out = await semanticSearch({
      query: "auth",
      repo: "octocat/Hello-World",
      topK: 5,
    });

    expect(out).toContain("Result 1 (similarity: 0.91, match: strong)");
    expect(out).toContain("File: src/auth.ts");
    expect(out).toContain("Lines: 1-10");
    expect(out).toContain("Symbols: AuthService, auth");
    expect(out).toContain("JSDoc: Authenticate a user.");
    expect(out).toContain("call get_file with startLine/endLine");
    expect(out).not.toContain("export function auth()");
  });

  it("returns a clear message when no chunks match", async () => {
    mockSemanticSearch.mockResolvedValue([]);

    const out = await semanticSearch({
      query: "nonexistent feature",
      repo: "octocat/Hello-World",
      topK: 5,
    });

    expect(out).toBe(
      "No relevant chunks found for query: nonexistent feature"
    );
  });
});
