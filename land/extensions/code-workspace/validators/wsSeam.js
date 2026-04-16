/**
 * WebSocket seam validator.
 *
 * Complements validators/integration.js (which checks HTTP fetch seams).
 * This module does STATIC ANALYSIS of the wire protocol between a
 * WebSocket server branch and a WebSocket client branch to catch the
 * naming/shape drift class of bug:
 *
 *   - Frontend sends {type: 'join'} but backend handles case 'JOIN_ROOM'
 *   - Backend broadcasts {type: 'gameState', players} but frontend
 *     reads data.snakes
 *   - Frontend sends {direction: 'up'} but backend destructures {x, y}
 *
 * Why static and not runtime: exercising a WebSocket protocol through
 * the preview proxy requires knowing the handshake sequence (room
 * codes, auth, etc.) which we can't guess without an LLM call. A regex
 * pass on both sides' source is deterministic, fast, and catches the
 * top category of bugs: the ones where each branch's AI session
 * independently invented names for shared concepts.
 *
 * Returns structured mismatches:
 *   { ok: true }
 *   { ok: true, skipped: true, reason: '...' }
 *   { ok: false, mismatches: [
 *       { kind, direction, type, field?, fromBranch, toBranch, evidence },
 *       ...
 *     ] }
 *
 * The kinds:
 *   - "unhandled-type": frontend sends a type the backend doesn't handle
 *   - "unreceived-type": backend sends a type the frontend doesn't handle
 *   - "unknown-field":   frontend reads data.X in a case handler for a
 *                        type the backend sends, but backend's
 *                        broadcast for that type doesn't include X
 *
 * Retry policy (caller's concern, not this module): the swarm should
 * emit each mismatch as a CONTRACT_MISMATCH signal on BOTH the producer
 * and consumer branches' signalInboxes and flip both to failed so the
 * retry loop has the corrective prompt on hand.
 *
 * Deliberate non-goals:
 *   - No AST parsing (regex is good enough for the common patterns
 *     and much faster to evolve)
 *   - No cross-file tracking of `const MSG_TYPE = 'foo'` constants
 *     (AI code rarely uses named constants for message types; it
 *     hardcodes the string in each case block)
 *   - No type inference — we only match literal types and literal
 *     field names
 */

import fs from "fs";
import path from "path";
import log from "../../../seed/log.js";

/**
 * Main entry. Called from swarm.js after all branches succeed and
 * HTTP integration smoke runs.
 *
 *   smokeWsSeam({ workspaceRoot, branches })
 *     → { ok: true, skipped?: true, reason?: string }
 *     → { ok: false, mismatches: [...] }
 *
 * `branches` is an array of { name, path, status } from the swarm
 * results. We partition into server/client by looking for
 * WebSocketServer vs `new WebSocket(` signatures in the files.
 */
