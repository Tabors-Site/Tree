// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// cookies.js — own cookie parser (replaces the `cookie-parser` dependency).
//
// Parses the request `Cookie` header into `req.cookies` ({ name: value }), URL-decoding values.
// This is the whole surface the codebase uses (req.cookies?.token); cookie-parser's signed-cookie
// + secret features are not used here, so they are not reimplemented. Framework-agnostic
// (req,res,next) middleware: works in the express app today and the own http app after.

function parseCookieHeader(header) {
  const out = {};
  if (typeof header !== "string" || header.length === 0) return out;
  for (const pair of header.split(";")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    if (!name || Object.prototype.hasOwnProperty.call(out, name)) continue;
    let value = pair.slice(eq + 1).trim();
    // Strip optional surrounding quotes (RFC 6265 quoted-string form).
    if (value.length >= 2 && value[0] === '"' && value[value.length - 1] === '"') {
      value = value.slice(1, -1);
    }
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      out[name] = value; // malformed %-escape: keep raw, never throw on a header
    }
  }
  return out;
}

// cookieParser() → middleware. Mirrors cookie-parser's call shape (a factory returning the
// middleware) so the call site reads identically.
export default function cookieParser() {
  return function cookies(req, _res, next) {
    if (!req.cookies) req.cookies = parseCookieHeader(req.headers?.cookie);
    next();
  };
}

export { parseCookieHeader };
