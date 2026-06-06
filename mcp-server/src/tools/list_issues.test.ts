import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIssuesListForRepo } = vi.hoisted(() => ({
  mockIssuesListForRepo: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    issues = {
      listForRepo: mockIssuesListForRepo,
    };
  },
}));

import { listIssues } from "./list_issues.js";

beforeEach(() => {
  mockIssuesListForRepo.mockReset();
});

describe("listIssues", () => {
  it("returns formatted open issues filtered by label", async () => {
    mockIssuesListForRepo.mockResolvedValue({
      data: [
        {
          number: 1234,
          title: "null pointer in createFiber when pendingProps undefined",
          html_url: "https://github.com/facebook/react/issues/1234",
          labels: [{ name: "good-first-issue" }, { name: "bug" }],
        },
        {
          number: 1189,
          title: "missing error boundary in Suspense fallback",
          html_url: "https://github.com/facebook/react/issues/1189",
          labels: [{ name: "good-first-issue" }],
        },
      ],
    });

    const result = await listIssues({
      repo: "facebook/react",
      label: "good-first-issue",
    });

    expect(result).toBe(
      `Open issues for facebook/react (label: good-first-issue):

#1234 — null pointer in createFiber when pendingProps undefined
URL: https://github.com/facebook/react/issues/1234
Labels: good-first-issue, bug

---

#1189 — missing error boundary in Suspense fallback
URL: https://github.com/facebook/react/issues/1189
Labels: good-first-issue

---`
    );

    expect(mockIssuesListForRepo).toHaveBeenCalledWith({
      owner: "facebook",
      repo: "react",
      state: "open",
      labels: "good-first-issue",
      per_page: 10,
    });
  });

  it("returns formatted open issues without a label filter", async () => {
    mockIssuesListForRepo.mockResolvedValue({
      data: [
        {
          number: 42,
          title: "Something broke",
          html_url: "https://github.com/octocat/Hello-World/issues/42",
          labels: [{ name: "bug" }],
        },
      ],
    });

    const result = await listIssues({ repo: "octocat/Hello-World" });

    expect(result).toContain("Open issues for octocat/Hello-World:");
    expect(result).toContain("#42 — Something broke");
    expect(mockIssuesListForRepo).toHaveBeenCalledWith({
      owner: "octocat",
      repo: "Hello-World",
      state: "open",
      per_page: 10,
    });
  });

  it("excludes pull requests from the results", async () => {
    mockIssuesListForRepo.mockResolvedValue({
      data: [
        {
          number: 10,
          title: "Real issue",
          html_url: "https://github.com/facebook/react/issues/10",
          labels: [],
        },
        {
          number: 11,
          title: "Actually a PR",
          html_url: "https://github.com/facebook/react/pull/11",
          labels: [],
          pull_request: { url: "https://github.com/facebook/react/pull/11" },
        },
      ],
    });

    const result = await listIssues({ repo: "facebook/react" });

    expect(result).toContain("#10 — Real issue");
    expect(result).not.toContain("#11");
  });

  it("returns empty message when no open issues match the label", async () => {
    mockIssuesListForRepo.mockResolvedValue({ data: [] });

    const result = await listIssues({
      repo: "facebook/react",
      label: "good-first-issue",
    });

    expect(result).toBe(
      "No open issues found for facebook/react with label good-first-issue"
    );
  });

  it("returns empty message when no open issues exist", async () => {
    mockIssuesListForRepo.mockResolvedValue({ data: [] });

    const result = await listIssues({ repo: "octocat/Hello-World" });

    expect(result).toBe("No open issues found for octocat/Hello-World");
  });

  it("throws ListIssuesError on invalid repo format", async () => {
    await expect(listIssues({ repo: "no-slash" })).rejects.toMatchObject({
      name: "ListIssuesError",
      repo: "no-slash",
      message: expect.stringContaining('Expected "owner/repo"'),
    });
  });

  it("wraps GitHub failures in ListIssuesError", async () => {
    mockIssuesListForRepo.mockRejectedValue(new Error("API rate limit exceeded"));

    await expect(
      listIssues({ repo: "facebook/react", label: "bug" })
    ).rejects.toMatchObject({
      name: "ListIssuesError",
      repo: "facebook/react",
      label: "bug",
      message: "API rate limit exceeded",
    });
  });
});
