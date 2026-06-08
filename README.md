# github-pr-agent

An agent that reads a GitHub issue, finds relevant code with RAG, and opens a draft PR. The repo is split into three packages: MCP tools, RAG pipeline, and an LLM agent loop that orchestrates the tools.

## What's here now

| Package | Status |
|---------|--------|
| `mcp-server/` | MCP server (stdio) — 9 tools for GitHub + RAG + draft PRs |
| `rag/` | Clone, AST chunking, Ollama embeddings, Chroma index + retrieval |
| `agent/` | Gemini/Groq agent via Vercel AI SDK — spawns MCP, runs issue → draft PR loop |

## How it fits together

```
agent/                    issue → plan → tool calls → draft PR
        │
        │  MCP (stdio, auto-spawned)
        ▼
mcp-server/               GitHub API + RAG wrappers
        │
        ├── get_issue, list_issues, get_file, list_files
        ├── fork_repo, create_draft_pr
        └── index_repo, semantic_search
        │
        ▼
rag/                      clone → chunk → embed → Chroma
```

### End-to-end flow

1. `get_issue` — read issue body and comments (or `list_issues` to pick one)
2. `fork_repo` — fork upstream into the bot account
3. `index_repo` — clone, chunk, embed, upsert into Chroma
4. `semantic_search` — find relevant code from the issue title/description
5. `get_file` / `list_files` — read or explore files as needed
6. `create_draft_pr` — branch on the fork, apply patches to one or more files, open draft PR

The agent runs this flow autonomously. You can also call the MCP tools manually from Cursor or another MCP client.

### Demo bot account

