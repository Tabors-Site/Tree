// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// rateLimit.js — own fixed-window rate limiter (replaces the `express-rate-limit` dependency).
//
// Reproduces the subset the codebase uses: `rateLimit({ windowMs, max, handler, standardHeaders?,
// legacyHeaders? })` → a (req,res,next) middleware that counts requests per client key (req.ip) in a
// fixed window and, once `max` is exceeded, calls the custom `handler(req,res)` instead of next().
// A per-limiter Map holds { count, resetAt }; a lazy sweep on access drops expired keys (no timers,
// so it can't keep the process alive or leak under churn). Framework-agnostic: works in the express
// app today and the own http app after (which sets req.ip from the trust-proxy-aware client address).
//
// Fixed-window (the express-rate-limit default MemoryStore is also fixed-window) — simple and
// sufficient for the abuse-throttle use here (register / login / api floods). The `standardHeaders` /
// `legacyHeaders` flags are accepted for call-site parity; when standardHeaders is on we emit the
// RateLimit-* draft headers, matching what the API limiter advertised.

export default function rateLimit(options = {}) {
  const {
    windowMs = 60 * 1000,
    max = 60,
    handler = null,
    standardHeaders = false,
    keyGenerator = (req) => req.ip || req.socket?.remoteAddress || "unknown",
  } = options;

  const hits = new Map(); // key -> { count, resetAt }

  function defaultHandler(_req, res) {
    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "RATE_LIMITED", message: "Too many requests." }));
  }

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = keyGenerator(req);

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    // Opportunistic sweep so the Map doesn't grow without bound under IP churn (no timers).
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }

    const remaining = Math.max(0, max - entry.count);
    if (standardHeaders) {
      res.setHeader("RateLimit-Limit", String(max));
      res.setHeader("RateLimit-Remaining", String(remaining));
      res.setHeader("RateLimit-Reset", String(Math.ceil((entry.resetAt - now) / 1000)));
    }

    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      return (handler || defaultHandler)(req, res);
    }
    next();
  };
}
