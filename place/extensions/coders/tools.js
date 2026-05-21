// TreeOS coders — filesystem-matter tools.
//
// Three tools the coders use to inspect and modify code at their scope:
//
//   coders-read-file   SEE  Read the contents of a file at the project scope.
//   coders-list-files  SEE  List directory contents (files + subdirectories).
//   coders-write-file  DO   Create or overwrite a file at the project scope.
//
// All three are scope-aware. They read the rulership's projectPath
// via metadata.coders.projectPath (ancestor walk), resolve paths
// relative to it, and reject any path that escapes the project root.
//
// **Disk is the source of truth** for v1. Tools read and write the
// filesystem directly. The substrate's `origin=filesystem` auto-sync
// (Matter records mirroring files) places later; until then, the tools
// bridge code matter to disk without going through Matter mutations.
// Same outcome the operator's editor sees.

import path from "path";
import fs from "fs";
import { z } from "zod";
import log from "../../seed/system/log.js";
import { resolveCoderPath, resolveCoderScope, realpathWithin } from "./scopeResolver.js";

// MCP text-response helper. Tools return text payloads structured as
// MCP content blocks; the LLM reads the text. Stringify objects for
// machine-readable returns.
function text(s) {
  return { content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] };
}

// Caps. Defensive limits so a runaway model cannot exhaust disk or
// memory through these tools. Tune via place config later if needed.
const MAX_READ_BYTES   = 1 * 1024 * 1024;   // 1 MB — refuse to read files larger than this
const MAX_WRITE_BYTES  = 1 * 1024 * 1024;   // 1 MB — refuse to write content larger than this
const MAX_LIST_ENTRIES = 500;               // refuse to list directories with more entries than this
const MAX_DEPTH        = 10;                // recursive list depth cap

// File extensions the coders treat as text. Reading a binary file
// returns a placeholder result instead of garbage; writing a path
// whose extension is in this list goes through normally. This list
// can grow as new content types come up.
const TEXT_EXTENSIONS = new Set([
  ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx",
  ".json", ".md", ".txt", ".html", ".htm", ".css", ".scss",
  ".yml", ".yaml", ".toml", ".sh", ".py", ".sql",
  ".rs", ".go", ".java", ".kt", ".swift",
  ".c", ".cc", ".cpp", ".h", ".hpp",
  ".rb", ".php", ".lua", ".vue", ".svelte",
  ".env", ".gitignore", ".dockerignore",
]);

function isTextPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext && TEXT_EXTENSIONS.has(ext)) return true;
  // Files without an extension that match known names.
  const base = path.basename(filePath).toLowerCase();
  if (base === "readme" || base === "license" || base === "makefile") return true;
  return false;
}

