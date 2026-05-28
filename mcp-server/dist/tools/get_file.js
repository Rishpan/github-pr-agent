"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetFileSchema = void 0;
exports.getFile = getFile;
const zod_1 = require("zod");
const rest_1 = require("@octokit/rest");
exports.GetFileSchema = zod_1.z.object({
    repo: zod_1.z
        .string()
        .describe("GitHub repository in owner/repo format (e.g. 'octocat/Hello-World')"),
    path: zod_1.z
        .string()
        .describe("Path to the file within the repository (e.g. 'src/index.ts')"),
});
const octokit = new rest_1.Octokit({
    auth: process.env.GITHUB_TOKEN || undefined,
});
async function getFile(input) {
    const [owner, repo] = input.repo.split("/");
    if (!owner || !repo) {
        throw new Error(`Invalid repo format "${input.repo}". Expected "owner/repo".`);
    }
    const response = await octokit.repos.getContent({
        owner,
        repo,
        path: input.path,
    });
    const data = response.data;
    if (Array.isArray(data) || data.type !== "file") {
        throw new Error(`Path "${input.path}" is not a file.`);
    }
    return Buffer.from(data.content, "base64").toString("utf-8");
}
