/**
 * Phase 2 contracts validator.
 *
 * Contracts are the shared truth between swarm branches. When the
 * backend writes a route that returns `{ success, sessionId, user }`,
 * the frontend must destructure those EXACT field names — not
 * `sessionToken`, not `token`, not `session_id`. Before phase 2 this
 * was only caught at runtime (or, as the Tinder build proved, only
 * when a human noticed the app was broken).
 *
 * This module is pure extraction + diff. It touches no tree state and
 * no disk. The storage layer lives in the swarm extension
 * (metadata.swarm.contracts via setContracts / readContracts); the
 * afterNote wiring lives in code-workspace/index.js.
 *
 * Extraction strategy
 * ───────────────────
 * Backend (anything that looks like an Express router file):
 *   - Scan for router.<method>('<path>', ...) declarations
 *   - For each, find the handler body (the next balanced {} block)
 *   - Inside the handler:
 *     - extract response shape from the FIRST res.json({...}) literal
 *     - extract request body fields from `req.body.X` member accesses
 *       and from `const { x, y } = req.body` destructurings
 *   - Resolve mount prefix: prefer an explicit mountPrefix arg (the
 *     caller walked server.js), else fall back to routes/<name>.js →
 *     /api/<name> convention
 *
 * Frontend (anything with fetch calls):
 *   - Scan for fetch('<url>', { method, body: JSON.stringify({...}) })
 *   - Pair each fetch with the NEXT `const { ... } = await res.json()`
 *     or `= await <var>.json()` inside a reasonable window
 *   - The destructured keys become the frontend's expected response
 *     shape; the body keys become the frontend's sent request shape
 *
 * Diff
 * ────
 *   diffContracts(contracts, expectation) walks the expectation and
 *   returns a list of field-level mismatches when the contract has a
 *   shape but the expectation names fields that aren't in it.
 *   First-writer-wins: the VIOLATOR is the one diffContracts is
 *   called with, and it's the one that has to conform.
 *
 * Known limits (documented, acceptable, phase 2.5 may fix)
 * ────────────────────────────────────────────────────────
 *   - Member expressions (data.user.name) not extracted
 *   - Dynamic routes (router[method](...)) not matched
 *   - Spread operators in res.json (`res.json({...user})`) partially
 *     handled — the literal keys are captured, the spread source is
 *     marked as "unknown"
 *   - Conditional res.json (different shape per branch) collapses to
 *     the first one
 *   - fetch() with a URL from a variable not extracted
 */

const HANDLER_SCAN_MAX = 5000;      // max chars to scan forward for a handler body
const FRONTEND_PAIR_WINDOW = 2500;  // chars to look ahead for destructuring after fetch()

// ─────────────────────────────────────────────────────────────────────
// BACKEND EXTRACTION
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract contracts from a backend (Express-style) router or server
 * file. Returns { contracts: [...] }.
 *
 * `mountPrefix` is optional. When null, a convention-based prefix is
 * inferred from the filename: `routes/auth.js` → `/api/auth`. When
 * passed explicitly by the caller (who walked server.js app.use calls)
 * it overrides the convention.
 */
