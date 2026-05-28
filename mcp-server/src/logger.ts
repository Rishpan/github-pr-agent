import pino from "pino";

export const logger = pino(
  { name: "github-pr-agent" },
  pino.destination(2)
);
