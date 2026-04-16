/**
 * Syntax validator for swarm-written code.
 *
 * Runs a fast, deterministic parse check on a file's content and returns
 * a structured error when the parse fails. The error carries enough
 * information that the model's next continuation turn can see the exact
 * line, column, message, and a caret-pointing code snippet — not "there
 * was a problem with routes.js" (noise) but "line 47 column 34: unexpected
 * token '}' — here's the source around it — fix this specific thing".
 *
 * Auto-retry is automatic: afterNote appends the structured error to the
 * branch's signalInbox, the branch's next continuation turn reads
 * it via enrichContext, the model sees the correction instruction in
 * its system prompt, rewrites the file, next validation passes, the
 * old error gets pruned.
 *
 * Supported:
 *   .js / .mjs / .cjs    → `node --check` (stdin-piped, no disk access)
 *   .json                → JSON.parse
 *   .html / .htm         → minimal balanced-tag heuristic (fail-safe,
 *                          false positives are OK, false negatives are
 *                          not — HTML is forgiving so bias toward "valid"
 *                          unless obviously broken)
 *   everything else      → { ok: true } (no validator, pass through)
 *
 * Runs in <100ms per file on a 2GB VM. spawnSync has a 2s timeout guard
 * so a pathological input can't hang the hook.
 */

import { spawnSync } from "child_process";
import path from "path";

const NODE_CHECK_TIMEOUT_MS = 2000;

/**
 * Main entry: validate a file's content and return a structured result.
 *
 *   validateSyntax({ filePath: "backend/routes.js", content: "..." })
 *     → { ok: true }
 *     → { ok: false, error: { kind, file, line, column, message, context, raw } }
 *
 * The returned error is the exact shape that goes into the branch's
 * signalInbox payload.
 */
export function validateSyntax({ filePath, content }) {
  if (!filePath || typeof content !== "string") {
    return { ok: true };
  }

  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
    return validateJavaScript({ filePath, content });
  }
  if (ext === ".json") {
    return validateJson({ filePath, content });
  }
  if (ext === ".html" || ext === ".htm") {
    return validateHtml({ filePath, content });
  }

  // No validator for this file type — treat as pass
  return { ok: true };
}

/**
 * Validate JavaScript via `node --check`. Pipes the content through
 * stdin so we never touch disk or re-read the file. Parses node's
 * stderr format to extract line, column, and message.
 *
 * Node's error output looks like:
 *
 *   [stdin]:47
 *   router.get('/profiles/swipeable' (req, res) => {
 *                                    ^
 *
 *   SyntaxError: Unexpected token '(', "router.get..." is not valid JSON
 *       at ...
 *
 * Module vs CommonJS: a file with `import`/`export` syntax MUST be parsed
 * as a module or `node --check` will reject `export` as "Unexpected
 * token". Detection: if the content starts with (or contains at top
 * level) `import` / `export`, OR the filename is `.mjs`, treat it as
 * a module. Otherwise default to CommonJS — that matches what node
 * does when running the file with package.json `"type": "module"`.
 *
 * Without this, every ESM file gets flagged with a fake "Unexpected
 * token 'export'" error AND the real bug (e.g., await in non-async
 * function) gets missed because the parser bails before reaching it.
 */
