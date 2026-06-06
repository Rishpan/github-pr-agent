import { describe, it, expect } from "vitest";
import {
  chunkFile,
  chunkCode,
  nonWhitespaceSize,
  rebuildCode,
  MAX_CHUNK_SIZE,
  classifyFileKind,
  buildEmbeddingText,
  extractFirstJsdocSummary,
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

describe("classifyFileKind", () => {
  it("marks test paths", () => {
    expect(classifyFileKind("test/index_test.ts")).toBe("test");
    expect(classifyFileKind("src/__tests__/auth.test.ts")).toBe("test");
  });

  it("marks source paths", () => {
    expect(classifyFileKind("src/index.ts")).toBe("source");
    expect(classifyFileKind("lib/util.ts")).toBe("source");
  });
});

describe("extractFirstJsdocSummary", () => {
  it("returns the first summary line", () => {
    const summary = extractFirstJsdocSummary(
      "/** Register handlers.\n * @param x\n */\nfunction on() {}"
    );
    expect(summary).toBe("Register handlers.");
  });
});

describe("buildEmbeddingText", () => {
  it("includes path, symbols, and body", async () => {
    const chunks = await chunkFile(
      `/** Tiny emitter */\nexport function on() {}\n`,
      "src/index.ts",
      "owner/repo"
    );
    const text = buildEmbeddingText(chunks[0]);
    expect(text).toContain("File: src/index.ts");
    expect(text).toContain("Symbols:");
    expect(text).toContain("Tiny emitter");
    expect(text).toContain("export function on()");
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
