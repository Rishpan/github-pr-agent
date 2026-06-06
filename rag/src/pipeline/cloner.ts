import path from "path";
import fs from "fs";
import os from "os";
import simpleGit from "simple-git";
import { logger } from "../lib/logger";

export const CLONE_CACHE_DIR_NAME = "github-pr-agent";

const SAFE_REPO_SEGMENT = /^[a-zA-Z0-9._-]+$/;

export class CloneError extends Error {
  constructor(public readonly repo: string, cause: unknown) {
    const message =
      cause instanceof Error ? cause.message : String(cause);
    super(`Failed to clone "${repo}": ${message}`);
    this.name = "CloneError";
  }
}

export class ClearCloneCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClearCloneCacheError";
  }
}

export interface ClearCloneCacheResult {
  deleted: string[];
  skipped: string[];
}

/** Root directory for all cloned repos: {tmpdir}/github-pr-agent (override with GITHUB_PR_AGENT_CLONE_CACHE). */
export function cloneCacheRoot(): string {
  const override = process.env.GITHUB_PR_AGENT_CLONE_CACHE;
  if (override) {
    return path.resolve(override);
  }
  return path.join(os.tmpdir(), CLONE_CACHE_DIR_NAME);
}

/** Validate owner/repo and return path segments. */
export function parseRepoSlug(repo: string): { owner: string; repoName: string } {
  const parts = repo.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid repo format. Expected "owner/repo".`);
  }

  const [owner, repoName] = parts;
  if (!owner || !repoName) {
    throw new Error(`Invalid repo format. Expected "owner/repo".`);
  }
  if (!SAFE_REPO_SEGMENT.test(owner) || !SAFE_REPO_SEGMENT.test(repoName)) {
    throw new Error(
      `Invalid repo slug. Owner and repo must contain only letters, numbers, dots, hyphens, and underscores.`
    );
  }

  return { owner, repoName };
}

/** Local clone path for owner/repo under the managed cache. */
export function clonePathForRepo(repo: string): string {
  const { owner, repoName } = parseRepoSlug(repo);
  return path.join(cloneCacheRoot(), owner, repoName);
}

function isPathInsideRoot(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function assertSafeCloneCacheRoot(root: string): void {
  const resolved = path.resolve(root);
  const override = process.env.GITHUB_PR_AGENT_CLONE_CACHE;

  if (override) {
    if (resolved !== path.resolve(override)) {
      throw new ClearCloneCacheError(
        "Refusing to clean: clone cache path does not match GITHUB_PR_AGENT_CLONE_CACHE."
      );
    }
    return;
  }

  const tmp = path.resolve(os.tmpdir());

  if (!isPathInsideRoot(tmp, resolved)) {
    throw new ClearCloneCacheError(
      "Refusing to clean: clone cache must live under the system temp directory."
    );
  }

  if (path.basename(resolved) !== CLONE_CACHE_DIR_NAME) {
    throw new ClearCloneCacheError(
      `Refusing to clean: clone cache root must be named "${CLONE_CACHE_DIR_NAME}".`
    );
  }
}

function isManagedCloneDir(dir: string, cacheRoot: string): boolean {
  if (!fs.existsSync(path.join(dir, ".git"))) {
    return false;
  }

  const relative = path.relative(cacheRoot, dir);
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length !== 2) {
    return false;
  }

  return (
    SAFE_REPO_SEGMENT.test(parts[0]) &&
    SAFE_REPO_SEGMENT.test(parts[1])
  );
}

function listManagedCloneDirs(cacheRoot: string): {
  managed: string[];
  skipped: string[];
} {
  const managed: string[] = [];
  const skipped: string[] = [];

  if (!fs.existsSync(cacheRoot)) {
    return { managed, skipped };
  }

  for (const owner of fs.readdirSync(cacheRoot)) {
    const ownerPath = path.join(cacheRoot, owner);
    let ownerStat: fs.Stats;
    try {
      ownerStat = fs.statSync(ownerPath);
    } catch {
      skipped.push(ownerPath);
      continue;
    }

    if (!ownerStat.isDirectory() || !SAFE_REPO_SEGMENT.test(owner)) {
      skipped.push(ownerPath);
      continue;
    }

    let managedUnderOwner = false;

    for (const repoName of fs.readdirSync(ownerPath)) {
      const repoPath = path.join(ownerPath, repoName);
      let repoStat: fs.Stats;
      try {
        repoStat = fs.statSync(repoPath);
      } catch {
        skipped.push(repoPath);
        continue;
      }

      if (!repoStat.isDirectory()) {
        skipped.push(repoPath);
        continue;
      }

      if (isManagedCloneDir(repoPath, cacheRoot)) {
        managed.push(repoPath);
        managedUnderOwner = true;
      } else {
        skipped.push(repoPath);
      }
    }

    if (!managedUnderOwner) {
      skipped.push(ownerPath);
    }
  }

  return { managed, skipped };
}

/**
 * Remove cloned repos from the managed cache only.
 * Requires an explicit repo slug or `all: true`. Use `dryRun` to preview.
 */
export function clearCloneCache(options: {
  repo?: string;
  all?: boolean;
  dryRun?: boolean;
}): ClearCloneCacheResult {
  const cacheRoot = cloneCacheRoot();
  assertSafeCloneCacheRoot(cacheRoot);

  const toDelete: string[] = [];
  let skipped: string[] = [];

  if (options.repo) {
    let target: string;
    try {
      target = clonePathForRepo(options.repo);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ClearCloneCacheError(message);
    }
    if (!isPathInsideRoot(cacheRoot, target)) {
      throw new ClearCloneCacheError(
        `Refusing to delete "${target}": path escapes clone cache.`
      );
    }

    if (fs.existsSync(target)) {
      if (!isManagedCloneDir(target, cacheRoot)) {
        throw new ClearCloneCacheError(
          `Refusing to delete "${target}": not a managed clone (missing .git or invalid owner/repo layout).`
        );
      }
      toDelete.push(target);
    }
  } else if (options.all) {
    const listed = listManagedCloneDirs(cacheRoot);
    toDelete.push(...listed.managed);
    skipped = listed.skipped;
  } else {
    throw new ClearCloneCacheError(
      'Specify a repo slug ("owner/repo") or pass all: true.'
    );
  }

  const deleted: string[] = [];
  for (const dir of toDelete) {
    if (!isPathInsideRoot(cacheRoot, dir)) {
      throw new ClearCloneCacheError(
        `Refusing to delete "${dir}": path escapes clone cache.`
      );
    }
    if (!isManagedCloneDir(dir, cacheRoot)) {
      skipped.push(dir);
      continue;
    }

    if (!options.dryRun) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    deleted.push(dir);
  }

  return { deleted, skipped };
}

export async function cloneRepo(repo: string): Promise<string> {
  let dest: string;
  try {
    dest = clonePathForRepo(repo);
  } catch (err) {
    throw new CloneError(repo, err);
  }

  const log = logger.child({ tool: "cloner", repo });

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
