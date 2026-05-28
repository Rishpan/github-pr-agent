import { ChromaClient, CloudClient } from "chromadb";
import { chromaConfig } from "../lib/config";

export function createChromaClient() {
  if (chromaConfig.apiKey) {
    return new CloudClient({
      apiKey: chromaConfig.apiKey,
      tenant: chromaConfig.tenant,
      database: chromaConfig.database,
    });
  }
  return new ChromaClient({ host: chromaConfig.host, port: chromaConfig.port });
}
