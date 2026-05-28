import path from "path";
import fs from "fs";
import simpleGit from "simple-git";
import { logger } from "../lib/logger";

export class CloneError extends Error {
  constructor(public readonly repo: string, cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : String(cause);
    super(`Failed to clone "${repo}": ${message}`);
    this.name = "CloneError";
  }
}

export async function cloneRepo(repo: string): Promise<string> {
  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    throw new CloneError(repo, new Error(`Invalid repo format. Expected "owner/repo".`));
  }

  const log = logger.child({ tool: "cloner", repo });
  const dest = path.join("/tmp", "mcp-pr-agent", owner, repoName);

  try {
    if (fs.existsSync(path.join(dest, ".git"))) {
      log.info({ dest }, "Repo already exists, pulling latest");
      const git = simpleGit(dest);
      await git.pull();
      log.info({ dest }, "Pull complete");
    } else {
      const url = `https://github.com/${repo}.git`;
      log.info({ dest, url }, "Cloning repo");
      await simpleGit().clone(url, dest);
      log.info({ dest }, "Clone complete");
    }
  } catch (err) {
    log.error({ err }, "Clone/pull failed");
    throw new CloneError(repo, err);
  }

  return dest;
}
