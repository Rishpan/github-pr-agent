# mcp-pr-agent

An agentic AI system that reads a GitHub issue, retrieves relevant 
code via RAG, and opens a draft pull request — built on a custom MCP server.

## Stack
- MCP Server: TypeScript + @modelcontextprotocol/sdk
- LLM: Gemini 1.5 Flash
- Embeddings: nomic-embed-text via Ollama
- Vector Store: ChromaDB
- GitHub: Octokit

## Architecture
```
Cursor / Agent Loop
       ↓
MCP Server (STDIO)
  tools: get_file | list_files | semantic_search | create_draft_pr
       ↓
GitHub REST API
```