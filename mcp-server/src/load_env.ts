import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));

config({ path: path.join(root, "../.env") });
config({ path: path.join(root, "../../rag/.env") });
