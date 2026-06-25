// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// app.js — a minimal, express-compatible HTTP app + Router, over node:http (replaces the `express`
// dependency). WS bootstraps off the same http server; this is just the request-router half express
// gave us. It reproduces the EXACT surface the codebase uses, no more:
//
//   createApp()                 → a request handler (req,res) for http.createServer, carrying
//                                 .use/.get/.post/.put/.delete/.options/.all/.param/.set/.disable
//   Router()                    → a sub-app with the same verbs (mounted via app.use(path, router))
//   express.static(dir, opts)   → serve files (content-type by ext, {fallthrough, index})
//   json/urlencoded/raw(opts)   → body parsers that set req.body (+ req.rawBody for raw)
//
//   path syntax (express 5 / path-to-regexp v8 subset): exact, ":name" (one segment → req.params.name,
//   URL-decoded), "*name" (the rest → req.params.name as a DECODED ARRAY of segments), and a RegExp
//   path (matched directly, no named params). app.use(path, ...) matches by PREFIX and strips it for
//   the sub-router; app.METHOD(path, ...) matches the whole path.
//
//   req: method, url, path, query (parsed object), params, body, rawBody, cookies (set by the cookie
//        middleware), headers, get(name), ip (trust-proxy-aware), originalUrl.
//   res: status(), json(), send(), set()/header(), get/getHeader, sendStatus(), redirect(),
//        sendFile(), plus native end()/on("finish")/statusCode.
//
// Middleware contract is express's: (req,res,next); a 4-arg (err,req,res,next) layer is an error
// handler; next(err) routes to the next error handler (or a 500). Routers mounted with a path run
// against the stripped tail and restore req.url after.

import { createReadStream, existsSync, statSync } from "node:fs";
import { join, extname, resolve, normalize, sep } from "node:path";

// ── path compile / match ──────────────────────────────────────────────────────────────────────
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function decodeSafe(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Compile a string path (or RegExp) to { regex, keys }. `end` true = whole-path (a route); false =
// prefix (a mount / app.use(path)). Segments: ":name" → one segment; "*name" → the rest (splat).
function compilePath(path, end) {
  if (path instanceof RegExp) return { regex: path, keys: [], isRegex: true };
  const keys = [];
  let re = "";
  const segs = String(path).split("/");
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg === "") continue;
    if (seg[0] === ":") {
      keys.push({ name: seg.slice(1), splat: false });
      re += "/([^/]+?)";
    } else if (seg[0] === "*") {
      keys.push({ name: seg.slice(1) || "splat", splat: true });
      re += "(?:/(.*))?";
      break; // splat consumes the rest
    } else {
      re += "/" + escapeRegex(seg);
    }
  }
  if (end) {
    // A route: match the whole path (optional trailing slash). Root "/" → "^/?$".
    return { regex: new RegExp("^" + (re || "/") + "/?$"), keys, isRegex: false };
  }
  // A mount / app.use(path): match by PREFIX. The root prefix ("/" or "") matches EVERYTHING and
  // consumes nothing (matched=""), so a global app.use(mw) and an app.use("/", router) run for every
  // request; a real prefix like "/api/v1" matches at a path boundary and is stripped for the sub-router.
  const regex = re === "" ? /^/ : new RegExp("^" + re + "(?=/|$)");
  return { regex, keys, isRegex: false };
}

// Match a compiled path against a pathname → { params, matched } or null. `matched` is the consumed
// prefix (for mount stripping). Splat params decode to an array of segments.
function matchPath(compiled, pathname) {
  const m = compiled.regex.exec(pathname);
  if (!m) return null;
  const params = {};
  if (!compiled.isRegex) {
    compiled.keys.forEach((k, i) => {
      const raw = m[i + 1];
      if (k.splat) {
        params[k.name] = raw == null || raw === "" ? [] : raw.split("/").map(decodeSafe);
      } else if (raw != null) {
        params[k.name] = decodeSafe(raw);
      }
    });
  }
  return { params, matched: m[0] };
}

