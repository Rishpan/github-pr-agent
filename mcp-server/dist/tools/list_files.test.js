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
const list_files_js_1 = require("./list_files.js");
(0, vitest_1.beforeEach)(() => {
    mockGetContent.mockReset();
});
(0, vitest_1.describe)("listFiles", () => {
    (0, vitest_1.it)("returns file list as JSON", async () => {
        mockGetContent.mockResolvedValue({
            data: [
                { name: "index.ts", type: "file", path: "src/index.ts", size: 512 },
                { name: "utils", type: "dir", path: "src/utils", size: 0 },
            ],
        });
        const raw = await (0, list_files_js_1.listFiles)({ repo: "octocat/Hello-World", directory: "src" });
        const result = JSON.parse(raw);
        (0, vitest_1.expect)(result.files).toHaveLength(2);
        (0, vitest_1.expect)(result.files[0]).toEqual({
            name: "index.ts",
            type: "file",
            path: "src/index.ts",
            size: 512,
            extension: "ts",
        });
        (0, vitest_1.expect)(result.files[1]).toEqual({
            name: "utils",
            type: "dir",
            path: "src/utils",
            size: 0,
            extension: null,
        });
        (0, vitest_1.expect)(mockGetContent).toHaveBeenCalledWith({
            owner: "octocat",
            repo: "Hello-World",
            path: "src",
        });
    });
    (0, vitest_1.it)("handles files without extensions", async () => {
        mockGetContent.mockResolvedValue({
            data: [
                { name: "Makefile", type: "file", path: "Makefile", size: 300 },
            ],
        });
        const raw = await (0, list_files_js_1.listFiles)({ repo: "octocat/Hello-World", directory: "" });
        const result = JSON.parse(raw);
        (0, vitest_1.expect)(result.files[0].extension).toBeNull();
    });
    (0, vitest_1.it)("throws on invalid repo format", async () => {
        await (0, vitest_1.expect)((0, list_files_js_1.listFiles)({ repo: "no-slash", directory: "src" }))
            .rejects.toThrow('Expected "owner/repo"');
    });
    (0, vitest_1.it)("throws when path is not a directory", async () => {
        mockGetContent.mockResolvedValue({
            data: { name: "file.txt", type: "file", content: "" },
        });
        await (0, vitest_1.expect)((0, list_files_js_1.listFiles)({ repo: "octocat/Hello-World", directory: "file.txt" }))
            .rejects.toThrow("is not a directory");
    });
});
