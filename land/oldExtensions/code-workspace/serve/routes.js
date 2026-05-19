/**
 * code-workspace serve routes.
 *
 * Mounted on the main land router at /api/v1/*. Reachable through the
 * same HTTPS front-end the rest of the API uses, so we don't need to
 * expose a second port.
 *
 *   POST /api/v1/workspace/:nodeId/serve         start preview
 *   POST /api/v1/workspace/:nodeId/stop          stop preview
 *   GET  /api/v1/workspace/:nodeId/serve-status  running state + log tail
 *   GET  /api/v1/workspace/previews              list every running preview
 *
 *   GET  /api/v1/preview/:slug[/*]               serve static file or
 *                                                proxy to child process
 *
 * Preview request handling:
 *
 *   - static kind:  stream file off disk with SPA fallback to index.html
 *   - server kind:  open a plain http.request to 127.0.0.1:<child port>
 *                   and pipe the response back
 *
 * Absolute paths in served apps (e.g. `fetch('/api/profiles')`) will NOT
 * resolve correctly because the browser hits treeos.ai/api/profiles, not
 * the preview. To work around that, HTML responses get an auto-injected
 * `<base href="/api/v1/preview/<slug>/">` tag so RELATIVE paths work.
 * Apps with hard absolute paths need to either use relative URLs or be
 * served from a subdomain (tiner.treeos.ai → 127.0.0.1:<port>) which is
 * an infrastructure config.
 */

import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import log from "../../../seed/log.js";
import authenticate from "../../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../../seed/protocol.js";
import { loadProjectNode, workspacePathFor } from "./projectLookup.js";
import { startPreview, stopPreview } from "./spawner.js";
import { getEntry, getEntryByNodeId, slugify, allEntries } from "./registry.js";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/**
 * Inject a <base href> tag AND a client-side request shim into HTML so
 * the previewed app "just works" without the user rewriting every URL.
 *
 * The base tag handles relative paths like `./styles.css` → resolves
 * against the preview subpath.
 *
 * The shim handles ABSOLUTE paths like `fetch('/api/auth/signup')` — those
 * ignore the base tag entirely and would hit `https://treeos.ai/api/auth/signup`
 * (which is nothing), returning 405. The shim monkey-patches `fetch()` and
 * `XMLHttpRequest.open()` to rewrite any absolute URL whose path starts
 * with `/` (but isn't already `/api/v1/preview/...`) to prepend the preview
 * base. So `fetch('/api/auth/signup')` silently becomes
 * `fetch('/api/v1/preview/tinder-xxx/api/auth/signup')`, which nginx routes
 * to the preview proxy → child process → app's own /api/auth/signup route.
 *
 * This is a pragmatic band-aid. The architecturally clean answer is
 * subdomain routing (`tinder.treeos.ai` → child) where absolute paths
 * resolve naturally, but that needs wildcard DNS + SSL setup. The shim
 * solves it today with zero infra.
 */
/**
 * Rewrite absolute src/href/action attributes like `src="/app.js"` to
 * the preview-scoped path `src="/api/v1/preview/<slug>/app.js"`. This
 * runs at HTML-injection time (before the browser parses the markup)
 * because the shim's runtime patching only covers fetch/XHR/form and
 * CAN'T intercept `<script src>` or `<link href>` — those are resolved
 * by the browser synchronously as the HTML is parsed, before any
 * injected script has a chance to run. Without this rewrite, the
 * browser hits the bare `/app.js` on the land's origin and gets the
 * dashboard HTML, producing "Unexpected token '<'" in the console.
 *
 * We only touch attributes whose value starts with a single "/" (not
 * "//" protocol-relative) AND isn't already under the preview base.
 * Safe against tag names like <a href="/inner">, <link href="/x.css">,
 * <script src="/x.js">, <img src="/y.png">, <form action="/z">.
 */
