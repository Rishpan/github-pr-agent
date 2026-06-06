import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIssuesGet, mockListComments } = vi.hoisted(() => ({
  mockIssuesGet: vi.fn(),
  mockListComments: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    issues = {
      get: mockIssuesGet,
      listComments: mockListComments,
    };
  },
}));

import { getIssue } from "./get_issue.js";

beforeEach(() => {
  mockIssuesGet.mockReset();
  mockListComments.mockReset();
});

describe("getIssue", () => {
  it("returns formatted issue details and comments", async () => {
    mockIssuesGet.mockResolvedValue({
      data: {
        title: "null pointer in createFiber when pendingProps undefined",
        body: "Repro steps:\n1. Render without props",
        state: "open",
        labels: [{ name: "bug" }, { name: "good-first-issue" }],
      },
    });
    mockListComments.mockResolvedValue({
      data: [
        {
          user: { login: "alice" },
          body: "I can reproduce this.",
        },
        {
          user: { login: "bob" },
          body: "Likely missing null check.",
        },
      ],
    });

    const result = await getIssue({
      repo: "facebook/react",
      issueNumber: 1234,
    });

    expect(result).toBe(
      `Issue #1234: null pointer in createFiber when pendingProps undefined
Repo: facebook/react
Labels: bug, good-first-issue
State: open

Body:
Repro steps:
1. Render without props

Comments (2):
---
@alice:
I can reproduce this.
---
@bob:
Likely missing null check.
---`
    );

    expect(mockIssuesGet).toHaveBeenCalledWith({
      owner: "facebook",
      repo: "react",
      issue_number: 1234,
    });
    expect(mockListComments).toHaveBeenCalledWith({
      owner: "facebook",
      repo: "react",
      issue_number: 1234,
    });
  });

  it("returns Comments (0): when there are no comments", async () => {
    mockIssuesGet.mockResolvedValue({
      data: {
        title: "Docs typo",
        body: "Fix README",
        state: "open",
        labels: [],
      },
    });
    mockListComments.mockResolvedValue({ data: [] });

    const result = await getIssue({
      repo: "octocat/Hello-World",
      issueNumber: 1,
    });

    expect(result).toContain("Comments (0):");
    expect(result).toContain("Labels: none");
  });

  it("throws GetIssueError on invalid repo format", async () => {
    await expect(
      getIssue({ repo: "no-slash", issueNumber: 1234 })
    ).rejects.toMatchObject({
      name: "GetIssueError",
      repo: "no-slash",
      issueNumber: 1234,
      message: expect.stringContaining('Expected "owner/repo"'),
    });
  });

  it("throws GetIssueError when the number is a pull request", async () => {
    mockIssuesGet.mockResolvedValue({
      data: {
        title: "Fix bug",
        body: "",
        state: "open",
        labels: [],
        pull_request: { url: "https://github.com/pull/1" },
      },
    });
    mockListComments.mockResolvedValue({ data: [] });

    await expect(
      getIssue({ repo: "facebook/react", issueNumber: 99 })
    ).rejects.toMatchObject({
      name: "GetIssueError",
      repo: "facebook/react",
      issueNumber: 99,
      message: "#99 is a pull request, not an issue.",
    });
  });

  it("wraps GitHub failures in GetIssueError", async () => {
    mockIssuesGet.mockRejectedValue(new Error("Not Found"));
    mockListComments.mockResolvedValue({ data: [] });

    await expect(
      getIssue({ repo: "facebook/react", issueNumber: 1234 })
    ).rejects.toMatchObject({
      name: "GetIssueError",
      repo: "facebook/react",
      issueNumber: 1234,
      message: "Not Found",
    });
  });
});
