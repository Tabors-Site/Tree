/**
 * Perspective filter for code-workspace cascade events.
 *
 * Decides whether a file write is "contract-affecting" — i.e., whether it
 * introduces or changes something that other branches need to know about
 * to stay consistent. API routes, exported symbols, data schemas, manifest
 * declarations. CSS tweaks and prose changes are noise.
 *
 * Signals extracted become the "contracts" rolled up into aggregatedDetail
 * and the "payload" on lateral signalInbox entries. Short, stable,
 * grep-able strings the next session can see in enrichContext.
 *
 * v1 is pure rule-based. No LLM calls. Fast enough to run on every file
 * write. Can be replaced with an LLM-based classifier later (look at the
 * content, judge whether it's a contract change) without touching callers.
 */

const CONTRACT_FILENAMES = [
  /^routes?(?:\.[jt]sx?)?$/i,
  /^server(?:\.[jt]sx?)?$/i,
  /^app(?:\.[jt]sx?)?$/i,
  /^api(?:\.[jt]sx?)?$/i,
  /^manifest\.[jt]sx?$/i,
  /^index\.[jt]sx?$/i,
  /^CONTRACTS?(?:\.md)?$/i,
  /^schema(?:\.[jt]sx?|\.sql|\.prisma|\.graphql)?$/i,
  /^types?(?:\.[jt]sx?|\.d\.ts)?$/i,
  /^models?(?:\.[jt]sx?)?$/i,
  /^endpoints?(?:\.[jt]sx?)?$/i,
  /^openapi(?:\.ya?ml|\.json)?$/i,
  /package\.json$/i,
];

const EXPRESS_ROUTE_RE = /\b(?:app|router)\.(get|post|put|delete|patch|options|head|all)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
const EXPORT_RE = /^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/gm;
const MODULE_EXPORTS_RE = /\bmodule\.exports(?:\.(\w+))?\s*=/g;
const TYPE_DECLARE_RE = /^\s*(?:export\s+)?(?:interface|type|enum)\s+(\w+)/gm;
const CLASS_RE = /^\s*(?:export\s+)?class\s+(\w+)/gm;
// Plain fetch('/path') — bare string literal first arg
const FETCH_URL_RE = /fetch\s*\(\s*['"`](\/[^'"`]+)['"`]/g;
// Concat form: fetch(VAR + '/path') — common when a frontend has a base URL
const FETCH_CONCAT_RE = /fetch\s*\(\s*\w+\s*\+\s*['"`](\/[^'"`]+)['"`]/g;
// Template literal form: fetch(`${base}/path`) — frontend with template strings
const FETCH_TEMPLATE_RE = /fetch\s*\(\s*`\$\{[^}]+\}(\/[^`]+)`/g;
// API base constant — `/api`, `/api/...`, or `http(s)://...`
const API_CONST_RE = /\b(?:const|let|var)\s+([A-Z_][A-Z0-9_]*(?:_URL|_BASE|_API|_PATH|_HOST)?)\s*=\s*['"`](\/api[^'"`]*|\/[a-z][^'"`]*|https?:\/\/[^'"`]+)['"`]/g;

const SHORT_PATH = (p) => String(p).split("/").pop() || String(p);

/**
 * Return { isContract, signals } where signals is a de-duplicated list of
 * short human-readable strings describing what this write introduces.
 *
 *   isContract: true/false — whether siblings should be alerted
 *   signals:    [ "POST /api/login", "export function loginHandler", ... ]
 *
 * Empty signals + isContract=false = pure noise, don't propagate.
 */
export function classifyWrite({ filePath, content }) {
  const signals = new Set();
  const baseName = SHORT_PATH(filePath || "");

  // Filename-based contract detection
  const isContractFilename = CONTRACT_FILENAMES.some((re) => re.test(baseName));

  if (!content || typeof content !== "string") {
    return {
      isContract: isContractFilename,
      signals: isContractFilename ? [`${filePath} touched`] : [],
    };
  }

  // Content-based signal extraction
  let m;

  // Express/router routes
  EXPRESS_ROUTE_RE.lastIndex = 0;
  while ((m = EXPRESS_ROUTE_RE.exec(content)) !== null) {
    const method = m[1].toUpperCase();
    const route = m[2];
    signals.add(`${method} ${route}`);
  }

  // ES module exports (function, class, const, type, interface, enum)
  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(content)) !== null) {
    signals.add(`export ${m[1]} (in ${baseName})`);
  }

  // CommonJS module.exports
  MODULE_EXPORTS_RE.lastIndex = 0;
  while ((m = MODULE_EXPORTS_RE.exec(content)) !== null) {
    if (m[1]) {
      signals.add(`module.exports.${m[1]} (in ${baseName})`);
    } else {
      signals.add(`module.exports (in ${baseName})`);
    }
  }

  // Type / interface / enum declarations
  TYPE_DECLARE_RE.lastIndex = 0;
  while ((m = TYPE_DECLARE_RE.exec(content)) !== null) {
    signals.add(`type ${m[1]}`);
  }

  // Class declarations (redundant with export RE but catches non-exported)
  CLASS_RE.lastIndex = 0;
  while ((m = CLASS_RE.exec(content)) !== null) {
    signals.add(`class ${m[1]}`);
  }

  // fetch() calls — useful for frontend telling backend "I hit this URL"
  // so a mismatch can be caught (backend cascades its routes, frontend
  // cascades its fetches, a diff is obvious on the project root).
  // Three forms: bare string, concat with var, template literal.
  for (const re of [FETCH_URL_RE, FETCH_CONCAT_RE, FETCH_TEMPLATE_RE]) {
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      signals.add(`fetch ${m[1]}`);
    }
  }

  // API URL constants (VAR = "/api/...")
  API_CONST_RE.lastIndex = 0;
  while ((m = API_CONST_RE.exec(content)) !== null) {
    signals.add(`const ${m[1]} = ${m[2]}`);
  }

  // package.json contract signals
  if (/package\.json$/i.test(baseName)) {
    try {
      const pkg = JSON.parse(content);
      if (pkg.main) signals.add(`package.main=${pkg.main}`);
      if (pkg.scripts?.start) signals.add(`scripts.start=${pkg.scripts.start}`);
      if (pkg.dependencies) {
        const deps = Object.keys(pkg.dependencies).slice(0, 8).join(", ");
        if (deps) signals.add(`deps: ${deps}`);
      }
    } catch {}
  }

  const signalList = Array.from(signals).slice(0, 25);
  // Contract if the filename matches OR we extracted at least one signal
  // from content. Pure CSS / markdown / text with no extractable symbol
  // → treated as noise (isContract=false, signals=[]).
  return {
    isContract: isContractFilename || signalList.length > 0,
    signals: signalList,
  };
}