function rewriteAbsoluteAttrs(html, baseHref) {
  const stripBase = baseHref.replace(/\/+$/, "");
  return html.replace(
    /(\s(?:src|href|action)\s*=\s*)(['"])(\/[^'"\s]*)\2/gi,
    (match, pre, quote, path) => {
      if (path.startsWith("//")) return match;
      if (path.startsWith(stripBase + "/")) return match;
      if (path === stripBase) return match;
      return `${pre}${quote}${stripBase}${path}${quote}`;
    },
  );
}

function injectBaseTag(html, baseHref) {
  // Rewrite absolute attribute paths BEFORE the base tag is added.
  // The base tag still helps for any relative paths in the document
  // body; the rewrite handles the absolute cases the base can't.
  html = rewriteAbsoluteAttrs(html, baseHref);
  const tag = `<base href="${baseHref}">`;
  // JSON-escape the base so quoting in the script is safe
  const baseJson = JSON.stringify(baseHref.replace(/\/+$/, "") + "/");
  const shim = `
<script>
(function () {
  var BASE = ${baseJson};
  // Strip any trailing slash on BASE except the one we explicitly add
  var stripBase = BASE.replace(/\\/+$/, "");

  function needsRewrite(url) {
    if (typeof url !== "string") return false;
    if (!url.startsWith("/")) return false;       // relative or absolute-url, leave alone
    if (url.startsWith("//")) return false;       // protocol-relative
    if (url.startsWith(stripBase + "/")) return false; // already prefixed
    if (url === stripBase) return false;
    return true;
  }

  function rewrite(url) {
    if (!needsRewrite(url)) return url;
    return stripBase + url;
  }

  // Patch fetch()
  var origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      try {
        if (typeof input === "string") {
          input = rewrite(input);
        } else if (input && typeof input === "object" && "url" in input) {
          // Request object — can't mutate, rebuild via new Request with rewritten URL
          if (needsRewrite(input.url)) {
            input = new Request(rewrite(input.url), input);
          }
        }
      } catch (e) {}
      return origFetch.call(this, input, init);
    };
  }

  // Patch XMLHttpRequest.open()
  var origOpen = window.XMLHttpRequest && window.XMLHttpRequest.prototype && window.XMLHttpRequest.prototype.open;
  if (typeof origOpen === "function") {
    window.XMLHttpRequest.prototype.open = function (method, url) {
      try {
        if (typeof url === "string") {
          url = rewrite(url);
          arguments[1] = url;
        }
      } catch (e) {}
      return origOpen.apply(this, arguments);
    };
  }

  // Patch <form> submissions too — forms with action="/something" POST
  // to the wrong place otherwise. Catches the submit event on the
  // capture phase so it runs before the browser's default handler.
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form || form.tagName !== "FORM") return;
    var action = form.getAttribute("action");
    if (!needsRewrite(action)) return;
    form.setAttribute("action", rewrite(action));
  }, true);

  // Patch WebSocket constructor. Previewed apps typically do:
  //   new WebSocket("ws://" + location.host + "/ws/foo")
  // That hits the land's main WS handler, not the preview proxy.
  // The land installs a WebSocket upgrade proxy at
  // /api/v1/preview/<slug>/* — so we need to rewrite the path so the
  // upgrade goes there. Supports both "ws://host/path" and
  // "wss://host/path" shapes; leaves same-origin paths and any URL
  // already under stripBase alone.
  if (typeof WebSocket !== "undefined") {
    var OrigWS = WebSocket;
    function rewriteWsUrl(url) {
      if (typeof url !== "string") return url;
      var m = url.match(/^(wss?:)\\/\\/([^\\/]+)(\\/.*)?$/);
      if (!m) return url;
      var proto = m[1];
      var host = m[2];
      var path = m[3] || "/";
      // Swap the protocol to match the page's scheme. Apps built for
      // local dev often hardcode ws:// even when running behind https;
      // that fails in the browser with a mixed-content error.
      var pageProto = (window.location.protocol === "https:") ? "wss:" : "ws:";
      if (proto !== pageProto) proto = pageProto;
      // Swap the host to the page's origin when the app hardcoded a
      // different one (most often "localhost:<port>"). A remote browser
      // on treeos.ai can't reach the user's own localhost — the connection
      // fails immediately. If the origin already matches the page, leave it.
      var pageHost = window.location.host;
      if (host !== pageHost) host = pageHost;
      // Prepend the preview base to the path unless it's already there.
      if (!path.startsWith(stripBase + "/") && path !== stripBase) {
        path = stripBase + path;
      }
      return proto + "//" + host + path;
    }
    function PatchedWS(url, protocols) {
      try { url = rewriteWsUrl(url); } catch (e) {}
      return protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
    }
    PatchedWS.prototype = OrigWS.prototype;
    PatchedWS.CONNECTING = OrigWS.CONNECTING;
    PatchedWS.OPEN = OrigWS.OPEN;
    PatchedWS.CLOSING = OrigWS.CLOSING;
    PatchedWS.CLOSED = OrigWS.CLOSED;
    window.WebSocket = PatchedWS;
  }
})();
</script>`;
  const headMatch = html.match(/<head[^>]*>/i);
  if (!headMatch) return tag + shim + html;
  const insertAt = headMatch.index + headMatch[0].length;
  return html.slice(0, insertAt) + "\n" + tag + shim + html.slice(insertAt);
}

function serveStatic(entry, rest, res, baseHref) {
  let rel = rest || "/";
  if (rel === "/" || rel === "") rel = "/index.html";
  // Strip a leading /preview/<slug> if still present (defensive)
  const unsafe = path.join(entry.staticDir, rel);
  const resolved = path.resolve(unsafe);
  if (!resolved.startsWith(path.resolve(entry.staticDir))) {
    res.status(403).type("text/plain").send("Path traversal blocked");
    return;
  }
  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback: unknown path → serve index.html so client routers work
      const indexPath = path.join(entry.staticDir, "index.html");
      fs.stat(indexPath, (err2, stat2) => {
        if (err2 || !stat2.isFile()) {
          res.status(404).type("text/plain").send("Not found");
          return;
        }
        streamFile(indexPath, res, baseHref);
      });
      return;
    }
    streamFile(resolved, res, baseHref);
  });
}