// ── Router ────────────────────────────────────────────────────────────────────────────────────
function createRouter() {
  const stack = []; // { method|null, compiled, handlers[], mount:boolean }
  const paramHandlers = Object.create(null); // name → fn(req,res,next,val)

  function route(method, path, handlers) {
    stack.push({ method, compiled: compilePath(path, true), handlers: handlers.flat().filter(Boolean), mount: false });
  }

  const router = {
    use(...args) {
      let path = "/";
      if (typeof args[0] === "string" || args[0] instanceof RegExp) path = args.shift();
      const handlers = args.flat().filter(Boolean);
      for (const h of handlers) {
        // A handler that is itself a router (an object/function carrying .handle) is a MOUNT; strip
        // the prefix when running it. A plain middleware function has no .handle and runs in place.
        const isRouter = !!(h && typeof h.handle === "function");
        stack.push({ method: null, compiled: compilePath(path, false), handlers: [h], mount: isRouter, mountPath: path });
      }
      return router;
    },
    param(name, fn) {
      paramHandlers[name] = fn;
      return router;
    },
    handle(req, res, out) {
      let idx = 0;
      // Path the router matches against (relative to where it's mounted; app sets req.path).
      const basePath = req.path || "/";
      const ranParams = req._ranParams || (req._ranParams = new Set());

      const next = (err) => {
        if (idx >= stack.length) return out(err);
        const layer = stack[idx++];
        const wantsErr = layer.handlers[0] && layer.handlers[0].length === 4;
        // Error mode: only 4-arg handlers run; normal mode: skip 4-arg handlers.
        if (err && !wantsErr) return next(err);
        if (!err && wantsErr) return next();

        const matched = matchPath(layer.compiled, basePath);
        if (!matched) return next(err);
        if (layer.method && layer.method !== req.method) {
          // HEAD falls through to GET handlers (express does this); otherwise skip.
          if (!(layer.method === "GET" && req.method === "HEAD")) return next(err);
        }

        // Merge params from this match.
        Object.assign(req.params, matched.params);

        const runHandlers = () => {
          if (layer.mount) {
            // Mounted sub-router: strip the matched prefix, run it, restore on return.
            const h = layer.handlers[0];
            const savedPath = req.path;
            const stripped = basePath.slice(matched.matched.length) || "/";
            req.path = stripped[0] === "/" ? stripped : "/" + stripped;
            return h.handle(req, res, (e) => {
              req.path = savedPath;
              next(e);
            });
          }
          // Normal middleware/handler chain for this layer.
          let hi = 0;
          const nextHandler = (e) => {
            if (e) return next(e);
            if (hi >= layer.handlers.length) return next();
            const fn = layer.handlers[hi++];
            try {
              const r = fn(req, res, nextHandler);
              if (r && typeof r.then === "function") r.catch(nextHandler);
            } catch (ex) {
              next(ex);
            }
          };
          nextHandler();
        };

        // Run any param handlers for newly-seen params before the route handlers (express semantics).
        const paramNames = layer.compiled.keys ? layer.compiled.keys.map((k) => k.name) : [];
        const pending = paramNames.filter(
          (n) => paramHandlers[n] && req.params[n] !== undefined && !ranParams.has(n),
        );
        if (pending.length === 0) return runHandlers();
        let pi = 0;
        const nextParam = (e) => {
          if (e) return next(e);
          if (pi >= pending.length) return runHandlers();
          const name = pending[pi++];
          ranParams.add(name);
          try {
            paramHandlers[name](req, res, nextParam, req.params[name]);
          } catch (ex) {
            next(ex);
          }
        };
        nextParam();
      };
      next();
    },
  };

  for (const m of ["get", "post", "put", "delete", "patch", "options", "head"]) {
    router[m] = (path, ...handlers) => {
      route(m.toUpperCase(), path, handlers);
      return router;
    };
  }
  router.all = (path, ...handlers) => {
    stack.push({ method: null, compiled: compilePath(path, true), handlers: handlers.flat().filter(Boolean), mount: false });
    return router;
  };
  return router;
}

