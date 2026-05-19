/**
 * WebSocket upgrade proxy for the preview subsystem.
 *
 * When a browser connects to `wss://<land>/api/v1/preview/<slug>/...`
 * with an upgrade request, Node fires `server.on('upgrade')` on the
 * raw http.Server BEFORE Express ever sees it. The land's routing
 * layer (including this extension's preview router) runs on Express
 * and doesn't handle upgrades — which is why every WebSocket request
 * at a preview path silently fails.
 *
 * This module installs ONE upgrade listener on the land's http.Server:
 *
 *   1. Parse the URL. If it doesn't match /api/v1/preview/<slug>/...,
 *      return without handling — Socket.IO's own upgrade listener
 *      gets a shot at it.
 *   2. Look up the running preview by slug.
 *   3. If it's a running server-kind preview with a port, open a
 *      low-level http.request with `method: 'GET' + upgrade: 'websocket'`
 *      to 127.0.0.1:<port>/<rest-of-path>.
 *   4. When the upstream acks the upgrade, wire the two raw sockets
 *      together in both directions — byte-for-byte tunnel until either
 *      side closes.
 *   5. If anything fails, write a 502 back to the client socket and
 *      tear down the tunnel.
 *
 * Idempotent: the hook is only installed once per process even if the
 * extension is reloaded. Tracks installation via a symbol on the
 * http.Server instance.
 */

import http from "http";
import log from "../../../seed/log.js";
import { getEntry } from "./registry.js";

const INSTALLED = Symbol.for("code-workspace.wsUpgradeInstalled");
const PREVIEW_PATH_RE = /^\/api\/v1\/preview\/([^/?]+)(\/[^?]*)?(?:\?.*)?$/;

/**
 * Install the upgrade listener on the land's http.Server. Safe to call
 * multiple times — subsequent calls are no-ops. Called from the
 * extension's init once core.websocket.getHttpServer() is available.
 */
export function installPreviewUpgradeProxy(httpServer) {
  if (!httpServer || typeof httpServer.on !== "function") {
    log.warn("CodeServe", "installPreviewUpgradeProxy: no httpServer provided, WS proxy NOT installed");
    return false;
  }
  if (httpServer[INSTALLED]) return true;
  httpServer[INSTALLED] = true;

  httpServer.on("upgrade", (req, clientSocket, head) => {
    try {
      const url = req.url || "";
      const match = url.match(PREVIEW_PATH_RE);
      if (!match) {
        // Not a preview upgrade request — leave it alone. Socket.IO's
        // own upgrade listener (if present) will handle it.
        return;
      }

      const slug = match[1];
      const rest = match[2] || "/";

      const entry = getEntry(slug);
      if (!entry) {
        writeSocketError(clientSocket, 404, `preview "${slug}" not found`);
        return;
      }
      if (entry.kind !== "server") {
        writeSocketError(clientSocket, 400, `preview "${slug}" is static — WebSocket upgrades only work on server previews`);
        return;
      }
      if (!entry.port) {
        writeSocketError(clientSocket, 503, `preview "${slug}" is not listening yet`);
        return;
      }

      entry.lastHit = Date.now();

      tunnelUpgrade({
        slug,
        clientSocket,
        head,
        req,
        upstreamHost: "127.0.0.1",
        upstreamPort: entry.port,
        upstreamPath: rest,
        entry,
      });
    } catch (err) {
      log.warn("CodeServe", `WS upgrade handler threw: ${err.message}`);
      try { clientSocket.destroy(); } catch {}
    }
  });

  log.info("CodeServe", "WebSocket upgrade proxy installed at /api/v1/preview/<slug>/*");
  return true;
}

/**
 * Open a low-level HTTP upgrade request to the child and splice the
 * two sockets together when it succeeds. Uses Node's `upgrade` event
 * on the ClientRequest — emitted with the raw socket when the upstream
 * returns a 101 Switching Protocols.
 *
 * Both sockets are piped in both directions with `allowHalfOpen`
 * semantics, matching what the `ws` library expects for a transparent
 * proxy. Any error on either end tears both down.
 */
