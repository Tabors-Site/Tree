/**
 * Symbol coherence scout.
 *
 * Proactive traversal that finds cross-file / cross-branch symbol gaps
 * small models produce when building in isolation:
 *
 *   frontend/client.js imports { getUser } from '../backend/api.js'
 *   backend/api.js exports  { fetchUser }
 *   → getUser is never defined. No syntax error. No test failure.
 *     Silent bug until the browser shows undefined-function.
 *
 * Complements the existing wire-protocol validators:
 *   contractConformance → checks declared message types + fields
 *   wsSeam             → checks WebSocket send/receive pairs
 *   symbolCoherence    → checks JS/module-level import/export pairs
 *
 * Pure static analysis. No LLM. No spawn. Parses each JS file's
 * exports and imports with regex tolerant of common shapes, resolves
 * relative import paths, and flags any imported name that doesn't
 * appear in the target file's exports.
 *
 * Called from swarm:afterAllBranchesComplete alongside the other
 * validators. Emits SIGNAL_KIND.COHERENCE_GAP signals on the
 * importing branch's inbox so the next retry sees an actionable
 * correction instruction (here's the name you used, here's what the
 * sibling actually exports, pick one).
 */

import path from "path";
import fs from "fs/promises";
import log from "../../../seed/log.js";

// ─────────────────────────────────────────────────────────────────────
// ENTRY
// ─────────────────────────────────────────────────────────────────────

/**
 * Main entry. Given the project's workspace root + the list of
 * branches with their paths, walk every JS file and flag symbol gaps.
 *
 * Returns:
 *   {
 *     skipped: false,
 *     ok: true|false,
 *     gaps: [ { file, line, importedName, from, targetFile,
 *               availableExports[], branch, message } ],
 *     scanned: N    // files inspected
 *   }
 *
 * Or { skipped: true, reason } when the scout can't run (no workspace
 * path, no JS files, etc.).
 */
export async function checkSymbolCoherence({ workspaceRoot, branches }) {
  if (!workspaceRoot) return { skipped: true, reason: "no workspace path" };

  const jsFiles = await collectJsFiles(workspaceRoot);
  if (jsFiles.length === 0) return { skipped: true, reason: "no JS files found" };

  // Build export index: absolute filePath → Set<exportedName>
  const exportsByFile = new Map();
  for (const f of jsFiles) {
    exportsByFile.set(f.absPath, extractExports(f.content));
  }

  const gaps = [];
  const branchByPath = new Map();
  for (const b of Array.isArray(branches) ? branches : []) {
    if (b.path) branchByPath.set(normalizePath(b.path), b.name || b.path);
  }

  for (const f of jsFiles) {
    const imports = extractImports(f.content);
    for (const imp of imports) {
      // Skip external packages (no ./ or ../) — nothing to cross-check
      if (!imp.from.startsWith(".") && !imp.from.startsWith("/")) continue;

      const targetAbs = resolveImportPath(f.absPath, imp.from, jsFiles);
      if (!targetAbs) continue; // couldn't resolve; skip quietly

      const targetExports = exportsByFile.get(targetAbs);
      if (!targetExports) continue;

      for (const importedName of imp.names) {
        // Skip default import tag when target has a default export
        if (imp.kind === "default" && targetExports.has("default")) continue;
        if (importedName === "default" && targetExports.has("default")) continue;

        if (!targetExports.has(importedName)) {
          const relFile = path.relative(workspaceRoot, f.absPath);
          const relTarget = path.relative(workspaceRoot, targetAbs);
          const branch = branchForFile(relFile, branchByPath);
          gaps.push({
            kind: "missing-export",
            file: relFile,
            line: imp.line,
            importedName,
            from: imp.from,
            targetFile: relTarget,
            availableExports: [...targetExports].slice(0, 15),
            branch,
            message:
              `${relFile}:${imp.line} imports "${importedName}" from "${imp.from}" ` +
              `but ${relTarget} doesn't export it. Available: ${[...targetExports].slice(0, 10).join(", ") || "(none)"}.`,
          });
        }
      }
    }
  }

  return { ok: gaps.length === 0, gaps, scanned: jsFiles.length };
}

// ─────────────────────────────────────────────────────────────────────
// FILE WALK
// ─────────────────────────────────────────────────────────────────────

async function collectJsFiles(rootDir) {
  const out = [];
  await walkDir(rootDir, rootDir, out);
  return out;
}

