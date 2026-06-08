import dotenv from "dotenv";
import path from "path";

/** Load agent, MCP, and RAG env so spawned MCP can reach Ollama/Chroma/GitHub. */
export function loadAgentEnv(): void {
  const agentRoot = path.resolve(__dirname, "..");
  const repoRoot = path.resolve(agentRoot, "..");

  dotenv.config({ path: path.join(agentRoot, ".env") });
  dotenv.config({ path: path.join(repoRoot, "mcp-server", ".env") });
  dotenv.config({ path: path.join(repoRoot, "rag", ".env") });
}
