import { config } from "dotenv";
import path from "path";

// Loaded from rag/ scripts and tests (cwd is the package root).
config({ path: path.join(process.cwd(), ".env") });