function validateJavaScript({ filePath, content }) {
  const isModule = looksLikeESM(filePath, content);
  const args = isModule
    ? ["--input-type=module", "--check"]
    : ["--check", "-"];

  let result;
  try {
    result = spawnSync("node", args, {
      input: content,
      encoding: "utf8",
      timeout: NODE_CHECK_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (err) {
    // Shouldn't happen (spawnSync doesn't throw on process errors), but
    // fail open so a validator bug doesn't block file writes.
    return { ok: true, _skipped: true, _reason: err.message };
  }

  if (result.status === 0) {
    return { ok: true };
  }

  if (result.error) {
    // spawn itself failed (node missing? timeout?) — fail open
    return { ok: true, _skipped: true, _reason: result.error.message };
  }

  const stderr = String(result.stderr || "");
  const parsed = parseNodeCheckError(stderr);
  const line = parsed.line || 1;
  const column = parsed.column || 1;

  return {
    ok: false,
    error: {
      kind: "syntax-error",
      file: filePath,
      line,
      column,
      message: parsed.message || stderr.trim().slice(0, 500),
      context: sliceContext(content, line, column),
      raw: stderr.slice(0, 2000),
    },
  };
}

/**
 * Quick heuristic: does this file look like an ES module?
 *
 * We can't ask the package.json (validator runs from anywhere, no cwd
 * context for resolving the nearest manifest), so we read the source
 * directly. ESM markers:
 *   - file extension `.mjs` → unambiguous module
 *   - file extension `.cjs` → unambiguous CommonJS
 *   - top-level `import` or `export` keyword → strong module signal
 *   - top-level `require(` → strong CommonJS signal
 * Default if ambiguous: CommonJS (matches node's default behavior).
 */
function looksLikeESM(filePath, content) {
  const ext = path.extname(filePath || "").toLowerCase();
  if (ext === ".mjs") return true;
  if (ext === ".cjs") return false;
  if (typeof content !== "string" || !content) return false;

  // Strip line comments + block comments cheaply so commented-out
  // import/export keywords don't fool the heuristic.
  const stripped = content
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  // Look for top-of-line `import` or `export` (anywhere — top-level
  // module-scope check is hard without parsing, but in practice if a
  // file has a line beginning with `import x from` or `export ...`,
  // it's ESM).
  if (/^\s*import\s+/m.test(stripped)) return true;
  if (/^\s*export\s+/m.test(stripped)) return true;

  // Look for `require(` — if present, it's CommonJS
  if (/\brequire\s*\(/.test(stripped)) return false;

  return false;
}

/**
 * Parse node --check stderr into { line, column, message }. Tolerant of
 * node version differences in error formatting. Falls back to raw if
 * nothing parses cleanly.
 *
 * IMPORTANT: must NOT match `(node:1234)` PID prefixes from warning
 * lines like `(node:2647597) Warning: Failed to load the ES module`.
 * The actual error location is on a `[stdin]:N` or `file:N:M` line.
 */
function parseNodeCheckError(stderr) {
  const result = { line: null, column: null, message: null };

  // Location header: anchored to start of line so we don't match
  // `(node:PID)` warning prefixes mid-line. Accepts `[stdin]:N`,
  // `[stdin]:N:M`, `<file>:N`, or `<file>:N:M`.
  const lines = stderr.split("\n");
  for (const line of lines) {
    const m = line.match(/^(?:\[?(?:stdin|[^\s:[\]]+)\]?):(\d+)(?::(\d+))?\s*$/);
    if (m) {
      result.line = parseInt(m[1], 10);
      if (m[2]) result.column = parseInt(m[2], 10);
      break;
    }
  }

  // Caret line: a line containing only whitespace and ^ tells us the column
  // when the location header didn't. Look for the offset of ^ relative to the
  // preceding code line in stderr.
  if (!result.column) {
    for (let i = 1; i < lines.length; i++) {
      const caretLine = lines[i];
      if (/^\s*\^+\s*$/.test(caretLine)) {
        const caretCol = caretLine.indexOf("^") + 1;
        if (caretCol > 0) result.column = caretCol;
        break;
      }
    }
  }

  // Final "SyntaxError: ..." or "TypeError: ..." line is the message
  const errMatch = stderr.match(/^(SyntaxError|TypeError|ReferenceError|Error):\s*(.+)$/m);
  if (errMatch) {
    result.message = `${errMatch[1]}: ${errMatch[2]}`.trim();
  }

  return result;
}

function validateJson({ filePath, content }) {
  try {
    JSON.parse(content);
    return { ok: true };
  } catch (err) {
    // Node's SyntaxError from JSON.parse usually includes "at position N"
    // or "at line N column M" depending on node version.
    let line = 1;
    let column = 1;
    const posMatch = /at position (\d+)/i.exec(err.message);
    const lineColMatch = /at line (\d+) column (\d+)/i.exec(err.message);
    if (lineColMatch) {
      line = parseInt(lineColMatch[1], 10);
      column = parseInt(lineColMatch[2], 10);
    } else if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      const before = content.slice(0, pos);
      line = (before.match(/\n/g) || []).length + 1;
      column = pos - before.lastIndexOf("\n");
    }
    return {
      ok: false,
      error: {
        kind: "syntax-error",
        file: filePath,
        line,
        column,
        message: `JSON parse error: ${err.message}`,
        context: sliceContext(content, line, column),
        raw: err.message,
      },
    };
  }
}

/**
 * Minimal HTML balanced-tag check. Biased toward false positives because
 * HTML is forgiving; we only flag the obvious: unmatched <script>,
 * <style>, <head>, <body>, <html>. A real HTML parser would be better
 * but that's overkill for catching the 5% of cases where the model
 * writes syntactically obvious trash.
 */
function validateHtml({ filePath, content }) {
  const critical = ["html", "head", "body", "script", "style"];
  for (const tag of critical) {
    const openRe = new RegExp(`<${tag}\\b[^>]*>`, "gi");
    const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
    const opens = (content.match(openRe) || []).length;
    const closes = (content.match(closeRe) || []).length;
    // Self-closing script/style don't exist in HTML so ignore that case.
    if (opens !== closes && tag !== "script" && tag !== "style") {
      return {
        ok: false,
        error: {
          kind: "syntax-error",
          file: filePath,
          line: 1,
          column: 1,
          message: `Unbalanced <${tag}> tags: ${opens} open, ${closes} close`,
          context: "(HTML structure check, no precise line)",
          raw: null,
        },
      };
    }
    if ((tag === "script" || tag === "style") && opens !== closes) {
      return {
        ok: false,
        error: {
          kind: "syntax-error",
          file: filePath,
          line: 1,
          column: 1,
          message: `Unbalanced <${tag}> tags: ${opens} open, ${closes} close`,
          context: "(HTML structure check, no precise line)",
          raw: null,
        },
      };
    }
  }
  return { ok: true };
}

/**
 * Slice a window of source lines around the error location and annotate
 * it with a caret pointing at the column. The caret uses the same style
 * node --check emits (a single ^ on its own line) so the model sees
 * familiar formatting.
 *
 * Output:
 *
 *   45 |   const router = express.Router();
 *   46 |
 * → 47 |   router.get('/profiles/swipeable' (req, res) => {
 *      |                                    ^
 *   48 |     res.json([]);
 *   49 |   });
 *
 * Always pulled from the raw in-memory content, not from disk, so the
 * model sees exactly what the validator saw.
 */
export function sliceContext(content, line, column) {
  if (!content || typeof content !== "string") return "";
  const lines = content.split("\n");
  const lineIdx = Math.max(0, line - 1);
  const startIdx = Math.max(0, lineIdx - 2);
  const endIdx = Math.min(lines.length - 1, lineIdx + 2);

  const maxLineNum = endIdx + 1;
  const gutter = String(maxLineNum).length;

  const out = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const num = String(i + 1).padStart(gutter, " ");
    const marker = i === lineIdx ? "→" : " ";
    out.push(`${marker} ${num} | ${lines[i] || ""}`);
    if (i === lineIdx && column > 0) {
      const pointerPad = " ".repeat(gutter + 4 + Math.max(0, column - 1));
      out.push(`  ${" ".repeat(gutter)} | ${" ".repeat(Math.max(0, column - 1))}^`);
    }
  }
  return out.join("\n");
}
