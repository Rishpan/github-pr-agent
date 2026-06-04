// NOTE: Future task is to add: whereDocument filter + MMR
import type { Collection, Metadata, QueryResult, Where } from "chromadb";
import { createChromaClient } from "../db/chroma";
import { embedText } from "./embedder";
import { collectionOptionsForRepo } from "./indexer";

const MIN_SIMILARITY = 0.5;

export interface ChunkSearchResult {
    content: string
    path: string
    repo: string
    startLine: number
    endLine: number
    language: string
    classNames: string[]
    similarityScore: number
  }

function buildSearchResult(
    id: string,
    document: string | null,
    metadata: Metadata | null,
    distance: number | null
): ChunkSearchResult | null {
    if (document === null || metadata === null || distance === null) {
        return null;
    }

    const classNamesRaw = metadata.classNames;
    const classNames =
        typeof classNamesRaw === "string" && classNamesRaw.length > 0
            ? classNamesRaw.split(",")
            : [];

    return {
        content: document,
        path: String(metadata.path ?? id),
        repo: String(metadata.repo ?? ""),
        startLine: Number(metadata.startLine ?? 0),
        endLine: Number(metadata.endLine ?? 0),
        language: String(metadata.language ?? ""),
        classNames,
        similarityScore: 1 - distance,
    };
}

function formatResults(response: QueryResult): ChunkSearchResult[] {
    const ids = response.ids[0] ?? [];
    return ids
        .map((id, index) =>
            buildSearchResult(
                id,
                response.documents?.[0]?.[index] ?? null,
                response.metadatas?.[0]?.[index] ?? null,
                response.distances?.[0]?.[index] ?? null
            )
        )
        .filter((result): result is ChunkSearchResult => result !== null)
        .filter((result) => result.similarityScore >= MIN_SIMILARITY);
}


export async function semanticSearch(
    query: string,
    repo: string,
    topK: number,
    where?: Where
): Promise<ChunkSearchResult[]> {
    const collection = await getCollection(repo);
    const queryEmbedding = await embedQuery(query);
    const results = await collection.query({
        queryEmbeddings: [queryEmbedding],
        nResults: topK,
        where,
    });
    return formatResults(results);
}

export async function embedQuery(query: string): Promise<number[]> {
    return await embedText(query, "query");
}

export async function getCollection(repo: string): Promise<Collection> {
    const client = createChromaClient();
    return client.getOrCreateCollection(collectionOptionsForRepo(repo));
}

