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
  CreateDraftPRSchema,
  formatCreateDraftPRResult,
  sanitizeUpstreamReferences,
  applySingleReplacement,
  applyReplacements,
  normalizeLineEndings,
  validatePatchedContent,
  countOccurrences,
} from "./create_draft_pr.js";

const originalToken = process.env.GITHUB_BOT_TOKEN;

const readmeOriginal = "# Hello World\n\ntypo here\n";

const baseInput = {
  repo: "octocat/Hello-World",
  forkRepo: "pr-agent-demo/Hello-World",
  branch: "fix/readme-typo",
  fileChanges: [
    { filePath: "README", edits: [{ search: "typo here", replace: "Fixed typo." }] },
  ],
  title: "fix: correct README heading",
  description: "Fixes typo in README.",
};

function encodeFile(content: string) {
  return Buffer.from(content, "utf-8").toString("base64");
}

function setupHappyPathMocks(
  defaultBranch = "master",
  files: Record<string, string> = { README: readmeOriginal }
) {
  mockReposGet.mockResolvedValue({
    data: { default_branch: defaultBranch },
  });
  mockGetRef.mockResolvedValue({
    data: { object: { sha: "base-sha-123" } },
  });
  mockCreateRef.mockResolvedValue({ data: {} });
  mockGetContent.mockImplementation(
    async ({ path }: { path: string; ref?: string }) => {
      const content = files[path];
      if (content === undefined) {
        throw new Error(`Unexpected getContent path: ${path}`);
      }
      return {
        data: {
          type: "file",
          sha: `blob-sha-${path}`,
          content: encodeFile(content),
        },
      };
    }
  );
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
  it("reads the fork file, applies search/replace, and opens a draft PR", async () => {
    setupHappyPathMocks();

    const result = await createDraftPR(baseInput);

    expect(result).toBe(
      formatCreateDraftPRResult({
        prUrl: "https://github.com/pr-agent-demo/Hello-World/pull/7",
        branch: "fix/readme-typo",
        filePaths: ["README"],
        prNumber: 7,
      })
    );

    const expectedContent = "# Hello World\n\nFixed typo.\n";
    expect(mockCreateOrUpdateFileContents).toHaveBeenCalledWith({
      owner: "pr-agent-demo",
      repo: "Hello-World",
      path: "README",
      message: baseInput.title,
      content: encodeFile(expectedContent),
      sha: "blob-sha-README",
      branch: "fix/readme-typo",
    });
    expect(mockCreateOrUpdateFileContents).toHaveBeenCalledTimes(1);
  });

  it("applies a package.json patch on the fork file", async () => {
    const pkg = '{\n  "name": "express",\n  "dependencies": {\n    "qs": "^6.14.2"\n  }\n}\n';
    setupHappyPathMocks("master", { "package.json": pkg });

    await createDraftPR({
      ...baseInput,
      repo: "expressjs/express",
      forkRepo: "pr-agent-demo/express",
      fileChanges: [
        {
          filePath: "package.json",
          edits: [{ search: '"qs": "^6.14.2"', replace: '"qs": "^6.15.2"' }],
        },
      ],
      title: "fix: bump qs",
      description: "Bump qs dependency.",
    });

    expect(mockCreateOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "package.json",
        content: encodeFile(pkg.replace('"qs": "^6.14.2"', '"qs": "^6.15.2"')),
      })
    );
  });

  it("patches multiple files on one branch and opens a single PR", async () => {
    const pkg = '{\n  "dependencies": {\n    "qs": "^6.14.2"\n  }\n}\n';
    const lock = '{\n  "packages": {\n    "": {\n      "dependencies": {\n        "qs": "^6.14.2"\n      }\n    }\n  }\n}\n';
    setupHappyPathMocks("master", {
      "package.json": pkg,
      "package-lock.json": lock,
    });

    await createDraftPR({
      ...baseInput,
      repo: "expressjs/express",
      forkRepo: "pr-agent-demo/express",
      branch: "fix/bump-qs",
      fileChanges: [
        {
          filePath: "package.json",
          edits: [{ search: '"qs": "^6.14.2"', replace: '"qs": "^6.15.2"' }],
        },
        {
          filePath: "package-lock.json",
          edits: [{ search: '"qs": "^6.14.2"', replace: '"qs": "^6.15.2"' }],
        },
      ],
      title: "fix: bump qs",
      description: "Bump qs in manifest and lockfile.",
    });

    expect(mockCreateOrUpdateFileContents).toHaveBeenCalledTimes(2);
    expect(mockCreateOrUpdateFileContents).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        path: "package.json",
        branch: "fix/bump-qs",
        message: "fix: bump qs (package.json)",
      })
    );
    expect(mockCreateOrUpdateFileContents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        path: "package-lock.json",
        branch: "fix/bump-qs",
        message: "fix: bump qs (package-lock.json)",
      })
    );
    expect(mockPullsCreate).toHaveBeenCalledTimes(1);
  });

  it("applies multiple edits in separate regions of the same file", async () => {
    const source = "alpha\nbeta\ncharlie\ndelta\n";
    setupHappyPathMocks("master", { "src/example.ts": source });

    await createDraftPR({
      ...baseInput,
      fileChanges: [
        {
          filePath: "src/example.ts",
          edits: [
            { search: "beta", replace: "BETA" },
            { search: "delta", replace: "DELTA" },
          ],
        },
      ],
    });

    expect(mockCreateOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "src/example.ts",
        content: encodeFile("alpha\nBETA\ncharlie\nDELTA\n"),
      })
    );
  });

  it("rejects duplicate filePath entries in fileChanges", () => {
    expect(() =>
      CreateDraftPRSchema.parse({
        ...baseInput,
        fileChanges: [
          { filePath: "README", edits: [{ search: "a", replace: "b" }] },
          { filePath: "README", edits: [{ search: "c", replace: "d" }] },
        ],
      })
    ).toThrow(/Duplicate filePath/);
  });

  it("throws when search is not found in the fork file", async () => {
    setupHappyPathMocks();

    await expect(
      createDraftPR({
        ...baseInput,
        fileChanges: [
          { filePath: "README", edits: [{ search: "missing text", replace: "x" }] },
        ],
      })
    ).rejects.toMatchObject({
      name: "CreateDraftPRError",
      step: "apply_patch",
      message: expect.stringContaining("file 1/1 (README)"),
    });
  });

  it("throws when search matches more than once", async () => {
    setupHappyPathMocks("master", { README: "aaa\naaa\n" });

    await expect(
      createDraftPR({
        ...baseInput,
        fileChanges: [
          { filePath: "README", edits: [{ search: "aaa", replace: "bbb" }] },
        ],
      })
    ).rejects.toMatchObject({
      name: "CreateDraftPRError",
      step: "apply_patch",
      message: expect.stringContaining("matched 2 times"),
    });
  });

  it("throws when search contains a get_file slice header", async () => {
    setupHappyPathMocks();

    await expect(
      createDraftPR({
        ...baseInput,
        fileChanges: [
          {
            filePath: "README",
            edits: [
              {
                search: "# lines 1-10 of lib/response.js\nres.cookie",
                replace: "x",
              },
            ],
          },
        ],
      })
    ).rejects.toMatchObject({
      name: "CreateDraftPRError",
      step: "parse_input",
    });
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

  it("strips upstream issue links from PR body before opening", async () => {
    setupHappyPathMocks();

    await createDraftPR({
      ...baseInput,
      description:
        "Bump qs.\n\nCloses #7304\nhttps://github.com/expressjs/express/issues/7304\nexpressjs/express#7304",
      repo: "expressjs/express",
    });

    expect(mockPullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Bump qs.",
      })
    );
  });
});

