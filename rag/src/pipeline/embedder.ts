import { ollamaBaseUrl, ollamaConfig } from "../lib/config";
import { logger } from "../lib/logger";
import { buildEmbeddingText, type Chunk } from "./chunker";

/** nomic-embed-text retrieval prefixes (https://huggingface.co/nomic-ai/nomic-embed-text) */
export type EmbedTask = "document" | "query";

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

export class EmbedError extends Error {
  constructor(message: string, cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause ?? "");
    super(detail ? `${message}: ${detail}` : message);
    this.name = "EmbedError";
  }
}

interface OllamaEmbedResponse {
  model: string;
  embeddings: number[][];
}

const BATCH_SIZE = 16;

function prefixForTask(text: string, task: EmbedTask): string {
  return task === "query" ? `search_query: ${text}` : `search_document: ${text}`;
}

async function callOllamaEmbed(inputs: string[]): Promise<number[][]> {
  const url = `${ollamaBaseUrl()}/api/embed`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: ollamaConfig.model,
      input: inputs.length === 1 ? inputs[0] : inputs,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new EmbedError(
      `Ollama embed failed (${res.status})`,
      new Error(body.slice(0, 500))
    );
  }

  const data = (await res.json()) as OllamaEmbedResponse;
  if (!data.embeddings?.length) {
    throw new EmbedError("Ollama returned no embeddings");
  }
  if (data.embeddings.length !== inputs.length) {
    throw new EmbedError(
      `Expected ${inputs.length} embeddings, got ${data.embeddings.length}`
    );
  }

  return data.embeddings;
}

/** Embed a single string (document or query task). */
export async function embedText(
  text: string,
  task: EmbedTask = "document"
): Promise<number[]> {
  const log = logger.child({ tool: "embedder", task });
  log.info({ chars: text.length, model: ollamaConfig.model }, "Embedding text");

  try {
    const [embedding] = await callOllamaEmbed([prefixForTask(text, task)]);
    log.info({ dimensions: embedding.length }, "Embedding complete");
    return embedding;
  } catch (err) {
    log.error({ err }, "Embedding failed");
    throw err instanceof EmbedError ? err : new EmbedError("Embedding failed", err);
  }
}

/** Embed one chunk using enriched embedding text (path, symbols, JSDoc). */
export async function embedChunk(
  chunk: Chunk,
  task: EmbedTask = "document"
): Promise<EmbeddedChunk> {
  const embedding = await embedText(buildEmbeddingText(chunk), task);
  return { ...chunk, embedding };
}

/** Embed many chunks in batches via Ollama /api/embed. */
export async function embedChunks(
  chunks: Chunk[],
  task: EmbedTask = "document"
): Promise<EmbeddedChunk[]> {
  const log = logger.child({ tool: "embedder", task });
  log.info({ chunkCount: chunks.length, model: ollamaConfig.model }, "Embedding chunks");

  if (chunks.length === 0) {
    log.warn("No chunks to embed");
    return [];
  }

  const results: EmbeddedChunk[] = [];

  try {
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const inputs = batch.map((c) => prefixForTask(buildEmbeddingText(c), task));
      const embeddings = await callOllamaEmbed(inputs);

      for (let j = 0; j < batch.length; j++) {
        results.push({ ...batch[j], embedding: embeddings[j] });
      }

      log.info(
        { done: Math.min(i + batch.length, chunks.length), total: chunks.length },
        "Embedding batch progress"
      );
    }

    log.info(
      { chunkCount: results.length, dimensions: results[0]?.embedding.length },
      "Embedding chunks complete"
    );
    return results;
  } catch (err) {
    log.error({ err }, "Embedding chunks failed");
    throw err instanceof EmbedError ? err : new EmbedError("Embedding chunks failed", err);
  }
}
