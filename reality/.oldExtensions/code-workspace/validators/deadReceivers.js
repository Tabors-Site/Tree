/**
 * Dead-receiver static analysis.
 *
 * Catches the class of bug that phase 1 (syntax), phase 2 (contracts),
 * and phase 3 (smoke) all miss: a property that's READ many times in
 * the code but NEVER assigned a real value. Symptoms in the wild:
 *
 *   let player = { id: null, name: '', roomId: '' };
 *   ...
 *   if (!player.id) return;     // silent no-op everywhere
 *   if (snake.id === player.id) // never matches
 *
 * The validators all pass: code parses, server boots, smoke probes the
 * root URL successfully. The app is functionally a shell because every
 * `player.id` read returns null. Buttons "don't work" without any
 * runtime error.
 *
 * Detection rule
 * ──────────────
 * For each `let X = { ... }` or `const X = { ... }` object-literal
 * declaration in a file:
 *   1. Extract the initial property names from the literal
 *   2. Find every `X.prop` READ in the rest of the file
 *   3. Find every `X.prop = value` WRITE in the rest of the file
 *   4. If a property is read but EVERY write assigns null/undefined
 *      (or no writes exist at all), flag it as a dead receiver
 *
 * Notes on scope
 * ──────────────
 *   - File-scoped: doesn't cross file boundaries. Catches the common
 *     case where state is declared and consumed in the same file but
 *     never populated. Cross-file dead-receivers are a separate (much
 *     harder) problem we punt on.
 *   - Excludes properties initialized with non-nullish literals (those
 *     have their value at declaration time and are not "dead").
 *   - Skips read sites where the receiver is a parameter, a global
 *     (window/document/Math/etc), or a function call result.
 *   - Tracks `let`/`const` only — `var` and bare assignments aren't
 *     declarations we can reason about cleanly.
 *
 * Known limits (acceptable false negatives)
 * ─────────────────────────────────────────
 *   - Doesn't catch dead receivers on object types declared by class
 *     constructors (different code shape, harder to extract)
 *   - Doesn't catch dead receivers reached via destructuring (e.g.
 *     `const { id } = player; if (!id)` — different read pattern)
 *   - Property writes via computed keys (`obj[key] = value`) aren't
 *     tracked — the regex needs the literal key
 *   - Properties initialized to non-nullish literals are considered
 *     "live" even if nothing else writes them, which means stale
 *     defaults won't be caught
 *
 * Output format matches the syntax-error and contract-mismatch
 * validators so the cascade pipeline can render it consistently.
 */

const NULLISH_VALUE_RE = /^(null|undefined|false|''|""|``)\s*$/;

/**
 * Main entry. Returns { issues: [...] } where each issue has the same
 * shape the syntax/contract validators emit, so the cascade signal
 * renderer can format them consistently.
 *
 *   detectDeadReceivers({ filePath: "client/game.js", content: "..." })
 *     → { issues: [] }
 *     → { issues: [{ kind, file, line, column, message, context, raw }] }
 */
export function detectDeadReceivers({ filePath, content }) {
  if (typeof content !== "string" || !content) return { issues: [] };
  if (!/\.(js|mjs|cjs)$/.test(filePath || "")) return { issues: [] };

  const decls = extractObjectLiteralDeclarations(content);
  if (decls.length === 0) return { issues: [] };

  const issues = [];

  for (const decl of decls) {
    for (const prop of decl.props) {
      const initialValue = decl.initialValues[prop];
      const initialIsNullish = NULLISH_VALUE_RE.test(initialValue);

      // If the initial value is a real literal, the property is "live"
      // at declaration. We only flag truly uninitialized state.
      if (!initialIsNullish) continue;

      const readSites = findPropertyReads(content, decl.name, prop);
      const writeSites = findPropertyWrites(content, decl.name, prop);

      // Skip if there's only one read or none — too thin a signal
      if (readSites.length < 2) continue;

      // Filter writes to only "meaningful" ones (not nullish literals)
      const meaningfulWrites = writeSites.filter((w) => !NULLISH_VALUE_RE.test(w.value));

      if (meaningfulWrites.length > 0) continue;

      // Build the issue
      const sortedReads = readSites.sort((a, b) => a.line - b.line);
      const firstRead = sortedReads[0];
      const lastWrite = writeSites[writeSites.length - 1];

      const writeNote = writeSites.length === 0
        ? "no assignments anywhere"
        : `only assigned to nullish values (${writeSites.map((w) => w.value).join(", ")})`;

      issues.push({
        kind: "dead-receiver",
        severity: "error",
        file: filePath,
        line: firstRead.line,
        column: firstRead.column || 1,
        message:
          `'${decl.name}.${prop}' is read ${readSites.length} times but ${writeNote}. ` +
          `Initial value at line ${decl.line} is ${initialValue}; nothing in this file ever sets it ` +
          `to a real value, so every read returns nullish. ` +
          `If another file (server, parent, etc.) is supposed to populate this, that connection is broken.`,
        context: buildContextSnippet(content, decl, sortedReads, writeSites),
        raw: null,
      });
    }
  }

  return { issues };
}

