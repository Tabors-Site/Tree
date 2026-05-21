/**
 * Load-graph validator — orphan-module check for static web apps.
 *
 * Problem: one branch writes `progression/progression.js`, the shell's
 * index.html never references it, another branch quietly reimplements
 * the same logic inline. All branches report done, nothing is broken
 * per file, but the integrated app doesn't use the module. The swarm
 * produced code that nobody calls.
 *
 * The load graph is the simplest place to catch it. If a branch
 * published a primary output file, SOME entry point in the project
 * must load that file. If nothing loads it, the branch's work is
 * orphaned and either the consumer (shell) is missing the include or
 * the module's path/name doesn't match what consumers expect.
 *
 * Scope v1: HTML-shell projects. Walks each branch's disk output,
 * collects JS files, finds index.html files (the "entry points"),
 * parses `<script src="...">` references, and reports any branch
 * whose primary .js file isn't referenced from any entry. Works for
 * classic-script shells like the Flappy Bird swarm pattern where
 * each branch ships one .js file and the shell stitches them together.
 *
 * Not-in-v1:
 *   - ES module import graph (would need AST parse)
 *   - Node.js server entries (server.js require() graph)
 *   - CSS @import / link rel="stylesheet" (low-value)
 * Those can come later. The HTML-shell case is the one the Flappy
 * Bird attempt #2 missed and costs us the most today.
 *
 * Returns { skipped: true, reason } when the check isn't applicable
 * (no index.html, not enough branches, etc.), or
 * { ok: true|false, orphans: [{ branch, file, reason }] } otherwise.
 */

import fs from "fs/promises";
import path from "path";

const ENTRY_FILE_NAMES = new Set(["index.html", "index.htm"]);
const ORPHAN_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

export async function checkLoadGraph({ workspaceRoot, branches, results }) {
  if (!workspaceRoot || !Array.isArray(branches) || branches.length < 2) {
    return { skipped: true, reason: "not enough branches" };
  }

  // Collect every file across all branches once.
  let entries;
  try {
    entries = await collectProjectFiles(workspaceRoot, branches);
  } catch (err) {
    return { skipped: true, reason: `walk failed: ${err.message}` };
  }
  if (entries.length === 0) {
    return { skipped: true, reason: "no files on disk" };
  }

  // Find HTML entries. Without at least one, this validator has
  // nothing to anchor against.
  const htmlEntries = entries.filter((e) => ENTRY_FILE_NAMES.has(path.basename(e.rel).toLowerCase()));
  if (htmlEntries.length === 0) {
    return { skipped: true, reason: "no index.html entry point" };
  }

  // Parse script references from every entry. Collect the normalized
  // relative paths they load. Paths are resolved relative to the HTML
  // file's own directory, then normalized against workspaceRoot so
  // "ui/ui.js" and "./ui/ui.js" compare equal.
  const referenced = new Set();
  for (const entry of htmlEntries) {
    let html;
    try {
      html = await fs.readFile(entry.abs, "utf8");
    } catch {
      continue;
    }
    const srcs = extractScriptSrcs(html);
    const entryDir = path.dirname(entry.rel);
    for (const src of srcs) {
      if (/^(https?:)?\/\//i.test(src)) continue; // skip external
      const resolved = path.posix.normalize(
        path.posix.join(entryDir === "." ? "" : entryDir, src),
      );
      referenced.add(resolved);
    }
  }

  // For each branch, check if its primary JS output is referenced.
  // "Primary" heuristic: the branch's .js files under its own path.
  // If the branch shipped multiple .js files, it's orphaned only if
  // NONE of them are referenced.
  const orphans = [];
  for (const branch of branches) {
    const branchPath = (branch.path || "").replace(/^\.\/?/, "").replace(/\/+$/, "");
    if (!branchPath) continue; // root-level branch (the shell itself)

    const branchFiles = entries.filter((e) => {
      const rel = e.rel.replace(/\\/g, "/");
      return (
        rel.startsWith(branchPath + "/") &&
        ORPHAN_EXTENSIONS.has(path.extname(rel).toLowerCase())
      );
    });
    if (branchFiles.length === 0) continue; // no JS shipped, not our job

    const anyReferenced = branchFiles.some((f) => {
      const rel = f.rel.replace(/\\/g, "/");
      if (referenced.has(rel)) return true;
      // Also accept references that omit leading branchPath (some
      // shells live inside the same directory as the branch).
      const basename = path.basename(rel);
      for (const r of referenced) {
        if (r.endsWith("/" + basename) || r === basename) return true;
      }
      return false;
    });

    if (!anyReferenced) {
      const resultEntry = (results || []).find((r) => (r.rawName || r.name) === branch.name);
      orphans.push({
        branch: branch.name,
        files: branchFiles.map((f) => f.rel),
        reason: `no index.html references this branch's output (${branchFiles
          .map((f) => f.rel)
          .slice(0, 3)
          .join(", ")})`,
        status: resultEntry?.status || null,
      });
    }
  }

  return { ok: orphans.length === 0, orphans, entriesChecked: htmlEntries.map((e) => e.rel) };
}

/**
 * Extract the path from every <script src="..."> in an HTML string.
 * Tolerant of quote style and whitespace. Ignores inline scripts
 * (no src attribute) and type="module" is fine — we only care about
 * the src value.
 */
function extractScriptSrcs(html) {
  if (typeof html !== "string") return [];
  const out = [];
  const re = /<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const src = (m[1] || m[2] || m[3] || "").trim();
    if (src) out.push(src);
  }
  return out;
}

async function collectProjectFiles(root, branches) {
  const out = [];
  const seen = new Set();
  const dirs = new Set();
  dirs.add(root);
  for (const b of branches) {
    const rel = (b.path || "").replace(/^\.\/?/, "");
    if (rel) dirs.add(path.join(root, rel));
  }
  for (const dir of dirs) {
    try {
      await walk(dir, root, out, seen);
    } catch {
      // missing dir is fine — branch may not have written anything
    }
  }
  return out;
}

async function walk(dir, root, out, seen, depth = 6) {
  if (depth < 0) return;
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.name === "node_modules" || e.name === "dist" || e.name === "build") continue;
    const abs = path.join(dir, e.name);
    if (seen.has(abs)) continue;
    seen.add(abs);
    if (e.isDirectory()) {
      await walk(abs, root, out, seen, depth - 1);
    } else if (e.isFile()) {
      const rel = path.relative(root, abs).replace(/\\/g, "/");
      out.push({ abs, rel });
    }
  }
}