export function extractBackendContracts({ filePath, content, mountPrefix = null }) {
  if (typeof content !== "string" || !content) return { contracts: [] };

  // Skip files that obviously aren't routers
  if (!/router\.(get|post|put|delete|patch|use)\b/i.test(content)
      && !/app\.(get|post|put|delete|patch)\b/i.test(content)) {
    return { contracts: [] };
  }

  const prefix = mountPrefix != null ? mountPrefix : inferPrefixFromFilename(filePath);
  const contracts = [];

  // Match router.METHOD('path', ...) AND app.METHOD('path', ...).
  // The distinction matters: router paths are mount-relative and need
  // the prefix prepended, app paths are already app-absolute and use
  // the path as-is.
  const pattern = /\b(router|app)\.(get|post|put|delete|patch)\s*\(\s*(['"`])([^'"`]+)\3/g;
  let m;
  while ((m = pattern.exec(content)) !== null) {
    const receiver = m[1];
    const method = m[2].toUpperCase();
    const relPath = m[4];
    const endpoint = receiver === "app"
      ? relPath
      : joinRoutePath(prefix, relPath);
    const startIdx = m.index;
    const sourceLine = lineOf(content, startIdx);

    // Find the handler body — the next `{` after the declaration that
    // starts a function. Scan within a window to avoid runaway on
    // pathological input.
    const windowEnd = Math.min(content.length, startIdx + HANDLER_SCAN_MAX);
    const handlerBodyRange = findHandlerBodyRange(content, startIdx, windowEnd);
    let handlerBody = "";
    if (handlerBodyRange) {
      handlerBody = content.slice(handlerBodyRange.start, handlerBodyRange.end);
    }

    const requestBody = extractRequestBodyFields(handlerBody);
    const response = extractResJsonShape(handlerBody);

    contracts.push({
      key: `${method} ${endpoint}`,
      method,
      endpoint,
      sourceFile: filePath,
      sourceLine,
      request: { body: requestBody },
      response: {
        shape: response.shape,
        raw: response.raw,
        inferred: response.inferred,
      },
    });
  }

  return { contracts };
}

/**
 * Scan a server.js-style entry file for `app.use('<prefix>', <varName>)`
 * statements combined with `import <varName> from '<relPath>'`. Returns
 * a map of route-file basenames to their mount prefixes, so the caller
 * can pass the right `mountPrefix` when extracting contracts from each
 * route file.
 *
 * Example:
 *   import authRoutes from './routes/auth.js';
 *   app.use('/api/auth', authRoutes);
 *   → { 'routes/auth.js': '/api/auth', 'auth.js': '/api/auth' }
 *
 * Best-effort. Missing entries fall back to the filename convention.
 */
export function extractMountPrefixes({ content }) {
  if (typeof content !== "string" || !content) return {};
  const result = {};

  // Step 1: import var → relative path
  const importPattern = /import\s+(\w+)\s*(?:,\s*\{[^}]*\})?\s*from\s+['"`]([^'"`]+)['"`]/g;
  const varToPath = {};
  let im;
  while ((im = importPattern.exec(content)) !== null) {
    varToPath[im[1]] = im[2];
  }

  // Step 2: app.use('<prefix>', <var>)
  const usePattern = /\bapp\.use\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*(\w+)/g;
  let um;
  while ((um = usePattern.exec(content)) !== null) {
    const prefix = um[2];
    const varName = um[3];
    const rel = varToPath[varName];
    if (!rel) continue;
    const normalized = normalizeImportPath(rel);
    result[normalized] = prefix;
    // Also index by basename for loose matching
    const basename = normalized.split("/").pop();
    if (basename && !result[basename]) result[basename] = prefix;
  }

  return result;
}

function normalizeImportPath(p) {
  // `./routes/auth.js`, `./routes/auth`, `/routes/auth.js` → `routes/auth.js`
  let out = p.replace(/^\.\//, "").replace(/^\//, "");
  if (!/\.[cm]?js$/.test(out)) out = out + ".js";
  return out;
}

function inferPrefixFromFilename(filePath) {
  // routes/auth.js → /api/auth
  // backend/routes/auth.js → /api/auth
  const m = /routes\/([^/]+?)\.[cm]?js$/.exec(filePath || "");
  if (m) return `/api/${m[1]}`;
  return "";
}

function joinRoutePath(prefix, relPath) {
  const p1 = (prefix || "").replace(/\/+$/, "");
  const p2 = String(relPath || "").replace(/^\/+/, "");
  if (!p2) return p1 || "/";
  return `${p1}/${p2}`;
}

function lineOf(content, charIndex) {
  const before = content.slice(0, charIndex);
  return (before.match(/\n/g) || []).length + 1;
}

/**
 * Find the balanced handler body for a route declaration. Scans forward
 * from `declStart` looking for the first `{` that opens the handler and
 * returns `{ start, end }` offsets (start = char AFTER the opening `{`,
 * end = char of the closing `}`). Returns null if no body is found
 * within `windowEnd`.
 *
 * The handler may be an arrow function `(req, res) => { ... }` or a
 * named function. Either way, the first unambiguous `{` after the
 * route path string literal opens the body.
 */
function findHandlerBodyRange(content, declStart, windowEnd) {
  // Walk forward to the first `{` that looks like a function body.
  // Simple heuristic: the first `{` after an `=>` token. If no `=>`,
  // accept the first `{` after `function` keyword.
  let i = declStart;
  let arrowIdx = -1;
  while (i < windowEnd - 1) {
    if (content[i] === "=" && content[i + 1] === ">") {
      arrowIdx = i + 2;
      break;
    }
    if (content.slice(i, i + 9).match(/^function\b/)) {
      arrowIdx = i + 8;
      break;
    }
    i++;
  }
  if (arrowIdx === -1) return null;

  // Find the first `{` after the arrow
  let openIdx = -1;
  for (let j = arrowIdx; j < windowEnd; j++) {
    if (content[j] === "{") {
      openIdx = j;
      break;
    }
    // If we hit a token that means the arrow function is expression-
    // bodied, there's no braced handler — that's fine, stop here
    if (/[;(]/.test(content[j])) break;
  }
  if (openIdx === -1) return null;

  const closeIdx = matchBrace(content, openIdx, windowEnd);
  if (closeIdx === -1) return null;

  return { start: openIdx + 1, end: closeIdx };
}

/**
 * Given an opening `{` at `openIdx`, return the index of its matching
 * `}` honoring string/comment contexts. Returns -1 if unbalanced inside
 * the window.
 */
function matchBrace(content, openIdx, limit = Infinity) {
  if (content[openIdx] !== "{") return -1;
  let depth = 0;
  let i = openIdx;
  let inStr = null;  // null | '"' | "'" | '`'
  let inLineComment = false;
  let inBlockComment = false;
  const end = Math.min(content.length, limit);

  while (i < end) {
    const ch = content[i];
    const next = content[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
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
 * Extract request body field names from a handler body. Catches:
 *   - `const { x, y } = req.body`
 *   - `const { x: renamed, y = default } = req.body`
 *   - direct member access: `req.body.x`
 *
 * Returns a sorted, deduplicated array of field names.
 */
function extractRequestBodyFields(handlerBody) {
  if (!handlerBody) return [];
  const out = new Set();

  // Destructuring: const { a, b: c, d = 1 } = req.body
  const destructPattern = /\bconst\s*\{\s*([^}]+)\s*\}\s*=\s*req\.body\b/g;
  let dm;
  while ((dm = destructPattern.exec(handlerBody)) !== null) {
    const fields = parseDestructuredKeys(dm[1]);
    for (const f of fields) out.add(f);
  }
  // Also `let ... = req.body` and `var ... = req.body`
  const destructPattern2 = /\b(?:let|var)\s*\{\s*([^}]+)\s*\}\s*=\s*req\.body\b/g;
  let dm2;
  while ((dm2 = destructPattern2.exec(handlerBody)) !== null) {
    const fields = parseDestructuredKeys(dm2[1]);
    for (const f of fields) out.add(f);
  }

  // Member access: req.body.xxx
  const memberPattern = /\breq\.body\.([a-zA-Z_$][\w$]*)/g;
  let mm;
  while ((mm = memberPattern.exec(handlerBody)) !== null) {
    out.add(mm[1]);
  }

  return Array.from(out).sort();
}

/**
 * Parse the inside of a `{ ... }` destructuring pattern into the LOCAL
 * key names (the names the SOURCE object must provide). Handles:
 *   a           → a
 *   a: b        → a   (local name is b, source key is a)
 *   a: b = 1    → a
 *   ...rest     → (skipped — rest captures all remaining)
 */
function parseDestructuredKeys(body) {
  const out = [];
  // Split top-level commas (not inside nested braces/brackets — simple
  // destructuring doesn't usually nest but be defensive)
  let depth = 0;
  let start = 0;
  const parts = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));

  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    if (part.startsWith("...")) continue;
    // `a: b = default` → source key is `a`
    // `a = default`    → source key is `a`
    // `a`              → `a`
    const m = part.match(/^([a-zA-Z_$][\w$]*)/);
    if (m) out.push(m[1]);
  }
  return out;
}

/**
 * Extract the shape of the FIRST res.json({...}) object literal found
 * in a handler body. Returns { shape, raw, inferred }.
 *
 *   shape    — array of top-level keys
 *   raw      — the literal source (truncated, for display)
 *   inferred — "literal" | "variable" | "unknown"
 *
 * If res.json is called with a variable (not a literal), shape is
 * empty and inferred is "variable". If there's no res.json at all,
 * inferred is "unknown".
 */
function extractResJsonShape(handlerBody) {
  if (!handlerBody) {
    return { shape: [], raw: null, inferred: "unknown" };
  }

  // Find `res.json(` or `res.status(N).json(`
  const pattern = /\bres(?:\.status\s*\([^)]*\))?\.json\s*\(/g;
  let m;
  // Prefer a res.json that's NOT inside an error path (avoid catching
  // the `res.status(500).json({ error: '...' })` shape as the contract).
  // Heuristic: pick the FIRST res.json that's NOT wrapped in .status(4xx|5xx).
  // Simpler: collect all, prefer ones without .status() at all.
  const candidates = [];
  while ((m = pattern.exec(handlerBody)) !== null) {
    const afterParen = m.index + m[0].length;
    const inner = extractParenContent(handlerBody, afterParen - 1);
    if (inner === null) continue;
    const isError = /\.status\s*\(\s*[45]\d\d/.test(handlerBody.slice(m.index, afterParen));
    candidates.push({ inner, isError, raw: handlerBody.slice(m.index, afterParen + inner.length + 1) });
  }

  if (candidates.length === 0) {
    return { shape: [], raw: null, inferred: "unknown" };
  }

  const success = candidates.find((c) => !c.isError) || candidates[0];
  const inner = success.inner.trim();

  // If inner starts with `{`, parse object literal keys
  if (inner.startsWith("{")) {
    const keys = parseObjectLiteralKeys(inner);
    return {
      shape: keys,
      raw: truncate(inner, 300),
      inferred: "literal",
    };
  }

  // Otherwise it's a variable or expression — unknown shape
  return {
    shape: [],
    raw: truncate(inner, 200),
    inferred: "variable",
  };
}

/**
 * Extract the content between a `(` at `openIdx` and its matching `)`.
 * Returns the content string (not including the parens) or null if
 * unbalanced. Honors string/comment contexts. The opening `(` may be
 * at `openIdx` or `openIdx - 1` depending on how the caller indexed it;
 * this function expects `content[openIdx] === '('`.
 */
function extractParenContent(content, openIdx) {
  if (content[openIdx] !== "(") return null;
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
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
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
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return content.slice(openIdx + 1, i);
    }
    i++;
  }
  return null;
}

/**
 * Parse the top-level keys of an object literal like `{ a: 1, b, c: fn() }`.
 * Scans comma-separated entries and grabs the leading identifier of each.
 * Handles:
 *   a: 1           → a
 *   a              → a   (shorthand)
 *   a: b           → a
 *   "a": 1         → a
 *   ...other       → (skipped, but the entry is marked so the caller
 *                     sees the shape isn't fully literal)
 *   [dynamic]: 1   → (skipped)
 *
 * Nested objects/arrays/functions in values don't contribute keys.
 */
function parseObjectLiteralKeys(literal) {
  // literal starts with `{` and ends with `}`
  const inner = literal.replace(/^\{/, "").replace(/\}$/, "");
  const out = [];
  let depth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;
  let start = 0;
  let inStr = null;

  // Split at top-level commas
  const parts = [];
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
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
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));

  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part) continue;
    if (part.startsWith("...")) continue;
    if (part.startsWith("[")) continue; // computed key
    // Strip leading quote if quoted key
    const quoted = part.match(/^(['"])([^'"]+)\1/);
    if (quoted) {
      out.push(quoted[2]);
      continue;
    }
    const ident = part.match(/^([a-zA-Z_$][\w$]*)/);
    if (ident) out.push(ident[1]);
  }
  return out;
}

function truncate(s, n) {
  const str = String(s || "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

// ─────────────────────────────────────────────────────────────────────
// FRONTEND EXTRACTION
// ─────────────────────────────────────────────────────────────────────

/**
 * Extract frontend expectations from a JS/HTML file. Returns
 * { expectations: [...] } where each expectation looks like:
 *
 *   {
 *     method:   'POST',
 *     endpoint: '/api/auth/login',
 *     sourceFile: 'frontend/app.js',
 *     sourceLine: 78,
 *     request:  { body: ['email', 'password'] },
 *     response: { shape: ['sessionId', 'user'], inferred: 'literal' }
 *   }
 *
 * Pairs each fetch() with the next `const { ... } = await res.json()`
 * or equivalent within a sliding window after the fetch call.
 */
export function extractFrontendExpectations({ filePath, content }) {
  if (typeof content !== "string" || !content) return { expectations: [] };
  if (!/\bfetch\s*\(/.test(content)) return { expectations: [] };

  // Build a table of top-level `const X = '/api'` declarations so we
  // can resolve fetch URLs that use template literals like
  // `${API_BASE}/auth/login`. Any const bound to a string literal that
  // starts with `/` is eligible as a base-path variable.
  const baseVars = {};
  const baseVarPattern = /\b(?:const|let|var)\s+([A-Z_][A-Z0-9_]*)\s*=\s*(['"`])(\/[^'"`]*)\2/g;
  let bv;
  while ((bv = baseVarPattern.exec(content)) !== null) {
    baseVars[bv[1]] = bv[3];
  }

  const expectations = [];
  // Match the fetch() head: `fetch( 'url' ` or `fetch( \`url\` `, then
  // use brace-matching to capture the optional options object that
  // follows. Regex alone can't handle nested braces (headers: {...},
  // body: JSON.stringify({...})) so we fall back to a manual scan.
  const headPattern = /\bfetch\s*\(\s*(['"`])([^'"`]+)\1/g;
  let m;
  while ((m = headPattern.exec(content)) !== null) {
    const rawUrl = m[2];
    // Find the optional options object starting after the URL literal
    let opts = "";
    let afterUrl = m.index + m[0].length;
    // Skip whitespace, then look for `, {`
    while (afterUrl < content.length && /\s/.test(content[afterUrl])) afterUrl++;
    if (content[afterUrl] === ",") {
      let j = afterUrl + 1;
      while (j < content.length && /\s/.test(content[j])) j++;
      if (content[j] === "{") {
        const close = matchBrace(content, j, content.length);
        if (close !== -1) {
          opts = content.slice(j + 1, close);
        }
      }
    }
    // Resolve `${VAR}...` prefixes against the base var table. Anything
    // that's still a ${...} interpolation after substitution becomes
    // :PARAM so the URL can still match :param segments in contracts.
    let url = rawUrl.replace(/\$\{([^}]+)\}/g, (_, expr) => {
      const trimmed = expr.trim();
      if (baseVars[trimmed]) return baseVars[trimmed];
      return ":PARAM";
    });
    if (!url.startsWith("/")) continue;
    const methodMatch = opts.match(/\bmethod\s*:\s*(['"`])([A-Za-z]+)\1/);
    const method = methodMatch ? methodMatch[2].toUpperCase() : "GET";

    // Body keys
    const bodyKeys = extractFetchBodyKeys(opts);

    // Look ahead in the content for a destructuring that consumes the
    // response of THIS fetch. Simple heuristic: first `const { ... } = await ...json()`
    // or `const X = await ...json()` within FRONTEND_PAIR_WINDOW chars.
    // We resume scanning from AFTER the matched fetch head + its opts.
    const headEnd = m.index + m[0].length;
    const lookStart = headEnd + (opts ? opts.length + 3 : 0);
    const lookEnd = Math.min(content.length, lookStart + FRONTEND_PAIR_WINDOW);
    const window = content.slice(lookStart, lookEnd);
    const response = pairResponseDestructuring(window);

    // Strip query strings; interpolations already resolved above.
    const normalizedUrl = url.split("?")[0];

    // Reject garbage URLs where an unresolved ${VAR} interpolation
    // produced a segment like "/api:PARAM" (no slash between "api"
    // and ":PARAM"). That's a sign the real URL is built dynamically
    // and this regex-level extraction can't reach it — better to skip
    // than emit a phantom mismatch.
    if (/[^/]:PARAM/.test(normalizedUrl)) continue;

    expectations.push({
      key: `${method} ${normalizedUrl}`,
      method,
      endpoint: normalizedUrl,
      sourceFile: filePath,
      sourceLine: lineOf(content, m.index),
      request: { body: bodyKeys },
      response: {
        shape: response.shape,
        inferred: response.inferred,
      },
    });
  }

  // Detect helper-prefix: when a file has a `fetch(\`<STATIC>${VAR}\`)`
  // pattern somewhere (typically inside an apiCall helper function),
  // the helper call sites write `apiCall('POST', '/messages', ...)`
  // but the REAL URL is `/api/messages`. Extract the static prefix
  // from the template literal and use it as a default base for any
  // helper-call extraction in this file. If multiple distinct prefixes
  // exist, skip the heuristic to avoid wrong guesses.
  let helperPrefix = "";
  const tpPattern = /\bfetch\s*\(\s*`([^`]*?)\$\{[^}]+\}/g;
  const prefixes = new Set();
  let tp;
  while ((tp = tpPattern.exec(content)) !== null) {
    const prefix = tp[1];
    if (prefix.startsWith("/")) prefixes.add(prefix);
  }
  if (prefixes.size === 1) {
    helperPrefix = [...prefixes][0].replace(/\/+$/, "");
  }

  // ── Helper-call extraction ──
  // Many projects wrap fetch() in a helper like:
  //   apiCall('POST', '/messages', { to, text })
  //   api.post('/users', { name, email })
  //   http.delete('/items/42')
  // The real fetch call uses template interpolation we can't reach,
  // but the helper call site has the method + path + body literals.
  // Match `<ident>(<METHOD>, <path>[, <body>])` and
  // `<ident>.<method>(<path>[, <body>])` forms. Any unknown identifier
  // counts — we don't try to whitelist helper names, just look for
  // the signature shape.
  const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

  // Form 1: callName('METHOD', '/path' [, { body }])
  const form1 = /\b([a-zA-Z_$][\w$]*)\s*\(\s*(['"`])(GET|POST|PUT|PATCH|DELETE|HEAD)\2\s*,\s*(['"`])(\/[^'"`]*)\4/gi;
  let h;
  while ((h = form1.exec(content)) !== null) {
    const callName = h[1];
    // Skip fetch itself — already covered by the direct-fetch loop
    if (callName === "fetch") continue;
    const method = h[3].toUpperCase();
    let url = h[5].replace(/\$\{([^}]+)\}/g, ":PARAM");
    if (!url.startsWith("/")) continue;
    if (/[^/]:PARAM/.test(url)) continue;
    // Apply the detected helper prefix ONLY if the URL isn't already
    // prefixed (the helper might be called with both '/messages' AND
    // '/api/messages' depending on site).
    if (helperPrefix && !url.startsWith(helperPrefix + "/") && url !== helperPrefix) {
      url = helperPrefix + url;
    }

    const afterPath = h.index + h[0].length;
    const bodyKeys = tryExtractThirdArgKeys(content, afterPath);

    // Look ahead for response destructuring the same way fetch does
    const lookEnd = Math.min(content.length, afterPath + FRONTEND_PAIR_WINDOW);
    const response = pairResponseDestructuring(content.slice(afterPath, lookEnd));

    expectations.push({
      key: `${method} ${url}`,
      method,
      endpoint: url,
      sourceFile: filePath,
      sourceLine: lineOf(content, h.index),
      request: { body: bodyKeys },
      response: {
        shape: response.shape,
        inferred: response.inferred,
      },
    });
  }

  // Form 2: obj.method('/path' [, { body }])
  const form2 = /\b([a-zA-Z_$][\w$]*)\.(get|post|put|patch|delete|head)\s*\(\s*(['"`])(\/[^'"`]*)\3/gi;
  let h2;
  while ((h2 = form2.exec(content)) !== null) {
    const callName = h2[1];
    // Skip anything that looks like an Express server declaration
    // (router.get/app.post/etc. — that's backend, not frontend)
    if (callName === "app" || callName === "router") continue;
    const method = h2[2].toUpperCase();
    let url = h2[4].replace(/\$\{([^}]+)\}/g, ":PARAM");
    if (!url.startsWith("/")) continue;
    if (/[^/]:PARAM/.test(url)) continue;

    const afterPath = h2.index + h2[0].length;
    const bodyKeys = tryExtractThirdArgKeys(content, afterPath);
    const lookEnd = Math.min(content.length, afterPath + FRONTEND_PAIR_WINDOW);
    const response = pairResponseDestructuring(content.slice(afterPath, lookEnd));

    expectations.push({
      key: `${method} ${url}`,
      method,
      endpoint: url,
      sourceFile: filePath,
      sourceLine: lineOf(content, h2.index),
      request: { body: bodyKeys },
      response: {
        shape: response.shape,
        inferred: response.inferred,
      },
    });
  }

  // Deduplicate: if both the direct-fetch extractor AND the helper-call
  // extractor flagged the same method+endpoint+sourceLine, keep only
  // the one with body keys. No-op when there are no overlaps.
  const byKey = new Map();
  for (const exp of expectations) {
    const key = `${exp.method} ${exp.endpoint} ${exp.sourceLine}`;
    const existing = byKey.get(key);
    if (!existing || (exp.request.body.length > existing.request.body.length)) {
      byKey.set(key, exp);
    }
  }
  return { expectations: Array.from(byKey.values()) };
}

/**
 * Given a position in the source just AFTER a helper-call's method+path
 * arguments (e.g. right after `apiCall('POST', '/messages'`), look for
 * a third argument that's an object literal `{ ... }` and return its
 * top-level keys. Uses brace matching to handle nested values.
 *
 * Returns [] if the next token isn't `, {` or if the helper doesn't
 * have a third argument (e.g. `apiCall('GET', '/profiles')` — method
 * and path only, no body).
 */
function tryExtractThirdArgKeys(content, startIdx) {
  let i = startIdx;
  // Skip whitespace
  while (i < content.length && /\s/.test(content[i])) i++;
  if (content[i] !== ",") return [];
  i++;
  while (i < content.length && /\s/.test(content[i])) i++;
  if (content[i] !== "{") return [];
  const close = matchBrace(content, i, content.length);
  if (close === -1) return [];
  const literal = content.slice(i, close + 1);
  try {
    return parseObjectLiteralKeys(literal).sort();
  } catch {
    return [];
  }
}

/**
 * Parse the options object of a fetch() call for `body: JSON.stringify({...})`
 * and return the top-level keys of the sent object literal.
 */
function extractFetchBodyKeys(optsBody) {
  if (!optsBody) return [];
  const m = /\bbody\s*:\s*JSON\.stringify\s*\(\s*(\{[\s\S]*?\})\s*\)/m.exec(optsBody);
  if (!m) return [];
  const literal = m[1];
  return parseObjectLiteralKeys(literal).sort();
}

/**
 * Look inside a window of frontend code AFTER a fetch() call for a
 * response destructuring. Matches:
 *
 *   const { a, b } = await res.json()
 *   const { a, b } = await response.json()
 *   const data = await res.json()       → shape unknown, inferred 'variable'
 *
 * Returns { shape, inferred }.
 *
 * Only the FIRST matching await-json within the window counts — this is
 * how we pair fetch with its destructuring. Fragile when the author
 * awaits twice or stores the promise and chains later, but catches the
 * common case 90% of the time.
 */
function pairResponseDestructuring(window) {
  // Prefer destructuring form first
  const destruct = /\bconst\s*\{\s*([^}]+)\s*\}\s*=\s*(?:await\s+)?(?:\w+)\.json\s*\(\s*\)/m.exec(window);
  if (destruct) {
    const keys = parseDestructuredKeys(destruct[1]).sort();
    return { shape: keys, inferred: "literal" };
  }
  // Fall back to variable assignment — shape unknown but we noted the
  // call happened
  const varForm = /\bconst\s+\w+\s*=\s*(?:await\s+)?(?:\w+)\.json\s*\(\s*\)/m.exec(window);
  if (varForm) {
    return { shape: [], inferred: "variable" };
  }
  return { shape: [], inferred: "unknown" };
}

/**
 * Normalize a frontend URL for matching against backend contracts.
 * Strips query strings, template literal interpolations (${...} →
 * ":PARAM"), trailing /:PARAM segments (so `/api/users/${id}` matches
 * `/api/users/:id` or just `/api/users`), and trailing slashes.
 */
function normalizeFrontendUrl(url) {
  let u = url.split("?")[0];
  u = u.replace(/\$\{[^}]*\}/g, ":PARAM");
  return u;
}

// ─────────────────────────────────────────────────────────────────────
// DIFF
// ─────────────────────────────────────────────────────────────────────

/**
 * Diff a single expectation against a list of known contracts. Returns
 * an array of mismatch records — one per field-level disagreement — or
 * the empty array when the expectation matches cleanly.
 *
 * Matching:
 *   - Method must equal
 *   - Endpoint must match by EXACT path OR by :PARAM-normalized path
 *   - If no contract matches endpoint+method, returns [] (the
 *     integration validator catches cross-branch route mismatches —
 *     phase 2 only catches FIELD mismatches on matched routes)
 *
 * Field diff:
 *   - expectation.response.shape has key X, contract.response.shape does NOT
 *     → mismatch {kind: "response-missing-key", key: X}
 *   - contract.response.shape is empty (variable inferred) → skip, can't diff
 *   - expectation.request.body has key X, contract.request.body does NOT
 *     → mismatch {kind: "request-extra-key", key: X}
 *   - contract.request.body has required key X, expectation doesn't send it
 *     → mismatch {kind: "request-missing-key", key: X}  (may produce false
 *       positives when backend treats body as optional; marked "soft")
 */
export function diffContracts({ contracts, expectation }) {
  if (!Array.isArray(contracts) || contracts.length === 0) return [];
  if (!expectation) return [];

  const matches = contracts.filter((c) => routesMatch(c, expectation));
  if (matches.length === 0) return [];

  const contract = matches[0];
  const mismatches = [];

  // Response shape diff (only when contract has a known literal shape)
  if (contract.response?.inferred === "literal" && Array.isArray(contract.response.shape)) {
    const contractKeys = new Set(contract.response.shape);
    const expectedKeys = expectation.response?.shape || [];
    for (const key of expectedKeys) {
      if (!contractKeys.has(key)) {
        mismatches.push({
          kind: "response-missing-key",
          severity: "error",
          key,
          contractKeys: [...contractKeys],
          contract,
          expectation,
        });
      }
    }
  }

  // Request body diff
  const reqContract = new Set(contract.request?.body || []);
  const reqExpected = new Set(expectation.request?.body || []);

  // Keys the frontend SENDS that the backend doesn't read — warning only
  for (const key of reqExpected) {
    if (reqContract.size > 0 && !reqContract.has(key)) {
      mismatches.push({
        kind: "request-extra-key",
        severity: "warning",
        key,
        contractKeys: [...reqContract],
        contract,
        expectation,
      });
    }
  }

  // Keys the backend REQUIRES that the frontend doesn't send — error
  // (but marked soft because backend may treat some as optional)
  for (const key of reqContract) {
    if (reqExpected.size > 0 && !reqExpected.has(key)) {
      mismatches.push({
        kind: "request-missing-key",
        severity: "soft",
        key,
        contractKeys: [...reqContract],
        contract,
        expectation,
      });
    }
  }

  return mismatches;
}

function routesMatch(contract, expectation) {
  if (contract.method !== expectation.method) return false;
  if (contract.endpoint === expectation.endpoint) return true;
  // Allow :PARAM wildcards to match any segment
  const cParts = contract.endpoint.split("/");
  const eParts = expectation.endpoint.split("/");
  if (cParts.length !== eParts.length) return false;
  for (let i = 0; i < cParts.length; i++) {
    if (cParts[i] === eParts[i]) continue;
    if (cParts[i].startsWith(":") || eParts[i] === ":PARAM") continue;
    return false;
  }
  return true;
}