describe("applyReplacements", () => {
  it("applies multiple ordered edits", () => {
    expect(
      applyReplacements("one\ntwo\nthree", "f.txt", [
        { search: "one", replace: "1" },
        { search: "three", replace: "3" },
      ])
    ).toBe("1\ntwo\n3");
  });
});

describe("applySingleReplacement", () => {
  it("replaces a unique match", () => {
    expect(
      applySingleReplacement("a-old-b", "f.txt", "old", "new")
    ).toBe("a-new-b");
  });

  it("matches when file uses CRLF but search came from normalized get_file", () => {
    expect(
      applySingleReplacement(
        '"qs": "^6.14.2"\r\n',
        "package.json",
        '"qs": "^6.14.2"\n',
        '"qs": "^6.15.2"\n'
      )
    ).toBe('"qs": "^6.15.2"\n');
  });
});

describe("normalizeLineEndings", () => {
  it("converts CRLF and CR to LF", () => {
    expect(normalizeLineEndings("a\r\nb\rc")).toBe("a\nb\nc");
  });
});

describe("validatePatchedContent", () => {
  it("rejects invalid JSON after patch", () => {
    expect(() => validatePatchedContent("package.json", "{ not json")).toThrow(
      /not valid JSON/
    );
  });

  it("rejects get_file slice headers in patched content", () => {
    expect(() =>
      validatePatchedContent(
        "package.json",
        '{\n  "name": "express"\n}\n# lines 718-810 of lib/response.js\n'
      )
    ).toThrow(/slice header/);
  });
});

describe("countOccurrences", () => {
  it("counts non-overlapping matches", () => {
    expect(countOccurrences("aaa", "a")).toBe(3);
    expect(countOccurrences("abc", "z")).toBe(0);
  });
});

describe("sanitizeUpstreamReferences", () => {
  it("removes closing keywords, URLs, and owner/repo#issue refs", () => {
    const out = sanitizeUpstreamReferences(
      "Bump qs.\nCloses #7304\nhttps://github.com/expressjs/express/issues/7304\nexpressjs/express#7304",
      "expressjs/express"
    );
    expect(out).toBe("Bump qs.");
  });

  it("strips bare issue numbers that could autolink", () => {
    expect(
      sanitizeUpstreamReferences(
        "Bump qs dependency for issue #7304.",
        "expressjs/express"
      )
    ).toBe("Bump qs dependency for .");
  });
});
