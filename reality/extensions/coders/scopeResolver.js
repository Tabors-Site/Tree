// TreeOS coders — scope and path resolution helpers.
//
// Coder tools (read-file / list-files / write-file) need to know two
// things: the absolute project path on disk, and that every requested
// path stays within it.
//
// **projectPath resolution.** The path is stamped on the coders-
// rulership space as `qualities.coders.projectPath`. The helper walks
// up the ancestor chain from the caller's spaceId until it finds an
// ancestor with that field. Sub-Ruler spaces inherit the path from
// their parent rulership; a sub-Ruler at /myproject/frontend gets the
// same projectPath as the root rulership.
//
// **Path safety.** Every relative path the LLM provides is resolved
// against projectPath and checked: the resolved absolute path must
// stay within projectPath. Path-traversal attempts (`../../etc/passwd`,
// symlink-following to outside) are rejected. This is scope discipline
// at the seed layer; the coder's prompt body teaches the why, but
// the tools enforce.

import path from "path";
import fs from "fs";
import Space from "../../seed/models/space.js";

// Cap on ancestor walks. coders-rulerships do not nest more than a
// few levels in practice; this prevents pathological loops if the
// tree is malformed.
const MAX_ANCESTOR_DEPTH = 20;

/**
 * Walk up from `spaceId` looking for an ancestor whose
 * `qualities.coders.projectPath` is set. Returns `{ projectPath,
 * rulershipSpaceId }` or `null` if no ancestor declares it.
 *
 * @param {string} spaceId
 * @returns {Promise<{ projectPath: string, rulershipSpaceId: string } | null>}
 */
export async function resolveCoderScope(spaceId) {
  if (!spaceId) return null;
  let currentId = String(spaceId);
  let depth = 0;
  while (currentId && depth < MAX_ANCESTOR_DEPTH) {
    const space = await Space.findById(currentId).select("_id parent metadata").lean();
    if (!space) return null;
    const meta = space.qualities instanceof Map
      ? space.qualities.get("coders")
      : space.qualities?.coders;
    if (meta && typeof meta.projectPath === "string" && meta.projectPath.length > 0) {
      return {
        projectPath: meta.projectPath,
        rulershipSpaceId: String(space._id),
      };
    }
    if (!space.parent) return null;
    currentId = String(space.parent);
    depth++;
  }
  return null;
}

/**
 * Resolve a relative path against the project root, refusing any path
 * that escapes the root. Returns the absolute path on success.
 *
 * @param {string} projectPath - absolute path to the project root
 * @param {string} relativePath - path the caller supplied; may be ""
 *                                or "/" for the root itself
 * @returns {string} absolute path inside projectPath
 * @throws when the resolved path escapes projectPath
 */
export function resolveAbsolutePath(projectPath, relativePath) {
  if (typeof projectPath !== "string" || !path.isAbsolute(projectPath)) {
    throw new Error("scopeResolver: projectPath must be an absolute path");
  }
  const rel = (typeof relativePath === "string" ? relativePath : "").trim();

  // Normalize the project root (resolves any trailing slash etc.) so
  // the `startsWith` check below is unambiguous.
  const root = path.resolve(projectPath);

  // Empty path → the root itself.
  if (rel === "" || rel === "/" || rel === ".") return root;

  // Reject explicit absolute paths from the caller; relative-only is
  // the contract.
  if (path.isAbsolute(rel)) {
    throw new Error(
      `scopeResolver: path "${rel}" must be relative to the project root, not absolute`,
    );
  }

  const abs = path.resolve(root, rel);
  // The resolved path must remain inside the project root. The
  // path.relative + startsWith("..") check catches both `../escape`
  // and symbol-equivalent forms.
  const relFromRoot = path.relative(root, abs);
  if (relFromRoot.startsWith("..") || path.isAbsolute(relFromRoot)) {
    throw new Error(
      `scopeResolver: path "${rel}" resolves outside the project root`,
    );
  }
  return abs;
}

/**
 * Realpath check to defeat symlink escapes. Returns the resolved path
 * if it (after symlink resolution) is still inside projectPath, throws
 * otherwise. Use after `resolveAbsolutePath` succeeds AND the file
 * exists on disk; for create-new-file flows where the path may not
 * exist yet, skip this check (the parent directory must exist and
 * pass the same test).
 */
export async function realpathWithin(projectPath, absolutePath) {
  const root = path.resolve(projectPath);
  let resolved;
  try {
    resolved = await fs.promises.realpath(absolutePath);
  } catch (err) {
    // If the path does not exist, realpath fails; the caller is
    // responsible for handling missing files. We return the original
    // absolute path so the caller can use it as-is.
    if (err.code === "ENOENT") return absolutePath;
    throw err;
  }
  const rel = path.relative(root, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `scopeResolver: real path of "${absolutePath}" escapes the project root via symlink`,
    );
  }
  return resolved;
}

/**
 * Convenience: resolve the caller's projectPath and a relative input
 * path in one call. Returns `{ projectPath, absolutePath, relativePath }`.
 * Throws when no projectPath is set or when the path escapes.
 */
export async function resolveCoderPath(spaceId, relativePath) {
  const scope = await resolveCoderScope(spaceId);
  if (!scope) {
    throw new Error(
      `No coders scope at ${String(spaceId).slice(0, 8)}. ` +
      `An ancestor rulership must carry metadata.coders.projectPath ` +
      `(the absolute path on disk). Stamp it via set-qualities on the ` +
      `coders-rulership before invoking coder tools.`,
    );
  }
  const absolutePath = resolveAbsolutePath(scope.projectPath, relativePath);
  return {
    projectPath: scope.projectPath,
    rulershipSpaceId: scope.rulershipSpaceId,
    absolutePath,
    relativePath: path.relative(scope.projectPath, absolutePath),
  };
}
