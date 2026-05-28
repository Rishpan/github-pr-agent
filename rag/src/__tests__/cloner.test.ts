import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockClone, mockPull, mockExistsSync } = vi.hoisted(() => ({
  mockClone: vi.fn(),
  mockPull: vi.fn(),
  mockExistsSync: vi.fn(),
}));

vi.mock("simple-git", () => ({
  default: (baseDir?: string) => {
    if (baseDir) {
      return { pull: mockPull };
    }
    return { clone: mockClone };
  },
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, default: { ...actual, existsSync: mockExistsSync } };
});

vi.mock("../lib/logger", () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { cloneRepo, CloneError } from "../pipeline/cloner";

beforeEach(() => {
  mockClone.mockReset();
  mockPull.mockReset();
  mockExistsSync.mockReset();
});

describe("cloneRepo", () => {
  it("clones a new repo and returns the destination path", async () => {
    mockExistsSync.mockReturnValue(false);
    mockClone.mockResolvedValue(undefined);

    const result = await cloneRepo("octocat/Hello-World");

    expect(result).toContain("octocat");
    expect(result).toContain("Hello-World");
    expect(mockClone).toHaveBeenCalledWith(
      "https://github.com/octocat/Hello-World.git",
      expect.stringContaining("Hello-World")
    );
    expect(mockPull).not.toHaveBeenCalled();
  });

  it("pulls latest when repo already exists", async () => {
    mockExistsSync.mockReturnValue(true);
    mockPull.mockResolvedValue(undefined);

    const result = await cloneRepo("octocat/Hello-World");

    expect(result).toContain("Hello-World");
    expect(mockPull).toHaveBeenCalled();
    expect(mockClone).not.toHaveBeenCalled();
  });

  it("throws CloneError on invalid repo format", async () => {
    await expect(cloneRepo("no-slash")).rejects.toThrow(CloneError);
    await expect(cloneRepo("no-slash")).rejects.toThrow("owner/repo");
  });

  it("throws CloneError with repo name when clone fails", async () => {
    mockExistsSync.mockReturnValue(false);
    mockClone.mockRejectedValue(new Error("network error"));

    try {
      await cloneRepo("octocat/Hello-World");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CloneError);
      expect((err as CloneError).repo).toBe("octocat/Hello-World");
      expect((err as CloneError).message).toContain("network error");
    }
  });

  it("throws CloneError with repo name when pull fails", async () => {
    mockExistsSync.mockReturnValue(true);
    mockPull.mockRejectedValue(new Error("auth failed"));

    try {
      await cloneRepo("octocat/Hello-World");
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CloneError);
      expect((err as CloneError).repo).toBe("octocat/Hello-World");
      expect((err as CloneError).message).toContain("auth failed");
    }
  });
});
