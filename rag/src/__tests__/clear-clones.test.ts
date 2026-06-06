import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  clearCloneCache,
  ClearCloneCacheError,
  cloneCacheRoot,
  clonePathForRepo,
} from "../pipeline/cloner";

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "github-pr-agent-test-"));
const testCacheRoot = path.join(tmpBase, "github-pr-agent");

function managedClonePath(owner: string, repo: string): string {
  return path.join(testCacheRoot, owner, repo);
}

function writeManagedClone(owner: string, repo: string): string {
  const dir = managedClonePath(owner, repo);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, ".git"));
  fs.writeFileSync(path.join(dir, "README.md"), "# test");
  return dir;
}

beforeEach(() => {
  process.env.GITHUB_PR_AGENT_CLONE_CACHE = testCacheRoot;
  if (fs.existsSync(testCacheRoot)) {
    fs.rmSync(testCacheRoot, { recursive: true, force: true });
  }
});

afterEach(() => {
  delete process.env.GITHUB_PR_AGENT_CLONE_CACHE;
  if (fs.existsSync(tmpBase)) {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  }
});

describe("clearCloneCache", () => {
  it("deletes one managed clone by repo slug", () => {
    const express = writeManagedClone("expressjs", "express");
    writeManagedClone("octocat", "Hello-World");

    const result = clearCloneCache({ repo: "expressjs/express" });

    expect(result.deleted).toEqual([express]);
    expect(fs.existsSync(express)).toBe(false);
    expect(fs.existsSync(managedClonePath("octocat", "Hello-World"))).toBe(true);
  });

  it("deletes all managed clones with all: true", () => {
    const a = writeManagedClone("expressjs", "express");
    const b = writeManagedClone("octocat", "Hello-World");

    const result = clearCloneCache({ all: true });

    expect(result.deleted.sort()).toEqual([a, b].sort());
    expect(fs.existsSync(a)).toBe(false);
    expect(fs.existsSync(b)).toBe(false);
  });

  it("dry run lists paths without deleting", () => {
    const express = writeManagedClone("expressjs", "express");

    const result = clearCloneCache({ repo: "expressjs/express", dryRun: true });

    expect(result.deleted).toEqual([express]);
    expect(fs.existsSync(express)).toBe(true);
  });

  it("skips directories without .git", () => {
    const stray = managedClonePath("expressjs", "express");
    fs.mkdirSync(stray, { recursive: true });
    fs.writeFileSync(path.join(stray, "notes.txt"), "not a clone");

    expect(() => clearCloneCache({ repo: "expressjs/express" })).toThrow(
      ClearCloneCacheError
    );
    expect(fs.existsSync(stray)).toBe(true);
  });

  it("skips unexpected paths when cleaning all", () => {
    const managed = writeManagedClone("expressjs", "express");
    const strayOwner = path.join(testCacheRoot, "random-folder");
    fs.mkdirSync(strayOwner, { recursive: true });
    fs.writeFileSync(path.join(strayOwner, "file.txt"), "keep me");

    const result = clearCloneCache({ all: true });

    expect(result.deleted).toEqual([managed]);
    expect(result.skipped).toContain(strayOwner);
    expect(fs.existsSync(strayOwner)).toBe(true);
  });

  it("rejects invalid repo slugs", () => {
    expect(() => clearCloneCache({ repo: "../etc/passwd" })).toThrow(
      ClearCloneCacheError
    );
    expect(() => clearCloneCache({ repo: "bad/slug/with/slash" })).toThrow(
      ClearCloneCacheError
    );
  });

  it("returns empty result when clone does not exist", () => {
    const result = clearCloneCache({ repo: "expressjs/express" });
    expect(result.deleted).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("requires repo or all", () => {
    expect(() => clearCloneCache({})).toThrow(ClearCloneCacheError);
  });
});

describe("clonePathForRepo", () => {
  it("places repos under the managed cache root", () => {
    expect(clonePathForRepo("expressjs/express")).toBe(
      path.join(testCacheRoot, "expressjs", "express")
    );
    expect(cloneCacheRoot()).toBe(testCacheRoot);
  });
});
