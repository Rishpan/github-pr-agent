import pino from "pino";

export const logger = pino(
  { name: "mcp-pr-agent" },
  pino.destination(2)
);