async function walkDir(rootDir, dir, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(rootDir, full, out);
    } else if (entry.isFile() && /\.(js|mjs|cjs)$/.test(entry.name)) {
      try {
        const content = await fs.readFile(full, "utf8");
        out.push({ absPath: full, content });
      } catch {}
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// EXTRACTION
// ─────────────────────────────────────────────────────────────────────

/**
 * Pull every exported symbol name from a source string. Handles the
 * common shapes; skips comments and strings in the obvious cases.
 *
 *   export function NAME       → NAME
 *   export async function NAME → NAME
 *   export const NAME =        → NAME
 *   export let NAME =          → NAME
 *   export class NAME          → NAME
 *   export default ...         → "default"
 *   export { A, B as C }       → A, C
 *   module.exports.NAME = ...  → NAME
 *   module.exports = { A, B }  → A, B
 *   exports.NAME = ...         → NAME
 */
export function extractExports(source) {
  const out = new Set();
  if (typeof source !== "string" || !source) return out;

  // Named export declarations
  const declRe = /\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = declRe.exec(source)) !== null) out.add(m[1]);

  // export default
  if (/\bexport\s+default\b/.test(source)) out.add("default");

  // export { A, B as C }
  const listRe = /\bexport\s*\{([^}]+)\}/g;
  while ((m = listRe.exec(source)) !== null) {
    const body = m[1];
    for (const piece of body.split(",")) {
      const asMatch = piece.trim().match(/^(\S+)\s+as\s+(\S+)$/);
      if (asMatch) out.add(asMatch[2]);
      else {
        const nm = piece.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(nm)) out.add(nm);
      }
    }
  }

  // module.exports.NAME = / exports.NAME =
  const cjsDirectRe = /\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = cjsDirectRe.exec(source)) !== null) out.add(m[1]);

  // module.exports = { A, B: foo, C }
  const cjsObjRe = /\bmodule\.exports\s*=\s*\{([^}]+)\}/g;
  while ((m = cjsObjRe.exec(source)) !== null) {
    for (const piece of m[1].split(",")) {
      const nm = piece.trim().split(":")[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) out.add(nm);
    }
  }

  return out;
}

/**
 * Pull every import from a source string. Returns:
 *   [ { kind: "named"|"default"|"namespace"|"cjs", names: [...], from, line } ]
 */
export function extractImports(source) {
  const out = [];
  if (typeof source !== "string" || !source) return out;

  const lineOf = (idx) => (source.slice(0, idx).match(/\n/g) || []).length + 1;

  // ES named: import { A, B as C } from "path"
  const namedRe = /\bimport\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = namedRe.exec(source)) !== null) {
    const names = [];
    for (const piece of m[1].split(",")) {
      const trimmed = piece.trim();
      const asMatch = trimmed.match(/^(\S+)\s+as\s+(\S+)$/);
      // We check the SOURCE name (what must be exported), not the alias.
      if (asMatch) names.push(asMatch[1]);
      else if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) names.push(trimmed);
    }
    if (names.length > 0) {
      out.push({ kind: "named", names, from: m[2], line: lineOf(m.index) });
    }
  }

  // ES default: import NAME from "path"
  const defaultRe = /\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g;
  while ((m = defaultRe.exec(source)) !== null) {
    out.push({ kind: "default", names: ["default"], from: m[2], line: lineOf(m.index) });
  }

  // ES default + named: import NAME, { A, B } from "path"
  const defaultPlusRe = /\bimport\s+([A-Za-z_$][\w$]*)\s*,\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = defaultPlusRe.exec(source)) !== null) {
    out.push({ kind: "default", names: ["default"], from: m[3], line: lineOf(m.index) });
    const names = [];
    for (const piece of m[2].split(",")) {
      const trimmed = piece.trim();
      const asMatch = trimmed.match(/^(\S+)\s+as\s+(\S+)$/);
      if (asMatch) names.push(asMatch[1]);
      else if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) names.push(trimmed);
    }
    if (names.length > 0) out.push({ kind: "named", names, from: m[3], line: lineOf(m.index) });
  }

  // Namespace: import * as NAME from "path" — skip; no per-name check possible
  // (the namespace object allows any access — can't statically disprove).

  // CommonJS: const { A, B } = require("path")
  const cjsNamedRe = /\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = cjsNamedRe.exec(source)) !== null) {
    const names = [];
    for (const piece of m[1].split(",")) {
      const trimmed = piece.trim().split(":")[0].trim(); // { A: alias } → A
      if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) names.push(trimmed);
    }
    if (names.length > 0) {
      out.push({ kind: "cjs", names, from: m[2], line: lineOf(m.index) });
    }
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────
// RESOLUTION
// ─────────────────────────────────────────────────────────────────────

function resolveImportPath(fromAbs, spec, jsFiles) {
  const dir = path.dirname(fromAbs);
  const base = path.resolve(dir, spec);
  // Try exact, then with extensions, then index.
  const candidates = [
    base,
    base + ".js",
    base + ".mjs",
    base + ".cjs",
    path.join(base, "index.js"),
    path.join(base, "index.mjs"),
  ];
  const set = new Set(jsFiles.map((f) => f.absPath));
  for (const c of candidates) if (set.has(c)) return c;
  return null;
}

function normalizePath(p) {
  return String(p || "").replace(/^\/+|\/+$/g, "").toLowerCase();
}

function branchForFile(relFile, branchByPath) {
  const seg = relFile.split(path.sep)[0];
  return branchByPath.get(normalizePath(seg)) || null;
}
