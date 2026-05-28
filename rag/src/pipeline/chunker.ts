/**
 * cAST: structure-aware chunking via AST (arXiv:2506.15655).
 * Implements Algorithm 1 (ChunkCode + ChunkNodes) with split-then-merge.
 * https://arxiv.org/abs/2506.15655
 */
import { createHash } from "crypto";
import * as TreeSitter from "web-tree-sitter";
import path from "path";
import { logger } from "../lib/logger";
import fs from "fs/promises";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build"]);
const { Parser, Language } = TreeSitter;

/** @see arXiv:2506.15655 §4 — default max_chunk_size 2000 (non-whitespace chars) */
export const MAX_CHUNK_SIZE = 2000;

/** Skip tiny windows (e.g. lone braces or whitespace-only nodes). */
export const MIN_CHUNK_SIZE = 50;

const EXT_TO_GRAMMAR: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".rb": "ruby",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".hpp": "cpp",
  ".cs": "c_sharp",
  ".css": "css",
  ".php": "php",
  ".swift": "swift",
  ".dart": "dart",
  ".sol": "solidity",
  ".vue": "vue",
};

const IMPORT_NODE_TYPES = new Set([
  "import_statement",
  "import_declaration",
  "import_from_statement",
  "import_alias",
  "use_declaration",
  "preproc_include",
  "using_declaration",
]);

const CLASS_NODE_TYPES = new Set([
  "class_declaration",
  "class_definition",
  "class_specifier",
  "struct_item",
  "interface_declaration",
  "enum_declaration",
  "enum_item",
  "trait_item",
  "impl_item",
]);

type SyntaxNode = TreeSitter.Node;

export function getGrammarForFile(filePath: string): string | null {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_GRAMMAR[ext] ?? null;
}

export interface Chunk {
  id: string;
  content: string;
  contentWithImports: string;
  path: string;
  repo: string;
  language: string;
  startLine: number;
  endLine: number;
  classNames: string[];
}

let initialized = false;
const languageCache = new Map<string, TreeSitter.Language>();

/** @see arXiv:2506.15655 §2 "Chunk size metric" */
export function nonWhitespaceSize(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== " " && c !== "\t" && c !== "\n" && c !== "\r") count++;
  }
  return count;
}

function nodeText(node: SyntaxNode, source: string): string {
  return source.slice(node.startIndex, node.endIndex);
}

function nodeSize(node: SyntaxNode, source: string): number {
  return nonWhitespaceSize(nodeText(node, source));
}

function windowSize(window: SyntaxNode[], source: string): number {
  return window.reduce((sum, n) => sum + nodeSize(n, source), 0);
}

/**
 * Rebuild source from sibling nodes (restores whitespace between nodes).
 * @see arXiv:2506.15655 §2 — plug-and-play: chunks concatenate to full file
 */
export function rebuildCode(nodes: SyntaxNode[], source: string): string {
  if (nodes.length === 0) return "";

  let code = "";
  let currentLine = nodes[0].startPosition.row;
  let currentCol = nodes[0].startPosition.column;

  if (currentCol > 0) {
    code += " ".repeat(currentCol);
  }

  for (const node of nodes) {
    const { row: startLine, column: startCol } = node.startPosition;
    const { row: endLine, column: endCol } = node.endPosition;

    if (startLine > currentLine) {
      code += "\n".repeat(startLine - currentLine);
      currentLine = startLine;
      currentCol = 0;
    }
    if (startCol > currentCol) {
      code += " ".repeat(startCol - currentCol);
      currentCol = startCol;
    }

    code += nodeText(node, source);
    currentLine = endLine;
    currentCol = endCol;
  }

  return code;
}

function getNodeName(node: SyntaxNode, source: string): string | null {
  const byField = node.childForFieldName("name");
  if (byField) return nodeText(byField, source);

  for (const child of node.children) {
    if (
      child.type === "identifier" ||
      child.type === "property_identifier" ||
      child.type === "type_identifier"
    ) {
      return nodeText(child, source);
    }
  }
  return null;
}

function extractMetadata(
  nodes: SyntaxNode[],
  source: string
): { classNames: string[] } {
  const classNames: string[] = [];
  const seen = new Set<string>();

  function walk(node: SyntaxNode) {
    if (CLASS_NODE_TYPES.has(node.type)) {
      const name = getNodeName(node, source);
      if (name && !seen.has(name)) {
        seen.add(name);
        classNames.push(name);
      }
    }
    for (const child of node.children) walk(child);
  }

  for (const node of nodes) walk(node);
  return { classNames };
}

function extractImports(root: SyntaxNode, source: string): string {
  const lines: string[] = [];
  for (const child of root.children) {
    if (IMPORT_NODE_TYPES.has(child.type)) {
      lines.push(nodeText(child, source));
    }
  }
  return lines.join("\n");
}

/**
 * Greedy merge of adjacent sibling windows after recursive split.
 * @see arXiv:2506.15655 §2 Fig. 2 — merge step
 */
function mergeAdjacentWindows(
  windows: SyntaxNode[][],
  source: string
): SyntaxNode[][] {
  if (windows.length === 0) return [];

  const merged: SyntaxNode[][] = [windows[0].slice()];

  for (let i = 1; i < windows.length; i++) {
    const prev = merged[merged.length - 1];
    const next = windows[i];
    const combinedSize = windowSize(prev, source) + windowSize(next, source);

    if (combinedSize <= MAX_CHUNK_SIZE) {
      prev.push(...next);
    } else {
      merged.push(next.slice());
    }
  }

  return merged;
}

