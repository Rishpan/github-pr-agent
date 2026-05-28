import "dotenv/config";

export const chromaConfig = {
  host: process.env.CHROMA_HOST ?? "localhost",
  port: parseInt(process.env.CHROMA_PORT ?? "8000", 10),
  apiKey: process.env.CHROMA_API_KEY,
  tenant: process.env.CHROMA_TENANT,
  database: process.env.CHROMA_DATABASE,
};
