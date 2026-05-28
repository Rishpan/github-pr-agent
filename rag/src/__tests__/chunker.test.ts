import { describe, it, expect } from "vitest";
import {
  chunkFile,
  chunkCode,
  nonWhitespaceSize,
  rebuildCode,
  MAX_CHUNK_SIZE,
} from "../pipeline/chunker";
import * as TreeSitter from "web-tree-sitter";

const { Parser, Language } = TreeSitter;

async function parseTs(source: string) {
  await Parser.init();
  const parser = new Parser();
  const lang = await Language.load(
    require.resolve("@repomix/tree-sitter-wasms/out/tree-sitter-typescript.wasm")
  );
  parser.setLanguage(lang);
  return parser.parse(source)!;
}

function windowSize(window: TreeSitter.Node[], source: string): number {
  return window.reduce(
    (sum, n) =>
      sum + nonWhitespaceSize(source.slice(n.startIndex, n.endIndex)),
    0
  );
}

describe("nonWhitespaceSize", () => {
  it("ignores whitespace", () => {
    expect(nonWhitespaceSize("a b\n\tc")).toBe(3);
  });
});

describe("chunkCode", () => {
  it("returns single chunk when file fits budget", async () => {
    const source = "const x = 1;\n";
    const tree = await parseTs(source);
    const windows = chunkCode(tree.rootNode, source);
    expect(windows).toHaveLength(1);
    expect(nonWhitespaceSize(rebuildCode(windows[0], source))).toBe(
      nonWhitespaceSize(source)
    );
  });

  it("splits large files into multiple chunks under MAX_CHUNK_SIZE", async () => {
    const fn = (n: number) =>
      `export function fn${n}(x: number): number {\n` +
      `  const a = ${n}; const b = ${n + 1}; const c = ${n + 2};\n` +
      `  return x + a + b + c + ${"x".repeat(80)};\n}\n`;
    let source = "";
    for (let i = 1; i <= 40; i++) source += fn(i);
    expect(nonWhitespaceSize(source)).toBeGreaterThan(MAX_CHUNK_SIZE);

    const tree = await parseTs(source);
    const windows = chunkCode(tree.rootNode, source);

    expect(windows.length).toBeGreaterThan(1);
    for (const window of windows) {
      expect(windowSize(window, source)).toBeLessThanOrEqual(MAX_CHUNK_SIZE);
    }

    const joined = windows.map((w) => rebuildCode(w, source)).join("");
    expect(joined.replace(/\s/g, "")).toBe(source.replace(/\s/g, ""));
  });
});

describe("chunkFile", () => {
  it("returns full Chunk shape", async () => {
    const source = `import { foo } from "bar";

export class MyClass {
  greet(): string {
    return "hi";
  }
}
`;
    const chunks = await chunkFile(source, "src/app.ts", "owner/repo");
    expect(chunks.length).toBeGreaterThan(0);

    const c = chunks[0];
    expect(c.id).toMatch(/^[a-f0-9]{32}$/);
    expect(c.path).toBe("src/app.ts");
    expect(c.repo).toBe("owner/repo");
    expect(c.language).toBe("typescript");
    expect(c.content).toBeTruthy();
    expect(c.contentWithImports).toContain('import { foo } from "bar"');
    expect(c.startLine).toBeGreaterThanOrEqual(1);
    expect(c.endLine).toBeGreaterThanOrEqual(c.startLine);
    expect(Array.isArray(c.classNames)).toBe(true);

    const withClass = chunks.find((ch) => ch.classNames.includes("MyClass"));
    expect(withClass).toBeDefined();
  });

  it("returns empty for unsupported extensions", async () => {
    const chunks = await chunkFile("hello", "readme.md", "r/r");
    expect(chunks).toEqual([]);
  });
});