export default function getCodersTools(_core) {
  return [
    // ───────────────────────────────────────────────────────────────
    // coders-read-file
    //
    // Returns the file's contents as a string. Refuses files larger
    // than MAX_READ_BYTES (1 MB). Refuses paths outside the project
    // root. Treats binary files honestly: returns a placeholder so the
    // LLM does not get garbage bytes in its context window.
    // ───────────────────────────────────────────────────────────────
    {
      name: "coders-read-file",
      verb: "see",
      description:
        "Read the contents of a code file at this scope. Path is " +
        "relative to the project root (e.g. 'src/index.js'). " +
        "Returns the file's text content. Use to understand existing " +
        "code BEFORE writing changes. Reading a file does not end " +
        "your turn.",
      schema: {
        path: z.string().describe(
          "Relative path from the project root, e.g. 'src/index.js' or 'package.json'.",
        ),
      },
      annotations: { readOnlyHint: true },
      async handler(args) {
        const { spaceId } = args;
        const inputPath = typeof args.path === "string" ? args.path.trim() : "";
        if (!inputPath) return text("coders-read-file: `path` is required.");
        if (!spaceId) return text("coders-read-file: no spaceId in context; substrate bug.");

        let resolved;
        try {
          resolved = await resolveCoderPath(spaceId, inputPath);
        } catch (err) {
          return text(`coders-read-file: ${err.message}`);
        }

        // Symlink-safety: resolve to a real path, refuse if it escapes.
        let realPath;
        try {
          realPath = await realpathWithin(resolved.projectPath, resolved.absolutePath);
        } catch (err) {
          return text(`coders-read-file: ${err.message}`);
        }

        // Stat to check existence + size before reading the bytes.
        let stat;
        try {
          stat = await fs.promises.stat(realPath);
        } catch (err) {
          if (err.code === "ENOENT") {
            return text(`coders-read-file: file not found at '${resolved.relativePath}'.`);
          }
          return text(`coders-read-file: stat failed: ${err.message}`);
        }
        if (!stat.isFile()) {
          return text(
            `coders-read-file: '${resolved.relativePath}' is not a regular file ` +
            `(directory? device?). Use coders-list-files for directory contents.`,
          );
        }
        if (stat.size > MAX_READ_BYTES) {
          return text(
            `coders-read-file: '${resolved.relativePath}' is ${stat.size} bytes; ` +
            `over the ${MAX_READ_BYTES}-byte cap. Refusing to load. Read a smaller ` +
            `slice if you need to inspect part of it.`,
          );
        }
        if (!isTextPath(realPath)) {
          return text(
            `coders-read-file: '${resolved.relativePath}' looks like a binary file ` +
            `(extension '${path.extname(realPath)}' is not in the text-extension list). ` +
            `Refusing to load — its bytes are not meaningful in this context.`,
          );
        }

        let content;
        try {
          content = await fs.promises.readFile(realPath, "utf8");
        } catch (err) {
          return text(`coders-read-file: read failed: ${err.message}`);
        }

        return text({
          ok: true,
          path: resolved.relativePath,
          bytes: stat.size,
          mtime: stat.mtime.toISOString(),
          content,
        });
      },
    },

    // ───────────────────────────────────────────────────────────────
    // coders-list-files
    //
    // Enumerates the contents of a directory at the project scope.
    // Default is non-recursive. Returns entries with name, kind
    // (file | directory), and size for files.
    // ───────────────────────────────────────────────────────────────
    {
      name: "coders-list-files",
      verb: "see",
      description:
        "List files and subdirectories under a path at the project " +
        "scope. Path defaults to the project root if omitted. Set " +
        "recursive=true to walk into subdirectories (capped at depth " +
        "10). Use before reading or writing to understand the layout. " +
        "Listing does not end your turn.",
      schema: {
        path: z.string().optional().describe(
          "Relative path from the project root. Omit or '' for the project root.",
        ),
        recursive: z.boolean().optional().describe(
          "Walk into subdirectories. Default false (single level only).",
        ),
      },
      annotations: { readOnlyHint: true },
      async handler(args) {
        const { spaceId } = args;
        const inputPath = typeof args.path === "string" ? args.path.trim() : "";
        const recursive = !!args.recursive;
        if (!spaceId) return text("coders-list-files: no spaceId in context; substrate bug.");

        let resolved;
        try {
          resolved = await resolveCoderPath(spaceId, inputPath);
        } catch (err) {
          return text(`coders-list-files: ${err.message}`);
        }

        // Confirm the target is a directory.
        let stat;
        try {
          stat = await fs.promises.stat(resolved.absolutePath);
        } catch (err) {
          if (err.code === "ENOENT") {
            return text(`coders-list-files: directory not found at '${resolved.relativePath || "."}'.`);
          }
          return text(`coders-list-files: stat failed: ${err.message}`);
        }
        if (!stat.isDirectory()) {
          return text(
            `coders-list-files: '${resolved.relativePath || "."}' is not a directory. ` +
            `Use coders-read-file for individual files.`,
          );
        }

        const entries = [];
        try {
          await walkDirectory(
            resolved.absolutePath,
            resolved.projectPath,
            recursive,
            0,
            entries,
          );
        } catch (err) {
          return text(`coders-list-files: walk failed: ${err.message}`);
        }

        if (entries.length === 0) {
          return text({
            ok: true,
            directory: resolved.relativePath || ".",
            files: [],
            note: "directory is empty",
          });
        }

        return text({
          ok: true,
          directory: resolved.relativePath || ".",
          files: entries,
          count: entries.length,
          truncated: entries.length >= MAX_LIST_ENTRIES,
        });
      },
    },

    // ───────────────────────────────────────────────────────────────
    // coders-write-file
    //
    // Creates a new file or overwrites an existing one at the project
    // scope. The mode argument distinguishes Build (create-only) from
    // Refine (overwrite). Parent directories are created automatically.
    // ───────────────────────────────────────────────────────────────
    {
      name: "coders-write-file",
      verb: "do",
      description:
        "Write a code file at this scope. Path is relative to the project " +
        "root. Mode 'create' refuses to overwrite an existing file (use " +
        "for Build — new file). Mode 'overwrite' replaces an existing " +
        "file's contents (use for Refine and Integrate). Parent directories " +
        "are created automatically. The Foreman expects exactly one " +
        "successful write per leaf turn.",
      schema: {
        path: z.string().describe(
          "Relative path from the project root, e.g. 'src/index.js' or 'package.json'.",
        ),
        content: z.string().describe(
          "The file's new contents. Capped at 1 MB.",
        ),
        mode: z.enum(["create", "overwrite"]).optional().describe(
          "'create' refuses if the file already exists (Build). " +
          "'overwrite' replaces existing content (Refine, Integrate). Defaults to 'create'.",
        ),
      },
      annotations: { readOnlyHint: false },
      async handler(args) {
        const { spaceId, beingId } = args;
        const inputPath = typeof args.path === "string" ? args.path.trim() : "";
        const content   = typeof args.content === "string" ? args.content : "";
        const mode      = args.mode === "overwrite" ? "overwrite" : "create";
        if (!inputPath) return text("coders-write-file: `path` is required.");
        if (!spaceId) return text("coders-write-file: no spaceId in context; substrate bug.");

        if (!isTextPath(inputPath)) {
          return text(
            `coders-write-file: refusing to write '${inputPath}' — extension ` +
            `'${path.extname(inputPath)}' is not in the text-extension list. ` +
            `Coders write code matter, not binary files.`,
          );
        }
        const contentBytes = Buffer.byteLength(content, "utf8");
        if (contentBytes > MAX_WRITE_BYTES) {
          return text(
            `coders-write-file: content is ${contentBytes} bytes; over the ` +
            `${MAX_WRITE_BYTES}-byte cap. Split into smaller files.`,
          );
        }

        let resolved;
        try {
          resolved = await resolveCoderPath(spaceId, inputPath);
        } catch (err) {
          return text(`coders-write-file: ${err.message}`);
        }

        // Check existing-file policy.
        let exists = false;
        try {
          await fs.promises.access(resolved.absolutePath, fs.constants.F_OK);
          exists = true;
        } catch { /* file does not exist */ }

        if (exists && mode === "create") {
          return text(
            `coders-write-file: '${resolved.relativePath}' already exists. ` +
            `Use mode='overwrite' for Refine/Integrate, or pick a different path.`,
          );
        }

        // Ensure parent directory exists. If the parent dir already
        // exists and is a symlink to somewhere outside the project,
        // realpathWithin catches it.
        const parentDir = path.dirname(resolved.absolutePath);
        try {
          await realpathWithin(resolved.projectPath, parentDir);
        } catch (err) {
          return text(`coders-write-file: ${err.message}`);
        }
        try {
          await fs.promises.mkdir(parentDir, { recursive: true });
        } catch (err) {
          return text(`coders-write-file: mkdir failed: ${err.message}`);
        }

        // Write the file. fs.promises.writeFile overwrites by default;
        // we already gated on the create-mode existence check above.
        try {
          await fs.promises.writeFile(resolved.absolutePath, content, "utf8");
        } catch (err) {
          return text(`coders-write-file: write failed: ${err.message}`);
        }

        log.info("Coders",
          `📝 ${beingId ? String(beingId).slice(0, 8) : "?"} wrote ` +
          `${resolved.relativePath} (${contentBytes} bytes, mode=${mode}) ` +
          `at ${String(spaceId).slice(0, 8)}`);

        return text({
          ok: true,
          written: true,
          path: resolved.relativePath,
          bytes: contentBytes,
          mode,
        });
      },
    },
  ];
}

