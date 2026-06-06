# github-pr-agent

Work-in-progress: an agent that reads a GitHub issue, finds relevant code with RAG, and opens a draft PR. The pieces live in three packages under this repo.

## What's here now

| Package | Status |
|---------|--------|
| `mcp-server/` | MCP server (stdio): `get_file`, `list_files`, `index_repo`, `semantic_search` |
| `rag/` | Clone, AST chunking, Ollama embeddings, Chroma index + retrieval |
| `agent/` | Scaffold only (`package.json`, `.env.example`) — no `src/` yet |

Not built yet: `create_draft_pr` MCP tool and the Gemini agent loop.

## How it fits together

```
MCP client (stdio) or npm run dev
        │
        ▼
  mcp-server/          ──► GitHub API (get_file, list_files)
        │                ──► RAG (index_repo, semantic_search)
        ▼
  rag/                 clone → chunk → embed → Chroma
        │
        ▼
  agent/               (planned) issue → plan → draft PR
```

Clones land under the OS temp dir (`%TEMP%\github-pr-agent\...` on Windows, `$TMP/...` elsewhere). Each repo gets a Chroma collection `code-<owner>--<repo>`. `semantic_search` over-fetches neighbors, applies a relative similarity cutoff (default floor `RAG_MIN_SIMILARITY=0.45`), optionally boosts `src/` over `test/`, and labels matches as strong/moderate/weak. Re-run `index_repo` after pipeline changes so chunks include `fileKind` metadata.

## Prerequisites

- Node 18+
- [Ollama](https://ollama.com/) with `nomic-embed-text`
- Chroma (Docker Desktop on Windows is typical), or Chroma Cloud via env vars

Optional: `GITHUB_TOKEN` in `mcp-server/.env` for better GitHub rate limits.

## Environment

Copy examples and fill in secrets locally (never commit `.env`):

```bash
cp mcp-server/.env.example mcp-server/.env
cp rag/.env.example rag/.env
```

`mcp-server` loads both `.env` files on startup (`src/load_env.ts`). Put `GITHUB_TOKEN` in `mcp-server/.env`.

RAG keys: `CHROMA_HOST`, `CHROMA_PORT`, `OLLAMA_HOST`, `OLLAMA_PORT`, `OLLAMA_EMBED_MODEL`.

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
| `npm start` | MCP server only (Chroma and Ollama must already be running) |
| `npm run dev` | Windows: `start.ps1` — Chroma, Ollama, model pull, then MCP |
| `npm run dev:bash` | macOS/Linux/Git Bash: `start.sh` |

Point an MCP client at this process over stdio (`npx tsx src/index.ts` from `mcp-server/`).

**Tools**

| Tool | Description |
|------|-------------|
| `get_file` | Raw file from a public repo |
| `list_files` | List a directory (`directory` defaults to `""` = repo root) |
| `index_repo` | Clone, chunk, embed, upsert into Chroma (slow) |
| `semantic_search` | Query indexed code (`index_repo` first) |

Typical flow: `index_repo` → `semantic_search` on the same `owner/repo`.

### Agent (`agent/`)

Dependencies listed; implementation not started.

## Tests

```bash
cd rag && npm test
cd mcp-server && npm test
```

## Stack

- TypeScript, MCP SDK, Octokit, Ollama + nomic-embed-text, ChromaDB, web-tree-sitter
- Agent (planned): Gemini 1.5 Flash