export async function smokeWsSeam({ workspaceRoot, branches }) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    return { ok: true, skipped: true, reason: "no workspaceRoot" };
  }
  if (!Array.isArray(branches) || branches.length === 0) {
    return { ok: true, skipped: true, reason: "no branches" };
  }

  // Partition branches by who uses what side of the WS protocol.
  // A branch can be BOTH (a full-stack module) but that's rare; we
  // treat it as server + client against itself which still catches
  // internal drift.
  const servers = [];
  const clients = [];

  for (const b of branches) {
    if (b.status !== "done") continue;
    if (!b.path) continue;
    const branchDir = path.join(workspaceRoot, b.path);
    if (!fs.existsSync(branchDir)) continue;

    const files = walkSourceFiles(branchDir);
    const serverFiles = files.filter((f) => isWsServerFile(f));
    const clientFiles = files.filter((f) => isWsClientFile(f));

    if (serverFiles.length > 0) {
      servers.push({ branch: b, files: serverFiles, branchDir });
    }
    if (clientFiles.length > 0) {
      clients.push({ branch: b, files: clientFiles, branchDir });
    }
  }

  if (servers.length === 0 || clients.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: `not a ws client/server shape (ws-servers=${servers.length} ws-clients=${clients.length})`,
    };
  }

  // Extract the protocol surface from each side.
  const serverProtocol = extractServerProtocol(servers);
  const clientProtocol = extractClientProtocol(clients);

  // Cross-check. For simplicity we pool types across all servers and
  // all clients — if a multi-server shape emerges later we can scope.
  const mismatches = [];

  // Rule 1: frontend sends a type the backend doesn't handle
  for (const send of clientProtocol.sends) {
    if (!serverProtocol.handles.has(send.type)) {
      mismatches.push({
        kind: "unhandled-type",
        direction: "client→server",
        type: send.type,
        fromBranch: send.branch,
        toBranch: servers[0].branch.name,
        evidence: {
          clientFile: send.file,
          clientLine: send.line,
          backendHandles: [...serverProtocol.handles].sort(),
        },
        message:
          `Frontend sends { type: '${send.type}' } at ${send.file}:${send.line} ` +
          `but backend doesn't handle this type. Backend handles: ` +
          `${[...serverProtocol.handles].sort().join(", ") || "(none)"}. ` +
          `Align the names on both sides.`,
      });
    }
  }

  // Rule 2: backend broadcasts a type the frontend doesn't receive
  for (const send of serverProtocol.sends) {
    if (!clientProtocol.handles.has(send.type)) {
      mismatches.push({
        kind: "unreceived-type",
        direction: "server→client",
        type: send.type,
        fromBranch: send.branch,
        toBranch: clients[0].branch.name,
        evidence: {
          serverFile: send.file,
          serverLine: send.line,
          clientHandles: [...clientProtocol.handles].sort(),
        },
        message:
          `Backend broadcasts { type: '${send.type}' } at ${send.file}:${send.line} ` +
          `but frontend doesn't handle this type. Frontend handles: ` +
          `${[...clientProtocol.handles].sort().join(", ") || "(none)"}. ` +
          `Add a case '${send.type}' to the frontend onmessage switch, ` +
          `or rename the backend broadcast to match an existing frontend case.`,
      });
    }
  }

  // Rule 3: frontend reads data.X in a case for type T, but backend's
  // broadcast for T doesn't include field X. This catches the
  // "data.snakes vs data.players" failure we hit on TronGame.
  for (const read of clientProtocol.fieldReads) {
    const backendSend = serverProtocol.sends.find((s) => s.type === read.type);
    if (!backendSend) continue; // type mismatch already caught by rule 2
    if (!backendSend.fields.has(read.field) && backendSend.fields.size > 0) {
      mismatches.push({
        kind: "unknown-field",
        direction: "server→client",
        type: read.type,
        field: read.field,
        fromBranch: backendSend.branch,
        toBranch: read.branch,
        evidence: {
          clientFile: read.file,
          clientLine: read.line,
          serverFile: backendSend.file,
          serverLine: backendSend.line,
          serverFields: [...backendSend.fields].sort(),
        },
        message:
          `Frontend reads data.${read.field} in handler for '${read.type}' at ` +
          `${read.file}:${read.line}, but backend's broadcast of '${read.type}' ` +
          `at ${backendSend.file}:${backendSend.line} includes fields: ` +
          `${[...backendSend.fields].sort().join(", ") || "(none)"}. ` +
          `Either rename the backend field or the frontend read so they agree.`,
      });
    }
  }

  if (mismatches.length === 0) {
    log.info(
      "CodeWorkspace",
      `WS seam passed: ${clientProtocol.sends.length} client sends, ` +
      `${serverProtocol.sends.length} server broadcasts, ` +
      `${clientProtocol.fieldReads.length} field reads all matched`,
    );
    return {
      ok: true,
      stats: {
        clientSends: clientProtocol.sends.length,
        serverBroadcasts: serverProtocol.sends.length,
        fieldReads: clientProtocol.fieldReads.length,
      },
    };
  }

  log.warn(
    "CodeWorkspace",
    `🔗 WS seam: ${mismatches.length} mismatch(es) between ${servers[0].branch.name} and ${clients[0].branch.name}`,
  );
  return { ok: false, mismatches };
}

// ─────────────────────────────────────────────────────────────────────
// FILE TRAVERSAL + CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────

