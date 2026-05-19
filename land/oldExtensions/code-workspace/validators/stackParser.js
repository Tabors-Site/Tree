/**
 * Node.js stack trace parser for the smoke validator.
 *
 * When a smoke-spawned child crashes, its stderr includes a stack trace.
 * We want to surface the EXACT file/line/column where the throw happened
 * so the retry loop can rewrite that specific spot, not "something went
 * wrong in your branch."
 *
 * Two input shapes we care about:
 *
 *   /abs/path/to/workspace/backend/routes/auth.js:42:18
 *   file:///abs/path/to/workspace/backend/routes/auth.js:42:18
 *
 * Both in frames like `at someFn (…:L:C)` or bare `…:L:C` lines.
 *
 * Returns the FIRST frame whose file path falls inside the given
 * `workspaceRoot`. Node framework frames (internal/modules/…, node:…)
 * are skipped — those almost never point to user code worth rewriting.
 *
 * If nothing matches, returns null and the caller surfaces the raw
 * stderr tail instead.
 */

import path from "path";

export function parseNodeStack(stderr, workspaceRoot) {
  if (typeof stderr !== "string" || !stderr) return null;
  if (typeof workspaceRoot !== "string" || !workspaceRoot) return null;

  const normalizedRoot = path.resolve(workspaceRoot);
  const lines = stderr.split("\n");

  // First pass: look for a `file:L:C` reference inside the workspace.
  // Node puts the throw location on its own line BEFORE the Error: header,
  // e.g.
  //   /home/tabor/.../backend/routes/auth.js:42
  //       const { email, password } = req.body;
  //                                       ^
  //   SyntaxError: Unexpected token
  // The bare-line form is actually the best signal when it exists.
  for (const line of lines) {
    const bare = line.match(/^(\/[^\s:()]+):(\d+)(?::(\d+))?\s*$/);
    if (bare) {
      const file = bare[1];
      if (file.startsWith(normalizedRoot)) {
        return {
          file: path.relative(normalizedRoot, file),
          line: parseInt(bare[2], 10),
          column: bare[3] ? parseInt(bare[3], 10) : 1,
          frame: null,
        };
      }
    }
  }

  // Second pass: walk stack frames in order, return first that's in
  // workspace. Format variations:
  //   at handler (/abs/path/file.js:42:18)
  //   at /abs/path/file.js:42:18
  //   at async handler (file:///abs/path/file.js:42:18)
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) continue;

    const parenMatch = trimmed.match(/\(([^()]+):(\d+):(\d+)\)\s*$/);
    const bareMatch = trimmed.match(/at\s+(?:async\s+)?([^\s()]+):(\d+):(\d+)\s*$/);
    const m = parenMatch || bareMatch;
    if (!m) continue;

    let file = m[1];
    if (file.startsWith("file://")) file = file.slice("file://".length);

    if (!path.isAbsolute(file)) continue;
    if (!file.startsWith(normalizedRoot)) continue;
    if (file.includes("/node_modules/")) continue;

    return {
      file: path.relative(normalizedRoot, file),
      line: parseInt(m[2], 10),
      column: parseInt(m[3], 10),
      frame: trimmed,
    };
  }

  return null;
}

/**
 * Extract the top-level error header from stderr: usually the first
 * line matching `^(SyntaxError|TypeError|ReferenceError|Error): .*`.
 * Used as the human-readable message when the stack itself doesn't
 * point to a specific file in the workspace.
 */
export function extractErrorHeader(stderr) {
  if (typeof stderr !== "string" || !stderr) return null;
  const m = stderr.match(/^(SyntaxError|TypeError|ReferenceError|RangeError|Error):\s*(.+)$/m);
  if (!m) return null;
  return `${m[1]}: ${m[2]}`.trim();
}
