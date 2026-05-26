import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetContent } = vi.hoisted(() => ({
  mockGetContent: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    repos = { getContent: mockGetContent };
  },
}));

import { listFiles } from "./list_files.js";

beforeEach(() => {
  mockGetContent.mockReset();
});

describe("listFiles", () => {
  it("returns file list as JSON", async () => {
    mockGetContent.mockResolvedValue({
      data: [
        { name: "index.ts", type: "file", path: "src/index.ts", size: 512 },
        { name: "utils", type: "dir", path: "src/utils", size: 0 },
      ],
    });

    const raw = await listFiles({ repo: "octocat/Hello-World", directory: "src" });
    const result = JSON.parse(raw);

    expect(result.files).toHaveLength(2);
    expect(result.files[0]).toEqual({
      name: "index.ts",
      type: "file",
      path: "src/index.ts",
      size: 512,
      extension: "ts",
    });
    expect(result.files[1]).toEqual({
      name: "utils",
      type: "dir",
      path: "src/utils",
      size: 0,
      extension: null,
    });
    expect(mockGetContent).toHaveBeenCalledWith({
      owner: "octocat",
      repo: "Hello-World",
      path: "src",
    });
  });

  it("handles files without extensions", async () => {
    mockGetContent.mockResolvedValue({
      data: [
        { name: "Makefile", type: "file", path: "Makefile", size: 300 },
      ],
    });

    const raw = await listFiles({ repo: "octocat/Hello-World", directory: "" });
    const result = JSON.parse(raw);

    expect(result.files[0].extension).toBeNull();
  });

  it("throws on invalid repo format", async () => {
    await expect(listFiles({ repo: "no-slash", directory: "src" }))
      .rejects.toThrow('Expected "owner/repo"');
  });

  it("throws when path is not a directory", async () => {
    mockGetContent.mockResolvedValue({
      data: { name: "file.txt", type: "file", content: "" },
    });

    await expect(listFiles({ repo: "octocat/Hello-World", directory: "file.txt" }))
      .rejects.toThrow("is not a directory");
  });
});
