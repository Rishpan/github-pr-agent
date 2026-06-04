import type { Collection, Metadata } from "chromadb";
import { createChromaClient } from "../db/chroma";
import { logger } from "../lib/logger";
import { cloneRepo, CloneError } from "./cloner";
import { chunkRepo, type Chunk } from "./chunker";
import { embedChunks, EmbedError, type EmbeddedChunk } from "./embedder";

const UPSERT_BATCH_SIZE = 100;

export class IndexerError extends Error {
  constructor(
    public readonly repo: string,
    cause: unknown
  ) {
    const message =
      cause instanceof Error ? cause.message : String(cause);
    super(`Failed to index "${repo}": ${message}`);
    this.name = "IndexerError";
  }
}

export interface IndexResult {
  repo: string;
  localPath: string;
  chunkCount: number;
  collectionName: string;
}

/** Chroma-safe collection name for owner/repo (e.g. code-octocat--Hello-World). */
export function collectionNameForRepo(repo: string): string {
  const safe = repo.replace(/\//g, "--").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `code-${safe}`;
}

/** Shared Chroma collection options for index + query (manual embeddings, cosine). */
export function collectionOptionsForRepo(repo: string) {
  return {
    name: collectionNameForRepo(repo),
    embeddingFunction: null,
    metadata: { repo, source: "github-pr-agent", "hnsw:space": "cosine" },
  };
}

function chunkToMetadata(chunk: Chunk): Metadata {
  return {
    path: chunk.path,
    repo: chunk.repo,
    language: chunk.language,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    classNames: chunk.classNames.join(","),
  };
}

async function upsertEmbeddedChunks(
  collection: Collection,
  embedded: EmbeddedChunk[]
): Promise<void> {
  for (let i = 0; i < embedded.length; i += UPSERT_BATCH_SIZE) {
    const batch = embedded.slice(i, i + UPSERT_BATCH_SIZE);
    await collection.upsert({
      ids: batch.map((c) => c.id),
      embeddings: batch.map((c) => c.embedding),
      documents: batch.map((c) => c.content),
      metadatas: batch.map(chunkToMetadata),
    });
  }
}

/**
 * Clone a GitHub repo, chunk it, embed chunks with Ollama, and upsert into Chroma.
 */
export async function indexRepo(repo: string): Promise<IndexResult> {
  const log = logger.child({ tool: "indexer", repo });
  const collectionName = collectionNameForRepo(repo);

  log.info({ collectionName }, "Starting repo index");

  try {
    const localPath = await cloneRepo(repo);
    const chunks = await chunkRepo(localPath);

    if (chunks.length === 0) {
      log.warn({ localPath }, "No chunks produced; skipping embed and Chroma upsert");
      return { repo, localPath, chunkCount: 0, collectionName };
    }

    const embedded = await embedChunks(chunks);
    const client = createChromaClient();
    const collection = await client.getOrCreateCollection(
      collectionOptionsForRepo(repo)
    );

    await upsertEmbeddedChunks(collection, embedded);

    log.info(
      { chunkCount: embedded.length, collectionName, localPath },
      "Repo index complete"
    );

    return {
      repo,
      localPath,
      chunkCount: embedded.length,
      collectionName,
    };
  } catch (err) {
    log.error({ err }, "Repo index failed");
    if (err instanceof CloneError || err instanceof EmbedError) {
      throw err;
    }
    throw new IndexerError(repo, err);
  }
}
