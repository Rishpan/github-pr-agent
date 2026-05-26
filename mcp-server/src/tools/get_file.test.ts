import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetContent } = vi.hoisted(() => ({
  mockGetContent: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    repos = { getContent: mockGetContent };
  },
}));

import { getFile } from "./get_file.js";

beforeEach(() => {
  mockGetContent.mockReset();
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
