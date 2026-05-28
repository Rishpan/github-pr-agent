"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const { mockGetContent } = vitest_1.vi.hoisted(() => ({
    mockGetContent: vitest_1.vi.fn(),
}));
vitest_1.vi.mock("@octokit/rest", () => ({
    Octokit: class {
        repos = { getContent: mockGetContent };
    },
}));
const get_file_js_1 = require("./get_file.js");
(0, vitest_1.beforeEach)(() => {
    mockGetContent.mockReset();
});
(0, vitest_1.describe)("getFile", () => {
    (0, vitest_1.it)("returns decoded file content", async () => {
        mockGetContent.mockResolvedValue({
            data: {
                type: "file",
                content: Buffer.from("hello world").toString("base64"),
            },
        });
        const result = await (0, get_file_js_1.getFile)({ repo: "octocat/Hello-World", path: "README.md" });
        (0, vitest_1.expect)(result).toBe("hello world");
        (0, vitest_1.expect)(mockGetContent).toHaveBeenCalledWith({
            owner: "octocat",
            repo: "Hello-World",
            path: "README.md",
        });
    });
    (0, vitest_1.it)("throws on invalid repo format", async () => {
        await (0, vitest_1.expect)((0, get_file_js_1.getFile)({ repo: "no-slash", path: "file.txt" }))
            .rejects.toThrow('Expected "owner/repo"');
    });
    (0, vitest_1.it)("throws when path is a directory", async () => {
        mockGetContent.mockResolvedValue({
            data: [{ name: "file.txt", type: "file" }],
        });
        await (0, vitest_1.expect)((0, get_file_js_1.getFile)({ repo: "octocat/Hello-World", path: "src" }))
            .rejects.toThrow("is not a file");
    });
    (0, vitest_1.it)("throws when type is not file", async () => {
        mockGetContent.mockResolvedValue({
            data: { type: "symlink", content: "" },
        });
        await (0, vitest_1.expect)((0, get_file_js_1.getFile)({ repo: "octocat/Hello-World", path: "link" }))
            .rejects.toThrow("is not a file");
    });
});