// ── App ───────────────────────────────────────────────────────────────────────────────────────
export function createApp() {
  const router = createRouter();
  const settings = Object.create(null);

  const app = function (req, res) {
    augmentReq(req, app);
    augmentRes(req, res);
    router.handle(req, res, (err) => {
      if (res.headersSent) return;
      if (err) {
        res.statusCode = err.status || err.statusCode || 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(res.statusCode >= 500 ? "Internal Server Error" : String(err.message || err));
      } else {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Not Found");
      }
    });
  };

  // Delegate the router surface onto the app.
  for (const m of ["use", "get", "post", "put", "delete", "patch", "options", "head", "all", "param"]) {
    app[m] = (...args) => {
      router[m](...args);
      return app;
    };
  }
  app.set = (k, v) => {
    settings[k] = v;
    return app;
  };
  app.disable = (k) => {
    settings[k] = false;
    return app;
  };
  app.get = (...args) => {
    // express overloads app.get: one arg (a setting read) vs (path, ...handlers).
    if (args.length === 1 && typeof args[0] === "string") return settings[args[0]];
    router.get(...args);
    return app;
  };
  app._settings = settings;
  app.handle = router.handle; // so an app can be mounted like a router if ever needed
  return app;
}

// ── req / res augmentation ──────────────────────────────────────────────────────────────────────
function augmentReq(req, app) {
  const host = req.headers.host || "localhost";
  let url;
  try {
    url = new URL(req.url, `http://${host}`);
  } catch {
    url = new URL("/", `http://${host}`);
  }
  req.path = url.pathname;
  req.originalUrl = req.originalUrl || req.url;
  req.query = Object.fromEntries(url.searchParams.entries());
  req.params = {};
  req.get = (name) => {
    const v = req.headers[String(name).toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  // Trust-proxy-aware client ip (the rate limiter keys on it). `trust proxy` depth n: take the n-th
  // from the right of X-Forwarded-For, else the socket address.
  const trust = app?._settings?.["trust proxy"];
  const xff = req.headers["x-forwarded-for"];
  if (trust && typeof xff === "string" && xff.length) {
    const list = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const depth = typeof trust === "number" ? trust : 1;
    req.ip = list[Math.max(0, list.length - depth)] || req.socket?.remoteAddress;
  } else {
    req.ip = req.socket?.remoteAddress;
  }
}

const STATUS_TEXT = { 200: "OK", 204: "No Content", 301: "Moved Permanently", 302: "Found", 304: "Not Modified", 400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 429: "Too Many Requests", 500: "Internal Server Error" };

function augmentRes(req, res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.set = res.header = (field, value) => {
    if (field && typeof field === "object") {
      for (const [k, v] of Object.entries(field)) res.setHeader(k, v);
    } else {
      res.setHeader(field, value);
    }
    return res;
  };
  res.get = (field) => res.getHeader(field);
  res.json = (obj) => {
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(obj));
    return res;
  };
  res.send = (body) => {
    if (body == null) return res.end();
    if (Buffer.isBuffer(body)) {
      if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/octet-stream");
      return res.end(body);
    }
    if (typeof body === "object") return res.json(body);
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(String(body));
    return res;
  };
  res.sendStatus = (code) => {
    res.statusCode = code;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(STATUS_TEXT[code] || String(code));
    return res;
  };
  res.redirect = (a, b) => {
    const status = typeof a === "number" ? a : 302;
    const loc = typeof a === "number" ? b : a;
    res.statusCode = status;
    res.setHeader("Location", loc);
    res.end();
    return res;
  };
  res.sendFile = (filePath) => sendFile(res, filePath);
}

// ── static + sendFile ────────────────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
  ".ttf": "font/ttf", ".map": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  ".pdf": "application/pdf", ".mp4": "video/mp4", ".webm": "video/webm",
};
function contentTypeFor(p) {
  return MIME[extname(p).toLowerCase()] || "application/octet-stream";
}
function sendFile(res, filePath) {
  try {
    const st = statSync(filePath);
    if (!st.isFile()) {
      res.statusCode = 404;
      return res.end("Not Found");
    }
    if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", contentTypeFor(filePath));
    res.setHeader("Content-Length", String(st.size));
    createReadStream(filePath).pipe(res);
  } catch {
    res.statusCode = 404;
    res.end("Not Found");
  }
}

