import pino from "pino";

export const logger = pino(
  { name: "mcp-pr-agent-rag" },
  pino.destination(2)
);