// ────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────

async function walkDirectory(absDir, projectRoot, recursive, depth, out) {
  if (out.length >= MAX_LIST_ENTRIES) return;
  if (depth > MAX_DEPTH) return;

  let dirents;
  try {
    dirents = await fs.promises.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }

  // Sort for deterministic output (directories first, then files,
  // alphabetical within each group).
  dirents.sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name);
  });

  for (const entry of dirents) {
    if (out.length >= MAX_LIST_ENTRIES) return;

    // Skip common noise: .git, node_modules, build/dist dirs (similar
    // policy to seed/place/space/source.js's ignore list).
    if (entry.name === ".git" || entry.name === "node_modules") continue;

    const absChild = path.join(absDir, entry.name);
    const relChild = path.relative(projectRoot, absChild);

    if (entry.isDirectory()) {
      out.push({ path: relChild, kind: "directory" });
      if (recursive) {
        await walkDirectory(absChild, projectRoot, recursive, depth + 1, out);
      }
    } else if (entry.isFile()) {
      let size = null;
      try {
        const st = await fs.promises.stat(absChild);
        size = st.size;
      } catch { /* tolerate stat failures */ }
      out.push({ path: relChild, kind: "file", size });
    }
    // symlinks, sockets, devices: skipped on purpose.
  }
}