export function staticMw(dir, opts = {}) {
  const root = resolve(dir);
  const { fallthrough = true, index = "index.html" } = opts;
  return function serveStatic(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return fallthrough ? next() : res.sendStatus(405);
    // Resolve safely under root (no path traversal). Decode once, strip NULs, reject any "../" segment
    // outright (defense in depth), then normalize + join and require the result to be root itself or a
    // path strictly INSIDE root (root + separator) — `startsWith(root)` alone would let a sibling like
    // "<root>-evil" through, so the separator boundary is the real containment check.
    const rel = decodeSafe(req.path).replace(/\0/g, "");
    if (rel.split(/[\\/]/).includes("..")) return fallthrough ? next() : res.sendStatus(403);
    let target = normalize(join(root, rel));
    if (target !== root && !target.startsWith(root + sep)) {
      return fallthrough ? next() : res.sendStatus(403);
    }
    let st;
    try {
      st = statSync(target);
    } catch {
      return fallthrough ? next() : res.sendStatus(404);
    }
    if (st.isDirectory()) {
      if (!index) return fallthrough ? next() : res.sendStatus(404);
      target = join(target, index);
      if (!existsSync(target)) return fallthrough ? next() : res.sendStatus(404);
    }
    sendFile(res, target);
  };
}

// ── body parsers ───────────────────────────────────────────────────────────────────────────────
function parseLimit(limit) {
  if (typeof limit === "number") return limit;
  if (typeof limit !== "string") return 1024 * 1024;
  const m = limit.trim().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i);
  if (!m) return 1024 * 1024;
  const n = parseFloat(m[1]);
  const unit = (m[2] || "b").toLowerCase();
  return Math.floor(n * ({ b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 }[unit]));
}
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    if (req._bodyRead) return resolve(req.rawBody || Buffer.alloc(0));
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error("request entity too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      req._bodyRead = true;
      req.rawBody = Buffer.concat(chunks);
      resolve(req.rawBody);
    });
    req.on("error", reject);
  });
}
function typeMatches(req, type) {
  const ct = (req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!type || type === "*/*") return true;
  const t = String(type).toLowerCase();
  if (t.endsWith("/*")) return ct.startsWith(t.slice(0, -1));
  return ct === t;
}

export function jsonParser(opts = {}) {
  const max = parseLimit(opts.limit);
  return function json(req, res, next) {
    if (req.method === "GET" || req.method === "HEAD" || req.body !== undefined) return next();
    if (!typeMatches(req, "application/json")) return next();
    readBody(req, max).then((buf) => {
      if (buf.length === 0) { req.body = {}; return next(); }
      try {
        req.body = JSON.parse(buf.toString("utf8"));
        next();
      } catch (e) {
        e.status = 400;
        next(e);
      }
    }, next);
  };
}

export function urlencodedParser(opts = {}) {
  const max = parseLimit(opts.limit);
  return function urlencoded(req, res, next) {
    if (req.method === "GET" || req.method === "HEAD" || req.body !== undefined) return next();
    if (!typeMatches(req, "application/x-www-form-urlencoded")) return next();
    readBody(req, max).then((buf) => {
      req.body = Object.fromEntries(new URLSearchParams(buf.toString("utf8")).entries());
      next();
    }, next);
  };
}

export function rawParser(opts = {}) {
  const max = parseLimit(opts.limit);
  const type = opts.type || "application/octet-stream";
  return function raw(req, res, next) {
    if (req.method === "GET" || req.method === "HEAD") return next();
    if (!typeMatches(req, type)) return next();
    readBody(req, max).then((buf) => {
      req.body = buf; // express.raw sets req.body to the Buffer
      next();
    }, next);
  };
}

// The express() default export shape: a callable that also carries Router + the static/json/etc.
// factories, so call sites read `express.Router()` / `express.static(...)` / `express.json(...)`.
const express = Object.assign(createApp, {
  Router: createRouter,
  static: staticMw,
  json: jsonParser,
  urlencoded: urlencodedParser,
  raw: rawParser,
});

export { createRouter as Router };
export default express;