Forks and draft PRs are created under the dedicated demo GitHub account **[pr-agent-demo](https://github.com/pr-agent-demo)** (e.g. `pr-agent-demo/express` when fixing `expressjs/express`). This keeps upstream repos untouched. For your own runs, set `GITHUB_BOT_TOKEN` to a PAT for a bot account you control — do not commit tokens.

### Demo example

A live run on [expressjs/express#7304](https://github.com/expressjs/express/issues/7304) opened **[pr-agent-demo/express#3](https://github.com/pr-agent-demo/express/pull/3)** — a draft PR on the bot fork that bumps `qs` to `6.15.2` (CVE GHSA-q8mj-m7cp-5q26). The PR title/body explain the fix without linking back to the upstream issue.

```bash
cd agent
npm start -- https://github.com/expressjs/express/issues/7304
```

Use `--dry-run` first to print the proposed `fileChanges[]` without opening a PR.

## MCP tools

| Tool | Description |
|------|-------------|
| `get_issue` | Fetch an issue and its comments |
| `list_issues` | List open issues for a repo, optionally filtered by label |
| `get_file` | Raw file content from a public repo; optional `startLine`/`endLine` for ranged reads |
| `list_files` | List a directory (`directory` defaults to repo root) |
| `fork_repo` | Fork upstream into the bot account (idempotent) |
| `create_draft_pr` | One branch + draft PR on the fork; `fileChanges[]` with per-file `edits[]` search/replace patches |
| `index_repo` | Clone, chunk, embed, upsert into Chroma; skips if already indexed unless `force=true` |
| `semantic_search` | Query indexed code — returns file locations and symbols, not code bodies |

## Prerequisites

- Node 18+
- [Ollama](https://ollama.com/) with `nomic-embed-text`
- Chroma (Docker Desktop on Windows is typical), or Chroma Cloud via env vars
- `GITHUB_BOT_TOKEN` — PAT for the bot account (`fork_repo`, `create_draft_pr`); demos use [pr-agent-demo](https://github.com/pr-agent-demo)
- Optional: `GITHUB_TOKEN` — improves GitHub rate limits for read-only calls
- For the agent: a [Gemini](https://aistudio.google.com/apikey) or [Groq](https://console.groq.com/keys) API key

## Environment

Copy examples and fill in secrets locally (never commit `.env`):

```bash
cp mcp-server/.env.example mcp-server/.env
cp rag/.env.example rag/.env
cp agent/.env.example agent/.env
```

`mcp-server` loads both `mcp-server/.env` and `rag/.env` on startup (`src/load_env.ts`).

**mcp-server**

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | Optional; public repo reads |
| `GITHUB_BOT_TOKEN` | Required for fork + draft PR tools (demo account: [pr-agent-demo](https://github.com/pr-agent-demo)) |
| `CHROMA_*`, `OLLAMA_*` | Same as `rag/` (index + search) |

**rag**

| Variable | Purpose |
|----------|---------|
| `CHROMA_HOST`, `CHROMA_PORT` | Chroma server |
| `OLLAMA_HOST`, `OLLAMA_PORT`, `OLLAMA_EMBED_MODEL` | Embeddings |
| `GITHUB_PR_AGENT_CLONE_CACHE` | Optional; persistent clone dir (default: OS temp) |
| `RAG_SEARCH_RESULT_MODE` | `metadata` (default) or `preview` for semantic search output |
| `RAG_MAX_GET_FILE_LINES` | Cap ranged `get_file` reads (default: `150`) |
| `RAG_*` | Other search/index tuning (see `rag/.env.example`) |

**agent**

| Variable | Purpose |
|----------|---------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Gemini API key (default provider) |
| `GOOGLE_MODEL` | Default: `gemini-2.5-flash` (1.5 models are shut down) |
| `GROQ_API_KEY` | Groq API key (when using Groq) |
| `GROQ_MODEL` | Default: `llama-3.1-8b-instant` (70b hits TPM limits quickly) |
| `LLM_PROVIDER` | Set to `groq` to use Groq; omit for Gemini |
| `AGENT_MAX_STEPS` | Tool loop cap (default: `10`) |

## Setup

### RAG (`rag/`)

```bash
cd rag
npm install
cp .env.example .env
npm run chroma          # Docker Chroma on :8000
ollama serve
ollama pull nomic-embed-text
```

| Command | Purpose |
|---------|---------|
| `npm run chroma` | Start Chroma in Docker |
| `npm run chroma:stop` | Stop and remove Chroma container |
| `npm run clean:clones` | Remove local clone cache (requires `--dry-run` or `--yes`) |
| `npm test` | Vitest |

### MCP server (`mcp-server/`)

```bash
cd mcp-server
npm install
cp .env.example .env   # add GITHUB_BOT_TOKEN at minimum
```

| Command | Purpose |
|---------|---------|
| `npm start` | MCP server only (Chroma and Ollama must already be running) |
| `npm run dev` | Windows: `start.ps1` — Chroma, Ollama, model pull, then MCP |
| `npm run dev:bash` | macOS/Linux/Git Bash: `start.sh` |
| `npm test` | Vitest |

Point an MCP client at this process over stdio (`npx tsx src/index.ts` from `mcp-server/`).

Typical RAG flow: `index_repo` on `owner/repo`, then `semantic_search` with the same repo slug.

### Clone cache

Clones default to `{tmpdir}/github-pr-agent/{owner}/{repo}`. On Windows that is `%TEMP%\github-pr-agent\...`. Temp is disposable — Windows cleanup or a reboot can remove clones. The Chroma index is separate and survives clone deletion.

To keep clones on disk, set `GITHUB_PR_AGENT_CLONE_CACHE` in `rag/.env`:

```env
GITHUB_PR_AGENT_CLONE_CACHE=D:/github-pr-agent-clones
```

To remove clones safely:

```bash
cd rag
npm run clean:clones -- --dry-run --all          # preview
npm run clean:clones -- --yes expressjs/express  # one repo
npm run clean:clones -- --yes --all              # all managed clones
```

The script only deletes directories under the clone cache with a `.git` folder at `owner/repo` depth.

Each indexed repo gets a Chroma collection `code-<owner>--<repo>`. `semantic_search` over-fetches neighbors, dedupes by file path, applies a relative similarity cutoff (default floor `RAG_MIN_SIMILARITY=0.45`), optionally boosts `src/` over `test/`, and returns metadata-only locations by default (path, lines, symbols, JSDoc — no code bodies). Use `get_file` with `startLine`/`endLine` to read the relevant region; omit the range for the full file when patching.

Re-index existing collections after upgrading to pick up `functionNames` and `jsdocSummary` in search metadata (`index_repo` with `force=true`).

### Agent (`agent/`)

The agent spawns the MCP server over stdio, connects all 9 tools to a Gemini or Groq model via the [Vercel AI SDK](https://sdk.vercel.ai/), and runs a phased workflow: setup → context gathering → patch generation → draft PR.

Chroma and Ollama must be running before you start the agent (same as the MCP server).

```bash
cd agent
npm install
cp .env.example .env   # add GOOGLE_GENERATIVE_AI_API_KEY or GROQ_API_KEY
```

**Run on a specific issue** (see [Demo example](#demo-example) — [pr-agent-demo/express#3](https://github.com/pr-agent-demo/express/pull/3)):

```bash
npm start -- https://github.com/expressjs/express/issues/7304
npm start -- https://github.com/expressjs/express/issues/7304 --dry-run
```

**Run in repo mode** (agent picks an issue via `list_issues` with label `good-first-issue`):

```bash
npm start -- --repo expressjs/express
npm start -- --repo expressjs/express --dry-run
```

`--dry-run` skips `create_draft_pr` and prints the proposed fix instead.

The agent loads env from `agent/.env`. MCP inherits `process.env`, so tokens and Chroma/Ollama settings from `mcp-server/.env` and `rag/.env` must be available — run from a shell where those are loaded, or copy the needed vars into `agent/.env`.

**Token usage:** Search returns locations only; investigation uses ranged `get_file` reads (capped at `RAG_MAX_GET_FILE_LINES`); repeat runs skip re-indexing when Chroma already has chunks. Set `RAG_SEARCH_RESULT_MODE=preview` to restore truncated code snippets for debugging.

## Tests

```bash
cd rag && npm test
cd mcp-server && npm test
```

## Stack

- TypeScript, MCP SDK, Octokit, Ollama + nomic-embed-text, ChromaDB, web-tree-sitter
- Agent: Vercel AI SDK (`ai`, `@ai-sdk/google`, `@ai-sdk/groq`) with Gemini or Groq
