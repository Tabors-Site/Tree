/**
 * Code Core
 *
 * Ingests a codebase into a tree. Directories become nodes. Files become notes.
 * Respects .gitignore. Skips binaries and node_modules.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import Note from "../../seed/models/note.js";
import { v4 as uuidv4 } from "uuid";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

let _metadata = null;
export function configure({ metadata }) { _metadata = metadata; }

// Files/dirs to always skip
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg", "__pycache__", ".next", ".nuxt",
  "dist", "build", ".cache", "coverage", ".nyc_output", ".tox", "venv",
  "env", ".env", ".venv", "vendor", "target", "out", ".gradle", ".idea",
  ".vscode", ".DS_Store",
]);

const SKIP_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".ico", ".svg", ".webp",
  ".mp3", ".mp4", ".wav", ".avi", ".mov", ".mkv",
  ".zip", ".tar", ".gz", ".bz2", ".rar", ".7z",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a",
  ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".lock", ".map",
]);

const MAX_FILE_LINES = 500;
const MAX_FILE_SIZE = 100000; // 100KB
const MAX_FILES = 500;
const MAX_DEPTH = 15;

/**
 * Parse .gitignore patterns into a simple matcher.
 */
async function loadGitignore(repoPath) {
  const patterns = [];
  try {
    const content = await fs.readFile(path.join(repoPath, ".gitignore"), "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      patterns.push(trimmed);
    }
  } catch {}
  return patterns;
}

function isIgnored(relativePath, patterns) {
  const name = path.basename(relativePath);
  for (const pattern of patterns) {
    if (pattern === name) return true;
    if (pattern.endsWith("/") && name === pattern.slice(0, -1)) return true;
    if (pattern.startsWith("*") && relativePath.endsWith(pattern.slice(1))) return true;
  }
  return false;
}

/**
 * Detect language from file extension.
 */
function detectLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript",
    ".py": "python", ".rb": "ruby", ".go": "go", ".rs": "rust",
    ".java": "java", ".kt": "kotlin", ".scala": "scala",
    ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
    ".cs": "csharp", ".swift": "swift", ".m": "objc",
    ".php": "php", ".lua": "lua", ".r": "r",
    ".sh": "shell", ".bash": "shell", ".zsh": "shell",
    ".sql": "sql", ".graphql": "graphql",
    ".html": "html", ".css": "css", ".scss": "scss", ".less": "less",
    ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
    ".xml": "xml", ".md": "markdown", ".txt": "text",
    ".dockerfile": "docker", ".env": "env",
  };
  return map[ext] || null;
}

/**
 * Clone a git repository to a temp directory.
 * Returns the local path. Caller is responsible for cleanup.
 */
