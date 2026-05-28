import pino from "pino";

export const logger = pino(
  { name: "github-pr-agent-rag" },
  pino.destination(2)
);
