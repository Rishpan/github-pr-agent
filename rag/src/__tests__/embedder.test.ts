import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  embedText,
  embedChunks,
  EmbedError,
} from "../pipeline/embedder";
import type { Chunk } from "../pipeline/chunker";

const mockEmbedding = [0.1, 0.2, 0.3];

function mockOllamaResponse(embeddings: number[][]): Response {
  return {
    ok: true,
    json: async () => ({ model: "nomic-embed-text", embeddings }),
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(mockOllamaResponse([mockEmbedding]))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("embedText", () => {
  it("calls Ollama /api/embed with search_document prefix", async () => {
    const result = await embedText("hello world", "document");

    expect(result).toEqual(mockEmbedding);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("search_document:"),
      })
    );
  });

  it("uses search_query prefix for query task", async () => {
    await embedText("find auth code", "query");

    const body = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.input).toContain("search_query:");
  });

  it("throws EmbedError when Ollama returns non-ok", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "internal error",
    } as Response);

    await expect(embedText("fail")).rejects.toThrow(EmbedError);
  });
});

describe("embedChunks", () => {
  const sampleChunk: Chunk = {
    id: "abc",
    content: "export function foo() {}",
    contentWithImports: 'import x from "y";\n\nexport function foo() {}',
    path: "src/foo.ts",
    repo: "owner/repo",
    language: "typescript",
    startLine: 1,
    endLine: 5,
    classNames: [],
  };

  it("returns embedded chunks aligned with input", async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockOllamaResponse([mockEmbedding, [0.4, 0.5, 0.6]])
    );

    const chunks = [sampleChunk, { ...sampleChunk, id: "def" }];
    const result = await embedChunks(chunks);

    expect(result).toHaveLength(2);
    expect(result[0].embedding).toEqual(mockEmbedding);
    expect(result[0].id).toBe("abc");
    expect(result[1].embedding).toEqual([0.4, 0.5, 0.6]);
  });

  it("returns empty array for no chunks", async () => {
    const result = await embedChunks([]);
    expect(result).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
