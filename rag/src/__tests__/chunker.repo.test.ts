import { describe, it, expect } from "vitest";
import path from "path";
import { chunkRepo } from "../pipeline/chunker";

const fixtureRoot = path.join(__dirname, "fixtures", "sample-repo");

describe("chunkRepo", () => {
  it("chunks all source files under localPath and returns combined chunks", async () => {
    const chunks = await chunkRepo(fixtureRoot);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].repo).toBe("sample-repo");
    expect(chunks[0].path).toBe("src/util.ts");
    expect(chunks[0].language).toBe("typescript");
    expect(chunks.some((c) => c.classNames.includes("Util"))).toBe(true);
  });
});