function streamFile(file, res, baseHref) {
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";

  if (type.startsWith("text/html") && baseHref) {
    // Read whole file, inject base tag, send. HTML is small enough for a
    // one-shot read and the injection is only needed for HTML.
    fs.readFile(file, "utf8", (err, content) => {
      if (err) {
        res.status(500).type("text/plain").send("Read error");
        return;
      }
      const out = injectBaseTag(content, baseHref);
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      res.end(out);
    });
    return;
  }

  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
}

/**
 * Serve a path out of a server entry's fallbackStaticDir. Used when a
 * server-kind preview returns 404 for a path — in a compound swarm-built
 * project (backend/ + frontend/), the frontend HTML/JS files live under
 * `frontend/` but the backend server doesn't mount static middleware
 * for them. Rather than forcing the user to wire express.static, we
 * serve the frontend files from our side after the backend 404s.
 */
function tryStaticFallback(entry, rest, res, baseHref) {
  if (!entry.fallbackStaticDir) {
    if (!res.headersSent) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Preview upstream returned 404 and no static fallback is configured");
    }
    return;
  }
  let rel = rest || "/";
  if (rel === "/" || rel === "") rel = "/index.html";
  const unsafe = path.join(entry.fallbackStaticDir, rel);
  const resolved = path.resolve(unsafe);
  if (!resolved.startsWith(path.resolve(entry.fallbackStaticDir))) {
    if (!res.headersSent) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("Path traversal blocked");
    }
    return;
  }
  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback: unknown path → index.html
      const indexPath = path.join(entry.fallbackStaticDir, "index.html");
      fs.stat(indexPath, (err2, stat2) => {
        if (err2 || !stat2.isFile()) {
          if (!res.headersSent) {
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end("Not found");
          }
          return;
        }
        streamFile(indexPath, res, baseHref);
      });
      return;
    }
    streamFile(resolved, res, baseHref);
  });
}

