export const chromaConfig = {
  host: process.env.CHROMA_HOST ?? "localhost",
  port: parseInt(process.env.CHROMA_PORT ?? "8000", 10),
  apiKey: process.env.CHROMA_API_KEY,
  tenant: process.env.CHROMA_TENANT,
  database: process.env.CHROMA_DATABASE,
};

export const ollamaConfig = {
  host: process.env.OLLAMA_HOST ?? "localhost",
  port: parseInt(process.env.OLLAMA_PORT ?? "11434", 10),
  model: process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text",
};

export function ollamaBaseUrl(): string {
  return `http://${ollamaConfig.host}:${ollamaConfig.port}`;
}

/** Semantic search tuning (see rag/.env.example). */
export const retrieverConfig = {
  minSimilarity: parseFloat(process.env.RAG_MIN_SIMILARITY ?? "0.45"),
  relativeCutoffDelta: parseFloat(process.env.RAG_RELATIVE_CUTOFF_DELTA ?? "0.08"),
  overFetchMultiplier: parseInt(process.env.RAG_OVER_FETCH_MULTIPLIER ?? "3", 10),
  maxOverFetch: parseInt(process.env.RAG_MAX_OVER_FETCH ?? "50", 10),
  sourcePathBoost: parseFloat(process.env.RAG_SOURCE_PATH_BOOST ?? "0.04"),
  testPathPenalty: parseFloat(process.env.RAG_TEST_PATH_PENALTY ?? "0.04"),
};
