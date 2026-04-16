/**
 * Port + process registry for running workspace previews.
 *
 * Entry shape:
 *   {
 *     slug,            - URL slug (derived from project name)
 *     nodeId,          - project node _id (string)
 *     kind,            - "server" | "static"
 *     workspacePath,   - absolute path on disk
 *     pid,             - child pid (server only, null for static)
 *     port,            - allocated port (server only)
 *     staticDir,       - absolute dir to serve (static only)
 *     child,           - ChildProcess handle (server only)
 *     startedAt,       - ms
 *     lastHit,         - ms  (for idle reaper)
 *     stdout,          - ring buffer of lines
 *     stderr,          - ring buffer of lines
 *   }
 *
 * Slugs are the primary key (URL-facing). nodeId -> slug is a secondary
 * index so the node page can quickly find its preview.
 */

import net from "net";

const _bySlug = new Map();
const _byNodeId = new Map();

const PORT_START = 51000;
const PORT_END = 51500;

export function getEntry(slug) {
  return _bySlug.get(slug) || null;
}

export function getEntryByNodeId(nodeId) {
  if (!nodeId) return null;
  const slug = _byNodeId.get(String(nodeId));
  return slug ? _bySlug.get(slug) : null;
}

export function setEntry(slug, entry) {
  _bySlug.set(slug, entry);
  if (entry.nodeId) _byNodeId.set(String(entry.nodeId), slug);
}

export function removeEntry(slug) {
  const entry = _bySlug.get(slug);
  _bySlug.delete(slug);
  if (entry?.nodeId) _byNodeId.delete(String(entry.nodeId));
}

export function allEntries() {
  return Array.from(_bySlug.values());
}

/**
 * Turn a project's name + nodeId into a unique, URL-safe slug. Deterministic
 * so the same project produces the same slug across restarts. Collision-proof
 * so two projects named "tiner" in different trees get distinct slugs.
 *
 * Shape: "<kebab-name>-<first 8 of nodeId>"
 *   tiner-b83cfc21
 *   vowel-counter-19aa5fa7
 *
 * nodeId is optional for backwards compatibility but callers should always
 * pass it for new previews.
 */
export function slugify(name, nodeId = null) {
  const base = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "app";
  if (!nodeId) return base;
  const suffix = String(nodeId).replace(/-/g, "").slice(0, 8);
  return `${base}-${suffix}`;
}

/**
 * Allocate a free port in the preview range. Skips any port currently
 * held by a registered entry, then probes the OS to confirm it's free.
 */
export async function allocatePort() {
  const held = new Set(Array.from(_bySlug.values()).map(e => e.port).filter(Boolean));
  for (let p = PORT_START; p <= PORT_END; p++) {
    if (held.has(p)) continue;
    if (await isPortFree(p)) return p;
  }
  throw new Error(`No free preview port in ${PORT_START}-${PORT_END}`);
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Poll the port until something is listening (the child bound) or
 * timeout elapses. Used right after spawn to confirm the child is
 * actually accepting connections before we start proxying to it.
 */
export function waitForPortListening(port, timeoutMs = 5000) {
  return new Promise(async (resolve) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await portAcceptsConnection(port)) return resolve(true);
      await new Promise(r => setTimeout(r, 150));
    }
    resolve(false);
  });
}

function portAcceptsConnection(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: "127.0.0.1", port });
    let done = false;
    sock.once("connect", () => {
      if (done) return; done = true;
      sock.end();
      resolve(true);
    });
    sock.once("error", () => {
      if (done) return; done = true;
      resolve(false);
    });
    setTimeout(() => {
      if (done) return; done = true;
      try { sock.destroy(); } catch {}
      resolve(false);
    }, 500);
  });
}
