import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockReposGet,
  mockGetRef,
  mockCreateRef,
  mockGetContent,
  mockCreateOrUpdateFileContents,
  mockPullsCreate,
} = vi.hoisted(() => ({
  mockReposGet: vi.fn(),
  mockGetRef: vi.fn(),
  mockCreateRef: vi.fn(),
  mockGetContent: vi.fn(),
  mockCreateOrUpdateFileContents: vi.fn(),
  mockPullsCreate: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    repos = {
      get: mockReposGet,
      getContent: mockGetContent,
      createOrUpdateFileContents: mockCreateOrUpdateFileContents,
    };
    git = {
      getRef: mockGetRef,
      createRef: mockCreateRef,
    };
    pulls = {
      create: mockPullsCreate,
    };
  },
}));

import {
  createDraftPR,
  formatCreateDraftPRResult,
} from "./create_draft_pr.js";

const originalToken = process.env.GITHUB_BOT_TOKEN;

const baseInput = {
  repo: "octocat/Hello-World",
  forkRepo: "pr-agent-demo/Hello-World",
  branch: "fix/readme-typo",
  filePath: "README",
  newContent: "# Hello World\n\nFixed typo.",
  title: "fix: correct README heading",
  description: "Fixes typo in upstream octocat/Hello-World README.",
};

function setupHappyPathMocks(defaultBranch = "master") {
  mockReposGet.mockResolvedValue({
    data: { default_branch: defaultBranch },
  });
  mockGetRef.mockResolvedValue({
    data: { object: { sha: "base-sha-123" } },
  });
  mockCreateRef.mockResolvedValue({ data: {} });
  mockGetContent.mockResolvedValue({
    data: { type: "file", sha: "blob-sha-456" },
  });
  mockCreateOrUpdateFileContents.mockResolvedValue({ data: {} });
  mockPullsCreate.mockResolvedValue({
    data: {
      html_url: "https://github.com/pr-agent-demo/Hello-World/pull/7",
      number: 7,
    },
  });
}

beforeEach(() => {
  mockReposGet.mockReset();
  mockGetRef.mockReset();
  mockCreateRef.mockReset();
  mockGetContent.mockReset();
  mockCreateOrUpdateFileContents.mockReset();
  mockPullsCreate.mockReset();
  process.env.GITHUB_BOT_TOKEN = "test-bot-token";
});

afterEach(() => {
  process.env.GITHUB_BOT_TOKEN = originalToken;
});

describe("createDraftPR", () => {
  it("creates a branch, commits the file, and opens a draft PR on the fork", async () => {
    setupHappyPathMocks();

    const result = await createDraftPR(baseInput);

    expect(result).toBe(
      formatCreateDraftPRResult({
        prUrl: "https://github.com/pr-agent-demo/Hello-World/pull/7",
        branch: "fix/readme-typo",
        filePath: "README",
        prNumber: 7,
      })
    );

    expect(mockReposGet).toHaveBeenCalledWith({
      owner: "pr-agent-demo",
      repo: "Hello-World",
    });
    expect(mockGetRef).toHaveBeenCalledWith({
      owner: "pr-agent-demo",
      repo: "Hello-World",
      ref: "heads/master",
    });
    expect(mockCreateRef).toHaveBeenCalledWith({
      owner: "pr-agent-demo",
      repo: "Hello-World",
      ref: "refs/heads/fix/readme-typo",
      sha: "base-sha-123",
    });
    expect(mockGetContent).toHaveBeenCalledWith({
      owner: "pr-agent-demo",
      repo: "Hello-World",
      path: "README",
      ref: "master",
    });
    expect(mockCreateOrUpdateFileContents).toHaveBeenCalledWith({
      owner: "pr-agent-demo",
      repo: "Hello-World",
      path: "README",
      message: baseInput.title,
      content: Buffer.from(baseInput.newContent, "utf-8").toString("base64"),
      sha: "blob-sha-456",
      branch: "fix/readme-typo",
    });
    expect(mockPullsCreate).toHaveBeenCalledWith({
      owner: "pr-agent-demo",
      repo: "Hello-World",
      title: baseInput.title,
      body: baseInput.description,
      head: "fix/readme-typo",
      base: "master",
      draft: true,
    });
    expect(mockPullsCreate).toHaveBeenCalledTimes(1);
  });

  it("throws CreateDraftPRError on invalid forkRepo format", async () => {
    await expect(
      createDraftPR({ ...baseInput, forkRepo: "no-slash" })
    ).rejects.toMatchObject({
      name: "CreateDraftPRError",
      step: "parse_input",
      message: expect.stringContaining('Expected "owner/repo"'),
    });
  });

  it("throws when GITHUB_BOT_TOKEN is missing", async () => {
    delete process.env.GITHUB_BOT_TOKEN;

    await expect(createDraftPR(baseInput)).rejects.toMatchObject({
      name: "CreateDraftPRError",
      step: "authenticate",
      message: expect.stringContaining("GITHUB_BOT_TOKEN is required"),
    });
  });

  it("wraps GitHub failures with the failing step name", async () => {
    setupHappyPathMocks();
    mockCreateRef.mockRejectedValue(new Error("Reference already exists"));

    await expect(createDraftPR(baseInput)).rejects.toMatchObject({
      name: "CreateDraftPRError",
      step: "create_branch",
      message: "Reference already exists",
    });
  });
});
