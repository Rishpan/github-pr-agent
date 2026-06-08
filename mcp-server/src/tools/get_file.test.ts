import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetContent } = vi.hoisted(() => ({
  mockGetContent: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    repos = { getContent: mockGetContent };
  },
}));

import { getFile, sliceFileByLines } from "./get_file.js";

beforeEach(() => {
  mockGetContent.mockReset();
});

describe("sliceFileByLines", () => {
  const content = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10";

  it("returns full content when no range is given", () => {
    expect(sliceFileByLines(content, "src/a.ts")).toBe(content);
  });

  it("slices an explicit line range with header", () => {
    const out = sliceFileByLines(content, "src/a.ts", {
      startLine: 3,
      endLine: 5,
    });
    expect(out).toBe("# lines 3-5 of src/a.ts\nline3\nline4\nline5");
  });

  it("adds context when only startLine is given", () => {
    const out = sliceFileByLines(content, "src/a.ts", {
      startLine: 5,
      contextLines: 2,
    });
    expect(out).toBe("# lines 3-7 of src/a.ts\nline3\nline4\nline5\nline6\nline7");
  });

  it("caps output to maxLines", () => {
    const manyLines = Array.from({ length: 200 }, (_, i) => `line${i + 1}`).join("\n");
    const out = sliceFileByLines(manyLines, "big.ts", {
      startLine: 1,
      endLine: 200,
      maxLines: 150,
    });
    expect(out.startsWith("# lines 1-150 of big.ts")).toBe(true);
    expect(out.split("\n")).toHaveLength(151);
  });

  it("throws when startLine exceeds endLine", () => {
    expect(() =>
      sliceFileByLines(content, "src/a.ts", { startLine: 8, endLine: 3 })
    ).toThrow("startLine (8) must be <= endLine (3)");
  });
});

describe("getFile", () => {
  it("returns decoded file content", async () => {
    mockGetContent.mockResolvedValue({
      data: {
        type: "file",
        content: Buffer.from("hello world").toString("base64"),
      },
    });

    const result = await getFile({ repo: "octocat/Hello-World", path: "README.md" });
    expect(result).toBe("hello world");
    expect(mockGetContent).toHaveBeenCalledWith({
      owner: "octocat",
      repo: "Hello-World",
      path: "README.md",
    });
  });

  it("returns a sliced range when startLine and endLine are provided", async () => {
    mockGetContent.mockResolvedValue({
      data: {
        type: "file",
        content: Buffer.from("a\nb\nc\nd").toString("base64"),
      },
    });

    const result = await getFile({
      repo: "octocat/Hello-World",
      path: "src/x.ts",
      startLine: 2,
      endLine: 3,
    });

    expect(result).toBe("# lines 2-3 of src/x.ts\nb\nc");
  });

  it("throws on invalid repo format", async () => {
    await expect(getFile({ repo: "no-slash", path: "file.txt" }))
      .rejects.toThrow('Expected "owner/repo"');
  });

  it("throws when path is a directory", async () => {
    mockGetContent.mockResolvedValue({
      data: [{ name: "file.txt", type: "file" }],
    });

    await expect(getFile({ repo: "octocat/Hello-World", path: "src" }))
      .rejects.toThrow("is not a file");
  });

  it("throws when type is not file", async () => {
    mockGetContent.mockResolvedValue({
      data: { type: "symlink", content: "" },
    });

    await expect(getFile({ repo: "octocat/Hello-World", path: "link" }))
      .rejects.toThrow("is not a file");
  });
});