/**
 * Strip JS comments from source before running structural regexes.
 * Comments often mention old field names ("data.snakes was wrong, use
 * data.players") and would false-positive the field-read check if we
 * left them in. We replace with whitespace so line numbers are
 * preserved for accurate error reporting.
 *
 * Handles:
 *   - // line comments
 *   - \/\* ... \*\/ block comments
 *   - String literals and regex literals are left alone (their
 *     contents might look like comments but shouldn't be stripped)
 *
 * Not a full tokenizer — string/regex detection is rough but good
 * enough for the common source shapes the swarm writes.
 */
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];

    // Block comment
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) {
        // Unterminated — blank the rest, keep line count
        for (let j = i; j < n; j++) out += src[j] === "\n" ? "\n" : " ";
        return out;
      }
      for (let j = i; j < end + 2; j++) out += src[j] === "\n" ? "\n" : " ";
      i = end + 2;
      continue;
    }
    // Line comment
    if (ch === "/" && next === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
      continue;
    }
    // String literal — skip to matching close quote
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      out += ch; i++;
      while (i < n) {
        const c = src[i];
        if (c === "\\") { out += c + (src[i + 1] || ""); i += 2; continue; }
        out += c; i++;
        if (c === quote) break;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Walk up to 3 levels deep, collecting .js/.mjs/.html files. Skips
 * node_modules + dotfiles. Caps at 200 files.
 */
/**
 * Public re-export for contractConformance.js. Walks a branch dir
 * and returns the subset of source files it should scan (with the
 * same filters the main smoke path uses).
 */
export function walkSourceFilesForSeam(root) {
  return walkSourceFiles(root);
}

/**
 * Public re-export for contractConformance.js. Extracts a single
 * branch's protocol surface (sends, handles, field reads) without
 * classifying it as server or client. The contract validator only
 * cares what types a branch sends/handles/reads, not which side of
 * a seam it's on.
 *
 * Returns { sends, handles, fieldReads } in the same shape the
 * cross-check in smokeWsSeam uses, but scoped to one branch at a
 * time.
 */
export function extractBranchProtocolSurface(files, branchDir, branchName) {
  const handles = new Set();
  const sends = [];
  const fieldReads = [];
  for (const file of files) {
    let content;
    try {
      content = stripComments(fs.readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    const rel = path.relative(branchDir, file);
    for (const t of extractCaseTypes(content)) handles.add(t);
    for (const send of extractSends(content)) {
      sends.push({
        type: send.type,
        fields: send.fields,
        file: rel,
        line: send.line,
        branch: branchName,
      });
    }
    for (const read of extractFieldReadsByCase(content)) {
      fieldReads.push({
        type: read.type,
        field: read.field,
        file: rel,
        line: read.line,
        branch: branchName,
      });
    }
  }
  return { sends, handles, fieldReads };
}

function walkSourceFiles(root) {
  const out = [];
  const EXTS = new Set([".js", ".mjs", ".html", ".htm"]);
  // Files whose filenames indicate they're tests. These typically
  // contain test-client code that opens WebSockets and sends fake
  // messages — NOT production wire protocol. Including them pollutes
  // the seam surface with types that only exist in tests.
  const TEST_PATTERNS = [
    /\.test\.[cm]?js$/,
    /\.spec\.[cm]?js$/,
    /^test[-_]/i,
    /_test\.[cm]?js$/,
  ];
  // Directory names to skip entirely.
  const SKIP_DIRS = new Set(["node_modules", "tests", "test", "__tests__", "dist", "build"]);
  function walk(dir, depth) {
    if (depth > 3 || out.length >= 200) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name), depth + 1);
      } else if (entry.isFile() && EXTS.has(path.extname(entry.name).toLowerCase())) {
        if (TEST_PATTERNS.some((re) => re.test(entry.name))) continue;
        out.push(path.join(dir, entry.name));
      }
    }
  }
  walk(root, 0);
  return out;
}

