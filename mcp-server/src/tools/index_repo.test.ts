import { describe, it, expect, vi, beforeEach } from "vitest";

const mockIndexRepo = vi.fn();

vi.mock("github-pr-agent-rag/indexer", () => ({
  indexRepo: (...args: unknown[]) => mockIndexRepo(...args),
}));

import { indexRepo } from "./index_repo.js";  

beforeEach(() => {
  mockIndexRepo.mockReset();
});

describe("indexRepo", () => {
  it("returns a success summary when chunks were indexed", async () => {
    mockIndexRepo.mockResolvedValue({
      repo: "octocat/Hello-World",
      localPath: "/tmp/github-pr-agent/octocat/Hello-World",
      chunkCount: 42,
      collectionName: "code-octocat--Hello-World",
    });

    const out = await indexRepo({ repo: "octocat/Hello-World" });

    expect(mockIndexRepo).toHaveBeenCalledWith("octocat/Hello-World");
    expect(out).toContain("Successfully indexed octocat/Hello-World");
    expect(out).toContain("Chunks: 42");
    expect(out).toContain("code-octocat--Hello-World");
  });

  it("warns when indexing produces zero chunks", async () => {
    mockIndexRepo.mockResolvedValue({
      repo: "octocat/Empty",
      localPath: "C:\\tmp\\github-pr-agent\\octocat\\Empty",
      chunkCount: 0,
      collectionName: "code-octocat--Empty",
    });

    const out = await indexRepo({ repo: "octocat/Empty" });

    expect(out).toContain("Warning: indexed octocat/Empty");
    expect(out).toContain("0 chunks");
  });
});