// ─────────────────────────────────────────────────────────────────────
// EXTRACTION
// ─────────────────────────────────────────────────────────────────────

/**
 * Find every `let X = { ... }` and `const X = { ... }` declaration in
 * the file. Returns an array of:
 *
 *   {
 *     name: "player",
 *     line: 3,
 *     props: ["id", "name", "roomId"],
 *     initialValues: { id: "null", name: "''", roomId: "''" }
 *   }
 *
 * Uses regex + brace-matching to handle nested values (functions,
 * arrays, sub-objects). Ignores anything that isn't a top-level object
 * literal at the right side of the declaration.
 */
function extractObjectLiteralDeclarations(content) {
  const out = [];
  // Match `let|const X = {` — we use brace-matching to find the closer.
  const declRe = /\b(let|const)\s+([a-zA-Z_$][\w$]*)\s*=\s*\{/g;
  let m;
  while ((m = declRe.exec(content)) !== null) {
    const openIdx = m.index + m[0].length - 1; // position of '{'
    const closeIdx = matchBrace(content, openIdx);
    if (closeIdx === -1) continue;
    const literalBody = content.slice(openIdx + 1, closeIdx);
    const initialValues = parseObjectLiteralProperties(literalBody);
    const props = Object.keys(initialValues);
    if (props.length === 0) continue;

    const before = content.slice(0, m.index);
    const line = (before.match(/\n/g) || []).length + 1;

    out.push({
      name: m[2],
      line,
      props,
      initialValues,
    });
  }
  return out;
}

/**
 * Parse the inside of an object literal `{ a: 1, b: '', c: null }` into
 * a map of `{ name → raw value text }`. Handles nested objects/arrays
 * by recording the value as "{...}" / "[...]" rather than parsing
 * deeply — we just need to know "is it nullish or not".
 */
function parseObjectLiteralProperties(body) {
  const out = {};
  let depth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let inStr = null;
  let entryStart = 0;
  const entries = [];

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "(") parenDepth++;
    else if (c === ")") parenDepth--;
    else if (c === "[") bracketDepth++;
    else if (c === "]") bracketDepth--;
    else if (c === "," && depth === 0 && parenDepth === 0 && bracketDepth === 0) {
      entries.push(body.slice(entryStart, i));
      entryStart = i + 1;
    }
  }
  entries.push(body.slice(entryStart));

  for (const rawEntry of entries) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    if (entry.startsWith("...")) continue;
    // Quoted key
    let keyMatch = entry.match(/^(['"])([^'"]+)\1\s*:\s*(.+)$/);
    if (!keyMatch) {
      // Identifier key with value
      keyMatch = entry.match(/^([a-zA-Z_$][\w$]*)\s*:\s*(.+)$/);
      if (keyMatch) {
        out[keyMatch[1]] = collapseValue(keyMatch[2]);
        continue;
      }
      // Shorthand `a` (no colon) — the value is whatever the outer
      // binding holds. We can't follow the binding without full scope
      // analysis, so we must stay silent: skip the key entirely so the
      // dead-receiver check treats it as "unknown value, don't flag".
      // The previous behavior recorded shorthand keys as "null" which
      // caused false positives on `const user = { name, email }` where
      // `user.name` reads were flagged despite name being a real
      // outer-scope binding.
      continue;
    }
    out[keyMatch[2]] = collapseValue(keyMatch[3]);
  }
  return out;
}

/**
 * Collapse a value expression to a short representation we can match
 * against NULLISH_VALUE_RE. Nested objects/arrays/functions become
 * `{...}`, `[...]`, `(...)=>` placeholders so we don't mis-classify
 * complex values as nullish.
 */
function collapseValue(raw) {
  const t = raw.trim().replace(/,\s*$/, "");
  if (/^null$/.test(t)) return "null";
  if (/^undefined$/.test(t)) return "undefined";
  if (/^false$/.test(t)) return "false";
  if (/^['"`]['"`]$/.test(t)) return "''";
  if (t.startsWith("{")) return "{...}";
  if (t.startsWith("[")) return "[...]";
  if (t.includes("=>") || t.startsWith("function")) return "(fn)";
  return t.length > 30 ? t.slice(0, 27) + "…" : t;
}

/**
 * Find every read of `obj.prop` in the source, returning their line
 * positions. A "read" is `obj.prop` that is NOT immediately followed
 * by `=` (which would be a write). Rough but effective for the cases
 * we care about.
 */
function findPropertyReads(content, objName, propName) {
  const out = [];
  const pattern = new RegExp(
    `\\b${escapeRegex(objName)}\\.${escapeRegex(propName)}\\b(?!\\s*[=!<>]?=(?!=))`,
    "g",
  );
  let m;
  while ((m = pattern.exec(content)) !== null) {
    // Exclude assignment forms `obj.prop = value` (the negative
    // lookahead in the pattern handles `==`/`===`/`!=`/`!==` but we
    // also need to filter out plain `=`).
    const after = content.slice(m.index + m[0].length, m.index + m[0].length + 4);
    if (/^\s*=(?!=)/.test(after)) continue;
    const line = lineOf(content, m.index);
    out.push({ line, column: 1 });
  }
  return out;
}

/**
 * Find every write to `obj.prop = value` in the source. Returns
 * `{ line, value }` for each occurrence, where `value` is the
 * collapsed RHS expression.
 */
function findPropertyWrites(content, objName, propName) {
  const out = [];
  const pattern = new RegExp(
    `\\b${escapeRegex(objName)}\\.${escapeRegex(propName)}\\s*=\\s*([^;,\\n]+)`,
    "g",
  );
  let m;
  while ((m = pattern.exec(content)) !== null) {
    // Exclude comparison forms `obj.prop ==`, `===`, etc.
    const fullMatch = m[0];
    if (/=\s*=/.test(fullMatch)) continue;
    const value = collapseValue(m[1]);
    const line = lineOf(content, m.index);
    out.push({ line, value });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineOf(content, charIndex) {
  const before = content.slice(0, charIndex);
  return (before.match(/\n/g) || []).length + 1;
}

function matchBrace(content, openIdx) {
  if (content[openIdx] !== "{") return -1;
  let depth = 0;
  let i = openIdx;
  let inStr = null;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < content.length) {
    const ch = content[i];
    const next = content[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") { inBlockComment = false; i += 2; continue; }
      i++;
      continue;
    }
    if (inStr) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") { inLineComment = true; i += 2; continue; }
    if (ch === "/" && next === "*") { inBlockComment = true; i += 2; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Render a context snippet that shows the declaration line + a sample
 * of read sites. Same style as the syntax validator output so the
 * cascade renderer formats it consistently.
 */
function buildContextSnippet(content, decl, reads, writes) {
  const lines = content.split("\n");
  const out = [];
  out.push(`Declared at line ${decl.line}:`);
  if (lines[decl.line - 1]) out.push(`  ${decl.line} | ${lines[decl.line - 1]}`);
  out.push("");
  out.push(`Read at:`);
  for (const r of reads.slice(0, 5)) {
    if (lines[r.line - 1]) out.push(`  ${r.line} | ${lines[r.line - 1].trim()}`);
  }
  if (reads.length > 5) out.push(`  ... and ${reads.length - 5} more`);
  if (writes.length > 0) {
    out.push("");
    out.push(`Written at (all nullish):`);
    for (const w of writes.slice(0, 3)) {
      if (lines[w.line - 1]) out.push(`  ${w.line} | ${lines[w.line - 1].trim()}`);
    }
  }
  return out.join("\n");
}