function tunnelUpgrade({ slug, clientSocket, head, req, upstreamHost, upstreamPort, upstreamPath, entry }) {
  // Build the upstream headers. Most pass through; we rewrite Host so
  // the upstream doesn't see the land's public hostname. Hop-by-hop
  // headers (connection, upgrade) are preserved because the upstream
  // needs them to negotiate the upgrade.
  const upstreamHeaders = { ...req.headers };
  upstreamHeaders.host = `${upstreamHost}:${upstreamPort}`;

  const upstreamReq = http.request({
    hostname: upstreamHost,
    port: upstreamPort,
    path: upstreamPath,
    method: "GET",
    headers: upstreamHeaders,
  });

  upstreamReq.on("upgrade", (upstreamRes, upstreamSocket, upstreamHead) => {
    // Forward the upstream's 101 line + headers to the client BEFORE
    // any data flows. Node gives us the raw status/headers via the
    // IncomingMessage, but the proper upgrade response has to be
    // written as a raw HTTP frame.
    const responseLines = [
      `HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage || "Switching Protocols"}`,
    ];
    for (const [name, value] of Object.entries(upstreamRes.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) responseLines.push(`${name}: ${v}`);
      } else {
        responseLines.push(`${name}: ${value}`);
      }
    }
    responseLines.push("\r\n");
    clientSocket.write(responseLines.join("\r\n"));

    // Flush any upstream data that arrived with the upgrade frame
    if (upstreamHead && upstreamHead.length > 0) {
      clientSocket.write(upstreamHead);
    }
    // And any buffered data the client sent with its upgrade frame
    if (head && head.length > 0) {
      upstreamSocket.write(head);
    }

    // Now wire the two sockets together, byte-for-byte.
    clientSocket.pipe(upstreamSocket);
    upstreamSocket.pipe(clientSocket);

    // Keep the preview's lastHit fresh while any byte moves through
    // this tunnel in either direction. Without this, an active
    // WebSocket session looks idle to the reaper (which only watches
    // lastHit and is bumped by HTTP proxy hits, not WS traffic), and
    // the reaper kills the preview after 10 minutes, dropping every
    // connected user mid-session. Touching lastHit on data flow costs
    // a single Date.now() per packet — negligible.
    if (entry) {
      const touchHit = () => { entry.lastHit = Date.now(); };
      clientSocket.on("data", touchHit);
      upstreamSocket.on("data", touchHit);
    }

    const teardown = (reason) => {
      try { clientSocket.destroy(); } catch {}
      try { upstreamSocket.destroy(); } catch {}
      log.debug("CodeServe", `WS tunnel ${slug} closed: ${reason}`);
    };

    clientSocket.on("error", (err) => teardown(`client error: ${err.message}`));
    upstreamSocket.on("error", (err) => teardown(`upstream error: ${err.message}`));
    clientSocket.on("close", () => teardown("client close"));
    upstreamSocket.on("close", () => teardown("upstream close"));

    log.info("CodeServe", `WS tunnel open: ${slug} → 127.0.0.1:${upstreamPort}${upstreamPath}`);
  });

  upstreamReq.on("response", (upstreamRes) => {
    // Upstream returned a regular HTTP response instead of upgrading.
    // Usually means the child doesn't have a WebSocket handler at this
    // path. Return the status to the client as an error frame and close.
    writeSocketError(
      clientSocket,
      upstreamRes.statusCode || 502,
      `preview "${slug}" did not upgrade (upstream returned ${upstreamRes.statusCode})`,
    );
    upstreamRes.resume();
  });

  upstreamReq.on("error", (err) => {
    log.warn("CodeServe", `WS upstream error for ${slug}: ${err.message}`);
    writeSocketError(clientSocket, 502, `upstream error: ${err.message}`);
  });

  upstreamReq.end();
}

/**
 * Write a minimal HTTP error response to the raw client socket and
 * close it. Used when we can't complete an upgrade — plain text body
 * so the browser's WebSocket shows the status code in DevTools.
 */
function writeSocketError(socket, status, message) {
  if (!socket || socket.destroyed) return;
  try {
    socket.write(
      `HTTP/1.1 ${status} ${statusText(status)}\r\n` +
      `Content-Type: text/plain\r\n` +
      `Content-Length: ${Buffer.byteLength(message)}\r\n` +
      `Connection: close\r\n\r\n` +
      message,
    );
  } catch {}
  try { socket.destroy(); } catch {}
}

function statusText(status) {
  switch (status) {
    case 400: return "Bad Request";
    case 404: return "Not Found";
    case 502: return "Bad Gateway";
    case 503: return "Service Unavailable";
    default:  return "Error";
  }
}
