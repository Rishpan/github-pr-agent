import dotenv from "dotenv";
import path from "path";
import pino from "pino";
import { runAgent } from "./agent";
import type { AgentRequest } from "./prompt";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const logger = pino({ name: "github-pr-agent-agent" }, pino.destination(2));

const ISSUE_URL_PATTERN = /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/i;
const REPO_SLUG_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

export function parseIssueUrl(issueUrl: string): {
  repo: string;
  issueNumber: number;
} {
  const match = issueUrl.match(ISSUE_URL_PATTERN);
  if (!match) {
    throw new Error(
      'Invalid GitHub issue URL. Expected format: https://github.com/{owner}/{repo}/issues/{number}'
    );
  }

  const [, owner, repoName, numberStr] = match;
  const issueNumber = Number.parseInt(numberStr, 10);
  if (!Number.isFinite(issueNumber) || issueNumber <= 0) {
    throw new Error(`Invalid issue number in URL: ${numberStr}`);
  }

  return { repo: `${owner}/${repoName}`, issueNumber };
}

export function parseRepoSlug(repo: string): string {
  if (!REPO_SLUG_PATTERN.test(repo)) {
    throw new Error(
      'Invalid repo slug. Expected format: owner/repo (letters, numbers, dots, hyphens, underscores only)'
    );
  }
  return repo;
}

function printUsage(): void {
  console.log(`Usage:
  npx ts-node src/index.ts <issue-url> [--dry-run]
  npx ts-node src/index.ts --repo owner/repo [--dry-run]

Examples:
  npx ts-node src/index.ts https://github.com/expressjs/express/issues/1234
  npx ts-node src/index.ts --repo expressjs/express --dry-run`);
}

function parseArgs(argv: string[]): AgentRequest {
  const dryRun = argv.includes("--dry-run");
  const args = argv.filter((arg) => arg !== "--dry-run");

  const repoFlagIndex = args.indexOf("--repo");
  if (repoFlagIndex !== -1) {
    const repo = args[repoFlagIndex + 1];
    if (!repo || repo.startsWith("-")) {
      throw new Error("Missing value for --repo. Expected owner/repo.");
    }
    if (args.length !== 2) {
      throw new Error("With --repo, pass only owner/repo (not an issue URL).");
    }
    return { mode: "repo", repo: parseRepoSlug(repo), dryRun };
  }

  const issueUrl = args[0];
  if (!issueUrl || args.length !== 1) {
    throw new Error("Expected a single issue URL, or use --repo owner/repo.");
  }

  const { repo, issueNumber } = parseIssueUrl(issueUrl);
  return { mode: "issue", issueUrl, repo, issueNumber, dryRun };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const positional = argv.filter((arg) => arg !== "--dry-run");

  if (positional.length === 0) {
    printUsage();
    process.exit(1);
  }

  try {
    const request = parseArgs(argv);
    const result = await runAgent(request);
    console.log(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "agent_run_failed");
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
