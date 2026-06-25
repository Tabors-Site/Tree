// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// cors.js — own CORS middleware (replaces the `cors` dependency).
//
// Reproduces the subset the codebase uses, faithful to `cors`'s VALUE-based origin contract:
//   - origin: "*"            → emit a literal `Access-Control-Allow-Origin: *` (public; no Vary, and
//                              credentials cannot ride a `*`). The bootstrap well-known route uses this.
//   - origin: true           → reflect the request Origin + `Vary: Origin`.
//   - origin: "<str>"|[..]   → allow that exact origin / allow-list; reflect it when it matches.
//   - origin: (origin, cb)   → dynamic; cb(null, true) reflects, cb(null, false) denies, cb(null,
//                              "<str>") sets that origin. begin.js's corsOriginCheck uses true/false.
// Plus: credentials, an allowed-methods + allowed-headers preflight (reflecting the request's
// Access-Control-Request-Headers when none configured), Max-Age, and the OPTIONS short-circuit (204).
// Framework-agnostic (req,res,next): works in the express app today and the own http app after.

// Append a token to the Vary header instead of clobbering an existing one (cache-correctness).
function appendVary(res, field) {
  const cur = res.getHeader("Vary");
  if (!cur) return res.setHeader("Vary", field);
  const list = String(cur)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.includes("*") || list.some((v) => v.toLowerCase() === field.toLowerCase())) return;
  res.setHeader("Vary", [...list, field].join(", "));
}

export default function cors(options = {}) {
  const {
    origin = true, // "*" | true | string | string[] | (origin, cb) => cb(err, allowed)
    methods = ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
    allowedHeaders = null, // null = reflect the request's Access-Control-Request-Headers
    credentials = false,
    maxAge = null,
    optionsSuccessStatus = 204,
  } = options;
  const methodList = Array.isArray(methods) ? methods.join(",") : String(methods);

  // Resolve this request's Origin to the VALUE to emit → callback(err, value):
  //   false      → deny (no CORS headers)
  //   "*"        → literal star
  //   true       → reflect the request Origin
  //   "<string>" → that exact origin
  function resolveOrigin(reqOrigin, cb) {
    if (origin === "*") return cb(null, "*");
    if (origin === true) return cb(null, true);
    if (typeof origin === "function") return origin(reqOrigin, cb);
    if (typeof origin === "string") return cb(null, origin === reqOrigin ? reqOrigin : false);
    if (Array.isArray(origin)) return cb(null, origin.includes(reqOrigin) ? reqOrigin : false);
    return cb(null, false);
  }

  return function corsMiddleware(req, res, next) {
    const reqOrigin = req.headers?.origin;
    resolveOrigin(reqOrigin, (err, value) => {
      if (err) return next(err);
      const allowed = value !== false && value != null;
      if (allowed) {
        if (value === "*") {
          res.setHeader("Access-Control-Allow-Origin", "*");
        } else {
          // Reflect (value === true) or a specific string. Reflecting varies by Origin → Vary.
          const acao = value === true ? reqOrigin || "*" : value;
          res.setHeader("Access-Control-Allow-Origin", acao);
          if (reqOrigin) appendVary(res, "Origin");
        }
        // Credentials cannot accompany a literal `*` (browsers reject it); honor the flag otherwise.
        if (credentials && value !== "*") res.setHeader("Access-Control-Allow-Credentials", "true");
      }
      if (req.method === "OPTIONS") {
        // Preflight: a denied preflight still returns 204 with no CORS headers (matches `cors`).
        if (allowed) {
          res.setHeader("Access-Control-Allow-Methods", methodList);
          const reqHeaders = req.headers?.["access-control-request-headers"];
          const hdrs = allowedHeaders
            ? Array.isArray(allowedHeaders)
              ? allowedHeaders.join(",")
              : allowedHeaders
            : reqHeaders;
          if (hdrs) res.setHeader("Access-Control-Allow-Headers", hdrs);
          if (maxAge != null) res.setHeader("Access-Control-Max-Age", String(maxAge));
        }
        res.setHeader("Content-Length", "0");
        res.statusCode = optionsSuccessStatus;
        return res.end();
      }
      next();
    });
  };
}
