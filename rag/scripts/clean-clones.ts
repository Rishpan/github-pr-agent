import {
  CLONE_CACHE_DIR_NAME,
  clearCloneCache,
  ClearCloneCacheError,
  cloneCacheRoot,
} from "../src/pipeline/cloner";

function printUsage(): void {
  const cacheRoot = cloneCacheRoot();
  console.log(`Remove cloned repos from the managed cache only.

Cache root: ${cacheRoot}

Safeguards:
  - Only deletes under {tmpdir}/${CLONE_CACHE_DIR_NAME}/
  - Only removes directories with a .git folder at owner/repo depth
  - Skips anything outside that layout (never touches your project or home dir)

Usage:
  npm run clean:clones -- --dry-run --all
  npm run clean:clones -- --dry-run expressjs/express
  npm run clean:clones -- --yes --all
  npm run clean:clones -- --yes expressjs/express

Flags:
  --dry-run   List what would be deleted (no writes)
  --yes       Confirm deletion
  --all       Delete every managed clone in the cache
  owner/repo  Delete one managed clone

You must pass either --dry-run or --yes.`);
}

function parseArgs(argv: string[]): {
  dryRun: boolean;
  yes: boolean;
  all: boolean;
  repo?: string;
} {
  const dryRun = argv.includes("--dry-run");
  const yes = argv.includes("--yes");
  const all = argv.includes("--all");
  const positional = argv.filter(
    (arg) => arg !== "--dry-run" && arg !== "--yes" && arg !== "--all"
  );
  const repo = positional[0];

  return { dryRun, yes, all, repo };
}

function main(): void {
  const { dryRun, yes, all, repo } = parseArgs(process.argv.slice(2));

  if (!dryRun && !yes) {
    printUsage();
    process.exit(0);
  }

  if (all && repo) {
    console.error("Error: pass either --all or owner/repo, not both.");
    process.exit(1);
  }

  if (!all && !repo) {
    console.error("Error: pass --all or owner/repo.");
    printUsage();
    process.exit(1);
  }

  try {
    const result = clearCloneCache({
      repo: all ? undefined : repo,
      all,
      dryRun,
    });

    const action = dryRun ? "Would delete" : "Deleted";
    if (result.deleted.length === 0) {
      console.log("No managed clones found to delete.");
    } else {
      console.log(`${action} ${result.deleted.length} clone(s):`);
      for (const dir of result.deleted) {
        console.log(`  - ${dir}`);
      }
    }

    if (result.skipped.length > 0) {
      console.log(`Skipped ${result.skipped.length} path(s) (not managed clones):`);
      for (const dir of result.skipped) {
        console.log(`  - ${dir}`);
      }
    }
  } catch (err) {
    const message =
      err instanceof ClearCloneCacheError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
