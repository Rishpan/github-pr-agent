import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetAuthenticated, mockGet, mockCreateFork } = vi.hoisted(() => ({
  mockGetAuthenticated: vi.fn(),
  mockGet: vi.fn(),
  mockCreateFork: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    users = { getAuthenticated: mockGetAuthenticated };
    repos = {
      get: mockGet,
      createFork: mockCreateFork,
    };
  },
}));

import { forkRepo } from "./fork_repo.js";

const originalToken = process.env.GITHUB_BOT_TOKEN;

function notFoundError() {
  return Object.assign(new Error("Not Found"), { status: 404 });
}

beforeEach(() => {
  mockGetAuthenticated.mockReset();
  mockGet.mockReset();
  mockCreateFork.mockReset();
  process.env.GITHUB_BOT_TOKEN = "test-bot-token";
});

afterEach(() => {
  process.env.GITHUB_BOT_TOKEN = originalToken;
});

describe("forkRepo", () => {
  it("returns an existing fork when the bot account already forked upstream", async () => {
    mockGetAuthenticated.mockResolvedValue({
      data: { login: "my-bot" },
    });
    mockGet.mockResolvedValue({
      data: {
        full_name: "my-bot/Hello-World",
        html_url: "https://github.com/my-bot/Hello-World",
        default_branch: "develop",
      },
    });

    const result = await forkRepo({ repo: "octocat/Hello-World" });

    expect(result).toContain("Fork ready: my-bot/Hello-World");
    expect(result).toContain("Upstream: octocat/Hello-World");
    expect(result).toContain("Status: already_exists");
    expect(result).toContain("Default branch: develop");
    expect(mockGet).toHaveBeenCalledWith({
      owner: "my-bot",
      repo: "Hello-World",
    });
    expect(mockCreateFork).not.toHaveBeenCalled();
  });

  it("creates a fork when none exists for the bot account", async () => {
    mockGetAuthenticated.mockResolvedValue({
      data: { login: "my-bot" },
    });
    mockGet
      .mockRejectedValueOnce(notFoundError())
      .mockResolvedValueOnce({
        data: {
          full_name: "my-bot/Hello-World",
          html_url: "https://github.com/my-bot/Hello-World",
          default_branch: "main",
        },
      });
    mockCreateFork.mockResolvedValue({ data: {} });

    const result = await forkRepo({ repo: "octocat/Hello-World" });

    expect(result).toContain("Fork ready: my-bot/Hello-World");
    expect(result).toContain("Status: created");
    expect(mockCreateFork).toHaveBeenCalledWith({
      owner: "octocat",
      repo: "Hello-World",
    });
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("throws on invalid repo format", async () => {
    await expect(forkRepo({ repo: "no-slash" })).rejects.toThrow(
      'Expected "owner/repo"'
    );
  });

  it("throws when GITHUB_BOT_TOKEN is missing", async () => {
    delete process.env.GITHUB_BOT_TOKEN;

    await expect(forkRepo({ repo: "octocat/Hello-World" })).rejects.toThrow(
      "GITHUB_BOT_TOKEN is required"
    );
  });
});