export async function cloneRepo(url) {
  const tmpDir = path.join(os.tmpdir(), `treeos-code-${uuidv4().slice(0, 8)}`);
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    await execFileAsync("git", ["clone", "--depth", "1", url, tmpDir], {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
    });
    log.verbose("Code", `Cloned ${url} to ${tmpDir}`);
    return tmpDir;
  } catch (err) {
    // Clean up on failure
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Clone failed: ${err.message}`);
  }
}

/**
 * Check if a string looks like a git URL.
 */
export function isGitUrl(str) {
  return /^https?:\/\/.+\.git$|^https?:\/\/github\.com\/|^git@/.test(str);
}

/**
 * Ingest a directory or git URL into a tree node.
 * Creates child nodes for directories, notes for files.
 */
export async function ingest(parentNodeId, dirPath, userId, opts = {}) {
  const repoRoot = opts.repoRoot || dirPath;
  const gitignore = opts.gitignore || await loadGitignore(repoRoot);
  const depth = opts.depth || 0;
  const stats = opts.stats || { files: 0, dirs: 0, lines: 0, skipped: 0 };

  if (depth > MAX_DEPTH) return stats;
  if (stats.files >= MAX_FILES) return stats;

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    log.debug("Code", `Cannot read ${dirPath}: ${err.message}`);
    return stats;
  }

  // Sort: directories first, then files
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (stats.files >= MAX_FILES) break;

    const entryPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(repoRoot, entryPath);

    // Skip ignored
    if (SKIP_DIRS.has(entry.name)) { stats.skipped++; continue; }
    if (isIgnored(relativePath, gitignore)) { stats.skipped++; continue; }

    if (entry.isDirectory()) {
      // Create a node for the directory
      const dirNode = await createCodeNode(parentNodeId, entry.name, userId, "directory");
      stats.dirs++;

      // Recurse
      await ingest(String(dirNode._id), entryPath, userId, {
        repoRoot, gitignore, depth: depth + 1, stats,
      });
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SKIP_EXTENSIONS.has(ext)) { stats.skipped++; continue; }

      // Read file
      try {
        const fileStat = await fs.stat(entryPath);
        if (fileStat.size > MAX_FILE_SIZE) {
          stats.skipped++;
          continue;
        }

        const content = await fs.readFile(entryPath, "utf-8");
        const lines = content.split("\n");
        const language = detectLanguage(entry.name);

        // Truncate large files
        const truncated = lines.length > MAX_FILE_LINES;
        const fileContent = truncated
          ? lines.slice(0, MAX_FILE_LINES).join("\n") + `\n\n... (${lines.length - MAX_FILE_LINES} more lines truncated)`
          : content;

        // Write file content directly to Note model.
        // Bypasses createNote's text limit, hooks, and validation.
        // Code files can be large. No hooks needed for bulk ingestion.
        await Note.create({
          _id: uuidv4(),
          contentType: "text",
          content: `// ${entry.name}\n${fileContent}`,
          userId,
          nodeId: parentNodeId,
          wasAi: false,
          metadata: { code: { fileName: entry.name, language, lines: lines.length, truncated } },
        });

        stats.files++;
        stats.lines += lines.length;
      } catch (err) {
        log.debug("Code", `Cannot read file ${entryPath}: ${err.message}`);
        stats.skipped++;
      }
    }
  }

  return stats;
}

/**
 * Create a child node with code metadata.
 * Uses the kernel's createNode for proper hook firing and parent linkage.
 */
async function createCodeNode(parentId, name, userId, role) {
  const { createNode: kernelCreateNode } = await import("../../seed/tree/treeManagement.js");

  // Check if already exists (idempotent re-ingestion)
  const existing = await Node.findOne({ parent: parentId, name }).select("_id").lean();
  if (existing) return existing;

  const node = await kernelCreateNode({
    name,
    parentId,
    userId,
    metadata: { code: { role } },
  });
  return node;
}

/**
 * Search for a pattern across all file notes in a code tree.
 */
export async function searchCode(rootId, query, type = "text") {
  const results = [];
  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");

  // BFS: collect all nodes in the tree
  const queue = [rootId];
  const visited = new Set();
  const Note = (await import("../../seed/models/note.js")).default;

  while (queue.length > 0 && results.length < 20) {
    const batch = queue.splice(0, 50);
    const nodes = await Node.find({ parent: { $in: batch } })
      .select("_id name children metadata")
      .lean();

    for (const node of nodes) {
      const id = String(node._id);
      if (visited.has(id)) continue;
      visited.add(id);
      if (node.children?.length) queue.push(id);

      // Search notes on this node
      const notes = await Note.find({ nodeId: id, contentType: "text" })
        .select("content")
        .lean();

      for (const note of notes) {
        if (!note.content) continue;
        const matches = note.content.match(regex);
        if (!matches) continue;

        // Extract context around first match
        const idx = note.content.search(regex);
        const start = Math.max(0, idx - 100);
        const end = Math.min(note.content.length, idx + query.length + 100);
        const context = note.content.slice(start, end);

        // Get file name from note content (first line is // filename)
        const firstLine = note.content.split("\n")[0];
        const fileName = firstLine.startsWith("// ") ? firstLine.slice(3) : null;

        results.push({
          nodeId: id,
          nodeName: node.name,
          fileName,
          matchCount: matches.length,
          context: context.trim(),
        });
      }

      if (visited.size > 500) break;
    }
  }

  return results;
}

/**
 * Get code status for a tree.
 */
export async function getStatus(rootId) {
  const root = await Node.findById(rootId).select("metadata").lean();
  if (!root) return null;
  const meta = root.metadata instanceof Map ? root.metadata.get("code") : root.metadata?.code;
  return meta || null;
}