function proxyToChild(entry, rest, qs, req, res, baseHref) {
  const upstreamPath = (rest || "/") + (qs || "");
  const headers = { ...req.headers };
  headers.host = `127.0.0.1:${entry.port}`;
  // Strip hop-by-hop headers that break upstream keep-alive
  delete headers.connection;
  delete headers["content-length"]; // upstream will recompute
  // Strip conditional request headers. We rewrite HTML bodies in-flight
  // (injectBaseTag → base tag + absolute-attr rewrite + WS shim), so
  // the upstream's mtime/ETag is LYING about what the wire body will
  // look like. If the browser sends If-None-Match and the child says
  // 304, the client uses its cached copy which has the OLD version of
  // the shim and OLD absolute <script src="/app.js"> — defeating every
  // fix we make on the injection path. Forcing 200 on every request
  // is worth the per-request payload cost because preview HTML is
  // tiny.
  delete headers["if-none-match"];
  delete headers["if-modified-since"];

  const upstreamReq = http.request(
    {
      hostname: "127.0.0.1",
      port: entry.port,
      path: upstreamPath,
      method: req.method,
      headers,
      // Hang detection: a WS-only child server (http.createServer
      // with no request listener) accepts the TCP connection but
      // never responds to HTTP. Without a timeout the proxy waits
      // forever. 8s is long enough to cover legitimate slow routes
      // but short enough to trigger the static fallback before a
      // browser gives up.
      timeout: 8000,
    },
    (upstreamRes) => {
      // Static fallback: if the child server 404'd on a GET and we have
      // an adjacent frontend dir, serve the file from disk. Compound
      // projects (backend + frontend) "just work" without the backend
      // having to mount static middleware.
      if (upstreamRes.statusCode === 404 && req.method === "GET" && entry.fallbackStaticDir) {
        upstreamRes.resume(); // drain the 404 body, we're not forwarding it
        return tryStaticFallback(entry, rest, res, baseHref);
      }

      const upstreamType = upstreamRes.headers["content-type"] || "";
      if (upstreamType.startsWith("text/html") && baseHref) {
        // Buffer HTML responses so we can inject <base href>
        const chunks = [];
        upstreamRes.on("data", (c) => chunks.push(c));
        upstreamRes.on("end", () => {
          const html = Buffer.concat(chunks).toString("utf8");
          const out = injectBaseTag(html, baseHref);
          const outHeaders = { ...upstreamRes.headers };
          delete outHeaders["content-length"];
          delete outHeaders["content-encoding"];
          // The upstream's ETag/Last-Modified reflect the raw on-disk
          // file, not the wire body we just produced. Drop them so the
          // browser doesn't cache a stale validator. Force no-store so
          // every request re-runs the injection pipeline and picks up
          // any shim updates.
          delete outHeaders["etag"];
          delete outHeaders["last-modified"];
          outHeaders["cache-control"] = "no-store";
          res.writeHead(upstreamRes.statusCode || 200, outHeaders);
          res.end(out);
        });
        upstreamRes.on("error", (err) => {
          if (!res.headersSent) {
            res.status(502).type("text/plain").send("Upstream stream error: " + err.message);
          } else {
            res.end();
          }
        });
        return;
      }

      // Non-HTML: pipe straight through
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );

  upstreamReq.on("error", (err) => {
    log.warn("CodeWorkspace", `serve proxy error for ${entry.slug}: ${err.message}`);
    // Child not listening yet or crashed? Fall back to static if present.
    if (entry.fallbackStaticDir && req.method === "GET") {
      return tryStaticFallback(entry, rest, res, baseHref);
    }
    if (!res.headersSent) {
      res.status(502).type("text/plain").send(`Preview upstream error: ${err.message}`);
    }
  });

  // Hang detection. When the child accepts TCP but never writes HTTP
  // response headers (WS-only server, deadlock, handler missing), the
  // socket timeout fires. Abort the upstream request so the error
  // handler above runs — which tries the static fallback for GETs.
  upstreamReq.on("timeout", () => {
    log.warn(
      "CodeWorkspace",
      `serve proxy hung: ${entry.slug} upstream didn't respond within 8s for ${req.method} ${upstreamPath}. Aborting and trying static fallback.`,
    );
    upstreamReq.destroy(new Error("upstream timeout (child never responded — is it WS-only with no HTTP handler?)"));
  });

  // Body forwarding. CRITICAL: the main land's express.json() middleware
  // runs BEFORE this proxy handler, so by the time we get here req.body
  // is already parsed and the underlying stream is drained. A naive
  // `req.pipe(upstreamReq)` would forward an EMPTY body and the upstream
  // child would see {} on every POST — that's how the login bug
  // manifested ("Email and password are required" because the child
  // couldn't find them in the empty body).
  //
  // Detect a parsed body and re-serialize it. For raw streams (no
  // body parser, e.g. file uploads), fall back to the pipe.
  const hasParsedBody =
    req.body !== undefined &&
    req.body !== null &&
    typeof req.body === "object" &&
    Object.keys(req.body).length > 0;

  if (hasParsedBody) {
    // Re-serialize as JSON. The upstream content-type header is
    // already application/json (or whatever the client sent), so the
    // child's express.json() will re-parse it correctly.
    let bodyBuf;
    try {
      bodyBuf = Buffer.from(JSON.stringify(req.body), "utf8");
    } catch {
      bodyBuf = Buffer.from("{}", "utf8");
    }
    // Set the right content-length so the upstream HTTP/1.1 stream
    // doesn't hang waiting for more bytes.
    upstreamReq.setHeader("content-length", bodyBuf.length);
    upstreamReq.setHeader("content-type", req.headers["content-type"] || "application/json");
    upstreamReq.end(bodyBuf);
  } else {
    // No parsed body — stream the raw request through. Used for GET,
    // file uploads, and other content types the body parser didn't touch.
    req.pipe(upstreamReq);
  }
}

/**
 * Shared preview handler used for every /preview/:slug[/*] request.
 */
function handlePreviewRequest(req, res) {
  const slug = req.params.slug;
  if (!slug) {
    res.status(400).type("text/plain").send("Missing slug");
    return;
  }
  const entry = getEntry(slug);
  if (!entry) {
    res.status(404).type("text/plain").send(`No running preview for "${slug}". Start it from the project root page.`);
    return;
  }
  entry.lastHit = Date.now();

  // Compute the rest of the path after /preview/:slug
  // Express 4 wildcard: req.params[0] holds the rest when route is `/preview/:slug/*`
  // For the exact `/preview/:slug` route there's no rest, default to "/"
  const rest = req.params[0] != null ? "/" + req.params[0] : "/";
  const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  const baseHref = `/api/v1/preview/${slug}/`;

  if (entry.kind === "static") {
    serveStatic(entry, rest, res, baseHref);
  } else {
    proxyToChild(entry, rest, qs, req, res, baseHref);
  }
}

export default function createRouter(/* core */) {
  const router = express.Router();

  // ── Workspace lifecycle routes ─────────────────────────────────────

  router.post("/workspace/:nodeId/serve", authenticate, async (req, res) => {
    try {
      const project = await loadProjectNode(req.params.nodeId);
      if (!project) {
        return sendError(
          res, 404, ERR.NODE_NOT_FOUND,
          "No workspace project on that node. The Run button only works on the project root.",
        );
      }
      const workspacePath = workspacePathFor(project);
      const entry = await startPreview({ projectNode: project, workspacePath });
      return sendOk(res, {
        slug: entry.slug,
        kind: entry.kind,
        port: entry.port,
        startedAt: entry.startedAt,
      });
    } catch (err) {
      log.error("CodeWorkspace", `serve failed for ${req.params.nodeId}: ${err.message}`);
      return sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.post("/workspace/:nodeId/stop", authenticate, async (req, res) => {
    try {
      const project = await loadProjectNode(req.params.nodeId);
      if (!project) {
        return sendError(res, 404, ERR.NODE_NOT_FOUND, "No workspace project on that node");
      }
      const slug = slugify(project.name, project._id);
      const stopped = stopPreview(slug);
      return sendOk(res, { stopped, slug });
    } catch (err) {
      return sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.get("/workspace/:nodeId/serve-status", authenticate, async (req, res) => {
    try {
      const project = await loadProjectNode(req.params.nodeId);
      if (!project) {
        return sendOk(res, { running: false, reason: "not-a-project" });
      }
      const entry = getEntryByNodeId(project._id);
      if (!entry) {
        return sendOk(res, {
          running: false,
          slug: slugify(project.name, project._id),
          projectName: project.name,
        });
      }
      return sendOk(res, {
        running: true,
        slug: entry.slug,
        kind: entry.kind,
        port: entry.port,
        pid: entry.pid,
        projectName: project.name,
        startedAt: entry.startedAt,
        lastHit: entry.lastHit,
        stdoutTail: entry.stdout.slice(-30),
        stderrTail: entry.stderr.slice(-30),
      });
    } catch (err) {
      return sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.get("/workspace/previews", authenticate, async (req, res) => {
    try {
      const list = allEntries().map((e) => ({
        slug: e.slug,
        nodeId: e.nodeId,
        kind: e.kind,
        port: e.port,
        pid: e.pid,
        startedAt: e.startedAt,
        lastHit: e.lastHit,
      }));
      return sendOk(res, { previews: list });
    } catch (err) {
      return sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ── Preview serving routes ─────────────────────────────────────────
  // NO auth middleware — the iframe needs to load without carrying JWT,
  // and preview URLs are slug-guessable by design. Add auth later via a
  // short-lived signed token if sensitivity becomes a concern.

  router.all("/preview/:slug", handlePreviewRequest);
  router.all("/preview/:slug/*", handlePreviewRequest);

  return router;
}
