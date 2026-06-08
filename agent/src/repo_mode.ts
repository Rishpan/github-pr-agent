import type { AgentRequest } from "./prompt";

const REPO_SCOPED_TOOLS = new Set([
  "list_issues",
  "get_issue",
  "fork_repo",
  "index_repo",
  "semantic_search",
  "get_file",
  "list_files",
  "create_draft_pr",
]);

export class RepoModeError extends Error {
  readonly exitReason: "wrong_repo" | "no_issues" | "no_issue_selected";

  constructor(
    exitReason: RepoModeError["exitReason"],
    message: string
  ) {
    super(message);
    this.name = "RepoModeError";
    this.exitReason = exitReason;
  }
}

export function normalizeRepo(repo: string): string {
  return repo.trim().toLowerCase();
}

export function assertRepoScopedTool(
  boundRepo: string,
  toolName: string,
  args: Record<string, unknown>
): void {
  if (!REPO_SCOPED_TOOLS.has(toolName)) {
    return;
  }
  const toolRepo = args.repo;
  if (typeof toolRepo !== "string") {
    return;
  }
  if (normalizeRepo(toolRepo) !== normalizeRepo(boundRepo)) {
    throw new RepoModeError(
      "wrong_repo",
      `Repo mode is locked to ${boundRepo}. Refusing ${toolName} on ${toolRepo}. Pick an issue only from ${boundRepo}, or stop if none are available.`
    );
  }
}

export function isEmptyListIssuesResult(result: unknown, repo: string): boolean {
  const text =
    typeof result === "string" ? result : JSON.stringify(result ?? "");
  const lower = text.toLowerCase();
  return (
    lower.includes("no open issues found") &&
    lower.includes(normalizeRepo(repo))
  );
}

export interface RepoModeState {
  emptyListIssuesCount: number;
  issueSelected: boolean;
}

export function createRepoModeState(): RepoModeState {
  return { emptyListIssuesCount: 0, issueSelected: false };
}

export function assertRepoModeToolAllowed(
  request: AgentRequest,
  state: RepoModeState,
  toolName: string
): void {
  if (request.mode !== "repo") {
    return;
  }

  if (state.emptyListIssuesCount >= 2 && !state.issueSelected) {
    throw new RepoModeError(
      "no_issues",
      `No open issues found in ${request.repo} (list_issues returned empty). Repo mode does not search other repositories — exiting.`
    );
  }

  if (toolName === "fork_repo" && !state.issueSelected) {
    throw new RepoModeError(
      "no_issue_selected",
      `Call get_issue on an issue from ${request.repo} before fork_repo.`
    );
  }
}

export function updateRepoModeStateAfterTool(
  request: AgentRequest,
  state: RepoModeState,
  toolName: string,
  args: Record<string, unknown>,
  result: unknown
): void {
  if (request.mode !== "repo") {
    return;
  }

  if (
    toolName === "list_issues" &&
    typeof args.repo === "string" &&
    normalizeRepo(args.repo) === normalizeRepo(request.repo) &&
    isEmptyListIssuesResult(result, request.repo)
  ) {
    state.emptyListIssuesCount += 1;
  }

  if (
    toolName === "get_issue" &&
    typeof args.repo === "string" &&
    normalizeRepo(args.repo) === normalizeRepo(request.repo)
  ) {
    state.issueSelected = true;
  }
}

type ExecutableTool = {
  execute?: (args: unknown, options: unknown) => Promise<unknown>;
};

export function wrapToolsForRepoMode<T>(
  tools: T,
  request: AgentRequest,
  state: RepoModeState
): T {
  if (request.mode !== "repo") {
    return tools;
  }

  const boundRepo = request.repo;
  const wrapped: Record<string, ExecutableTool> = {
    ...(tools as Record<string, ExecutableTool>),
  };

  for (const toolName of Object.keys(wrapped)) {
    const tool = wrapped[toolName];
    if (!tool?.execute) {
      continue;
    }
    const originalExecute = tool.execute.bind(tool);
    wrapped[toolName] = {
      ...tool,
      execute: async (args: unknown, options: unknown) => {
        const argObj = (args ?? {}) as Record<string, unknown>;
        assertRepoModeToolAllowed(request, state, toolName);
        assertRepoScopedTool(boundRepo, toolName, argObj);
        const result = await originalExecute(args, options);
        updateRepoModeStateAfterTool(
          request,
          state,
          toolName,
          argObj,
          result
        );
        return result;
      },
    };
  }

  return wrapped as T;
}