function isWsServerFile(absPath) {
  try {
    const c = fs.readFileSync(absPath, "utf8");
    // Require an ACTUAL server construction, not just a ws import.
    // Test files import ws to build test clients and would false-
    // positive on the looser check.
    return (
      /new\s+WebSocketServer\s*\(/.test(c) ||
      /wss?\.on\(\s*['"]connection['"]/.test(c) ||
      /new\s+ws\.Server\s*\(/.test(c)
    );
  } catch {
    return false;
  }
}

function isWsClientFile(absPath) {
  try {
    const c = fs.readFileSync(absPath, "utf8");
    // new WebSocket(...) — the constructor pattern the browser uses
    return /new\s+WebSocket\s*\(/.test(c);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// PROTOCOL EXTRACTION
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract the server-side WebSocket protocol surface:
 *
 *   handles: Set of message types the server has a `case '<type>':` for
 *   sends:   Array of { type, file, line, fields: Set<string>, branch }
 *            — every { type: '<type>', ... } the server writes in a
 *            ws.send or broadcast. Field set is the keys of the object
 *            literal the type lives inside.
 *
 * The server source typically has:
 *   ws.on('message', (data) => {
 *     const msg = JSON.parse(data);
 *     switch (msg.type) {
 *       case 'join': ...            // ← handles
 *       case 'direction': ...
 *     }
 *   });
 *   ws.send(JSON.stringify({        // ← sends
 *     type: 'playerId',
 *     playerId: X,
 *   }));
 */
function extractServerProtocol(servers) {
  const handles = new Set();
  const sends = [];

  for (const s of servers) {
    for (const file of s.files) {
      const rel = path.relative(s.branchDir, file);
      let content;
      try {
        content = stripComments(fs.readFileSync(file, "utf8"));
      } catch {
        continue;
      }

      for (const t of extractCaseTypes(content)) handles.add(t);

      for (const send of extractSends(content)) {
        sends.push({
          type: send.type,
          fields: send.fields,
          file: rel,
          line: send.line,
          branch: s.branch.name,
        });
      }
    }
  }

  return { handles, sends };
}

/**
 * Extract the client-side WebSocket protocol surface:
 *
 *   sends:      Array of { type, file, line, branch } — every
 *               JSON.stringify({ type: '<type>', ... }) the client emits
 *   handles:    Set of message types the client has a `case '<type>':`
 *               for inside its onmessage handler
 *   fieldReads: Array of { type, field, file, line, branch } — every
 *               `data.<field>` read that lives inside a `case '<type>':`
 *               block
 *
 * The field reads are the trickiest: we need to know which case block
 * we're currently inside when we see a `data.field` read. Done by
 * segmenting the file by case: regions and assigning each field-read
 * to the nearest enclosing case.
 */
function extractClientProtocol(clients) {
  const handles = new Set();
  const sends = [];
  const fieldReads = [];

  for (const c of clients) {
    for (const file of c.files) {
      const rel = path.relative(c.branchDir, file);
      let content;
      try {
        content = stripComments(fs.readFileSync(file, "utf8"));
      } catch {
        continue;
      }

      for (const t of extractCaseTypes(content)) handles.add(t);

      for (const send of extractSends(content)) {
        sends.push({
          type: send.type,
          file: rel,
          line: send.line,
          branch: c.branch.name,
        });
      }

      for (const read of extractFieldReadsByCase(content)) {
        fieldReads.push({
          type: read.type,
          field: read.field,
          file: rel,
          line: read.line,
          branch: c.branch.name,
        });
      }
    }
  }

  return { handles, sends, fieldReads };
}

// ─────────────────────────────────────────────────────────────────────
// REGEX EXTRACTORS
// ─────────────────────────────────────────────────────────────────────

/**
 * Find every `case 'xxx':` or `case "xxx":` in a source file. Used
 * for both server (message routing) and client (message receiving).
 */
function extractCaseTypes(content) {
  const out = [];
  const re = /\bcase\s+(['"])([\w\-.:]+)\1\s*:/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    out.push(m[2]);
  }
  return out;
}

/**
 * Find every WS SEND in the source and extract its { type, fields }.
 * A "send" is narrowly defined: an object literal passed as the
 * argument to `JSON.stringify(` which is itself the argument to some
 * `.send(` call. We anchor on the `.send(JSON.stringify(` sequence
 * to avoid picking up local object literals like
 * `state.elements.push({type: 'path', ...})` that happen to have a
 * `type:` key but aren't wire messages.
 *
 * Matches both:
 *   ws.send(JSON.stringify({ type: 'gameState', players, apples }))
 *   socket.send(JSON.stringify({ type: 'join' }))
 *   player.ws.send(JSON.stringify({ type: 'playerId', playerId: X }))
 */
function extractSends(content) {
  const out = [];
  // Anchor: ANYTHING `.send(JSON.stringify(` — greedy on the part
  // before .send, tolerant of whitespace. We capture the index AFTER
  // the opening `(` of JSON.stringify so we know where the object
  // literal starts.
  const anchor = /\.send\s*\(\s*JSON\s*\.\s*stringify\s*\(\s*/g;
  let m;
  while ((m = anchor.exec(content)) !== null) {
    const afterOpen = m.index + m[0].length;
    // Expect an `{` at or very near the next non-space character.
    let openIdx = -1;
    for (let i = afterOpen; i < Math.min(content.length, afterOpen + 10); i++) {
      const ch = content[i];
      if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") continue;
      if (ch === "{") { openIdx = i; break; }
      break; // something else — not an object literal send
    }
    if (openIdx === -1) continue;

    // Walk forwards to the matching `}`, respecting nested braces,
    // but ignore braces that live inside string literals (common in
    // template-literal payloads).
    let closeIdx = -1;
    let depth = 0;
    let i = openIdx;
    while (i < content.length) {
      const ch = content[i];
      if (ch === "'" || ch === '"' || ch === "`") {
        // Skip past string literal
        const quote = ch;
        i++;
        while (i < content.length) {
          if (content[i] === "\\") { i += 2; continue; }
          if (content[i] === quote) { i++; break; }
          i++;
        }
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { closeIdx = i; break; }
      }
      i++;
    }
    if (closeIdx === -1) continue;

    const body = content.slice(openIdx + 1, closeIdx);

    // Pull the type out of the body. If there's no `type:` key, this
    // is an untyped send; skip it for now (can't compare across
    // branches without a discriminant).
    const typeMatch = body.match(/\btype\s*:\s*(['"])([\w\-.:]+)\1/);
    if (!typeMatch) continue;
    const type = typeMatch[2];

    const fields = extractObjectFieldNames(body);
    fields.delete("type");

    const before = content.slice(0, m.index);
    const line = (before.match(/\n/g) || []).length + 1;

    out.push({ type, fields, line });
  }
  return out;
}

/**
 * Pull field names out of a flat object-literal body. Catches:
 *
 *   { foo: 1, bar: "baz", players: someMap, apples }
 *
 * Handles shorthand properties (`apples` alone), key: value pairs,
 * and nested object shorthand. Returns a Set of the top-level keys.
 *
 * Limitation: doesn't recurse into nested object literals to discover
 * their own fields. That's fine — we only care about the top level
 * because that's what the frontend reads as `data.X`.
 */
function extractObjectFieldNames(body) {
  const fields = new Set();
  // Match `key:` where key is a plain identifier or string literal.
  const kv = /(?:^|[,{\s])(['"]?)([A-Za-z_$][\w$]*)\1\s*:/g;
  let m;
  while ((m = kv.exec(body)) !== null) {
    fields.add(m[2]);
  }
  // Shorthand properties: `{ foo, bar }` — match any bare identifier
  // followed by `,` or `}` that isn't already a key.
  const shorthand = /(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*(?=[,}])/g;
  while ((m = shorthand.exec(body)) !== null) {
    // Don't overwrite if we already captured it as a key
    fields.add(m[1]);
  }
  return fields;
}

/**
 * For each `case '<type>':` block in a handler, find `data.<field>` or
 * `data['<field>']` reads inside the block. Returns array of
 * { type, field, line }.
 *
 * Block boundary: from `case 'X':` to the next `case ` or `default:` or
 * end of the enclosing switch. Approximate but matches the common
 * switch shape the AI generates.
 */
function extractFieldReadsByCase(content) {
  const out = [];
  const caseRe = /\bcase\s+(['"])([\w\-.:]+)\1\s*:/g;
  const cases = [];
  let m;
  while ((m = caseRe.exec(content)) !== null) {
    cases.push({ type: m[2], start: m.index });
  }
  // Also find default: and switch close as terminators
  const defaultRe = /\bdefault\s*:/g;
  const defaults = [];
  while ((m = defaultRe.exec(content)) !== null) {
    defaults.push(m.index);
  }

  // For each case, compute its end as the start of the next case,
  // the next default:, or the next closing brace at lower depth.
  for (let i = 0; i < cases.length; i++) {
    const start = cases[i].start;
    let end = content.length;
    // Next case
    if (i + 1 < cases.length && cases[i + 1].start > start) {
      end = Math.min(end, cases[i + 1].start);
    }
    // Next default:
    for (const d of defaults) {
      if (d > start && d < end) end = d;
    }
    // Next closing brace — rough brace-balance walk
    let depth = 0;
    for (let p = start; p < content.length; p++) {
      const ch = content[p];
      if (ch === "{") depth++;
      else if (ch === "}") {
        if (depth === 0) { end = Math.min(end, p); break; }
        depth--;
      }
    }

    const body = content.slice(start, end);
    const fieldRe = /\bdata\s*\.\s*([A-Za-z_$][\w$]*)\b/g;
    let fm;
    while ((fm = fieldRe.exec(body)) !== null) {
      const field = fm[1];
      // Line number of the read in the original content
      const absIdx = start + fm.index;
      const before = content.slice(0, absIdx);
      const line = (before.match(/\n/g) || []).length + 1;
      out.push({ type: cases[i].type, field, line });
    }
    // Also catch `data['field']` / `data["field"]`
    const bracketRe = /\bdata\s*\[\s*(['"])([^'"]+)\1\s*\]/g;
    while ((fm = bracketRe.exec(body)) !== null) {
      const field = fm[2];
      const absIdx = start + fm.index;
      const before = content.slice(0, absIdx);
      const line = (before.match(/\n/g) || []).length + 1;
      out.push({ type: cases[i].type, field, line });
    }
  }
  return out;
}