/**
 * Algorithm 1 — ChunkNodes: greedy pack siblings, recurse if node too large.
 * @see arXiv:2506.15655 Appendix A.3
 */
export function chunkNodes(nodes: SyntaxNode[], source: string): SyntaxNode[][] {
  if (nodes.length === 0) return [];

  const chunks: SyntaxNode[][] = [];
  let current: SyntaxNode[] = [];
  let currentSize = 0;

  for (const node of nodes) {
    const size = nodeSize(node, source);
    const exceedsLimit = size > MAX_CHUNK_SIZE;
    const wontFit = currentSize + size > MAX_CHUNK_SIZE;

    if ((current.length === 0 && exceedsLimit) || wontFit) {
      if (current.length > 0) {
        chunks.push(current);
        current = [];
        currentSize = 0;
      }

      if (exceedsLimit) {
        const childWindows = chunkNodes(node.children, source);
        chunks.push(...mergeAdjacentWindows(childWindows, source));
        continue;
      }

      current.push(node);
      currentSize = size;
    } else {
      current.push(node);
      currentSize += size;
    }
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

/**
 * Algorithm 1 — ChunkCode: one chunk if whole tree fits, else chunk children.
 * @see arXiv:2506.15655 Appendix A.3
 */
export function chunkCode(root: SyntaxNode, source: string): SyntaxNode[][] {
  if (nodeSize(root, source) <= MAX_CHUNK_SIZE) {
    return [[root]];
  }
  return chunkNodes(root.children, source);
}

function chunkId(
  repo: string,
  filePath: string,
  startLine: number,
  endLine: number,
  index: number
): string {
  const key = `${repo}:${filePath}:${startLine}-${endLine}:${index}`;
  return createHash("md5").update(key).digest("hex");
}

function windowsToChunks(
  windows: SyntaxNode[][],
  source: string,
  filePath: string,
  repo: string,
  language: string,
  importBlock: string
): Chunk[] {
  return windows
    .map((window, index) => {
      const content = rebuildCode(window, source);
      const startLine = window[0].startPosition.row + 1;
      const endLine = window[window.length - 1].endPosition.row + 1;
      const { classNames } = extractMetadata(window, source);

      const contentWithImports = importBlock
        ? `${importBlock}\n\n${content}`
        : content;

      return {
        id: chunkId(repo, filePath, startLine, endLine, index),
        content,
        contentWithImports,
        path: filePath,
        repo,
        language,
        startLine,
        endLine,
        classNames,
      };
    })
    .filter((chunk) => nonWhitespaceSize(chunk.content) >= MIN_CHUNK_SIZE);
}

async function loadLanguage(grammar: string): Promise<TreeSitter.Language> {
  let lang = languageCache.get(grammar);
  if (!lang) {
    lang = await Language.load(
      require.resolve(`@repomix/tree-sitter-wasms/out/tree-sitter-${grammar}.wasm`)
    );
    languageCache.set(grammar, lang);
  }
  return lang;
}
 
async function walkFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files.filter((f) => getGrammarForFile(f));
}

/** Parse source, run cAST chunking, and build Chunk records. */
export async function chunkFile(
  content: string,
  filePath: string,
  repo = ""
): Promise<Chunk[]> {
  const grammar = getGrammarForFile(filePath);
  const log = logger.child({ tool: "chunker", path: filePath, repo, grammar });

  log.info({ path: filePath, grammar }, "Chunking file");

  if (!grammar) {
    log.warn({ path: filePath, chunkCount: 0 }, "No chunks produced");
    return [];
  }

  if (!initialized) {
    await Parser.init();
    initialized = true;
  }

  const parser = new Parser();
  parser.setLanguage(await loadLanguage(grammar));

  const tree = parser.parse(content);
  if (!tree) {
    log.warn({ path: filePath, chunkCount: 0 }, "No chunks produced");
    return [];
  }

  const root = tree.rootNode;
  const importBlock = extractImports(root, content);
  const windows = chunkCode(root, content);
  const chunks = windowsToChunks(windows, content, filePath, repo, grammar, importBlock);

  log.info({ path: filePath, chunkCount: chunks.length }, "Chunking complete");

  if (chunks.length === 0) {
    log.warn({ path: filePath, chunkCount: 0 }, "No chunks produced");
  }

  return chunks;
}

/** Derive owner/repo from cloner layout: /tmp/github-pr-agent/{owner}/{repo}/... */
function repoLabelFromLocalPath(localPath: string): string {
  const normalized = path.normalize(localPath);
  const marker = `${path.sep}tmp${path.sep}github-pr-agent${path.sep}`;
  const idx = normalized.toLowerCase().indexOf(marker.toLowerCase());
  if (idx !== -1) {
    const rest = normalized.slice(idx + marker.length);
    const [owner, repoName] = rest.split(path.sep);
    if (owner && repoName) return `${owner}/${repoName}`;
  }
  return path.basename(normalized);
}

/** Chunk all supported source files under an already-cloned repo directory. */
export async function chunkRepo(localPath: string): Promise<Chunk[]> {
  const repo = repoLabelFromLocalPath(localPath);
  const log = logger.child({ tool: "chunker", localPath, repo });
  const files = await walkFiles(localPath);

  log.info({ localPath, fileCount: files.length }, "Chunking repo");

  const chunks: Chunk[] = [];
  for (const absPath of files) {
    const content = await fs.readFile(absPath, "utf-8");
    const relPath = path.relative(localPath, absPath).replace(/\\/g, "/");
    const fileChunks = await chunkFile(content, relPath, repo);
    chunks.push(...fileChunks);
  }

  log.info({ chunkCount: chunks.length }, "Repo chunking complete");
  return chunks;
}
