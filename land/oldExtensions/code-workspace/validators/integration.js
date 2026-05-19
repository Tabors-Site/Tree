/**
 * Cross-branch integration smoke validator.
 *
 * Runs ONCE at the end of a swarm, after every branch has individually
 * passed its own unit smoke (validators/smoke.js). Verifies that the
 * frontend's fetch() calls resolve to routes the backend actually
 * serves. This is the "seam check": each branch built something that
 * works in isolation, but do they work TOGETHER?
 *
 * Retry policy:
 *   - Integration failures surface to the user IMMEDIATELY, not via
 *     auto-retry. The direction of the mismatch (frontend or backend
 *     wrong?) is ambiguous and the operator decides which side bends.
 *   - Per user feedback: "frontend calls /api/users/me but backend has
 *     /api/profile/current — pick one and tell me which side to fix."
 *   - Returned errors are emitted as CONTRACT_MISMATCH signals so the
 *     plan.md summary + UI flag them as operator-facing.
 *
 * What we DO probe:
 *   - Every relative-absolute path (`/api/...`, `/auth/...`, etc.)
 *     found in a fetch() call in the frontend's JS / HTML
 *   - Only GET requests (no POST/PUT/DELETE — those may have side
 *     effects we don't want to trigger)
 *   - POST/PUT/DELETE endpoints are collected as "expected" signals,
 *     logged but not fired
 *
 * What we DON'T check:
 *   - Backend routes the frontend never calls (could be admin-only,
 *     deferred, or future work). Surfaced as informational plan notes.
 *   - HTTPS/CORS/authentication paths — smoke assumes a stateless GET.
 *   - WebSocket endpoints.
 *   - Headless-browser JS runtime errors.
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import log from "../../../seed/log.js";
import {
  allocateSmokePort,
  waitForListening,
  probeOnce,
} from "./smoke.js";

const SERVER_BOOT_TIMEOUT_MS = 10000;
const STDERR_RING = 200;

/**
 * Main entry. Called from swarm.js after all branches are done.
 *
 *   smokeIntegration({ workspaceRoot, branches })
 *     → { ok: true, skipped?: true, reason?: string }
 *     → { ok: false, mismatches: [{ from, url, status, reason }] }
 *
 * `branches` is an array of { name, path, status } from the swarm
 * results. We pick the first branch of each kind (server/static) from
 * disk; if there are multiple servers we skip with a note.
 */
export async function smokeIntegration({ workspaceRoot, branches }) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    return { ok: true, skipped: true, reason: "no workspaceRoot" };
  }
  if (!Array.isArray(branches) || branches.length === 0) {
    return { ok: true, skipped: true, reason: "no branches" };
  }

  // Partition branches by kind. Uses the same kind detection as smoke.js
  // but on the branch subdirs so the classifier stays consistent.
  const serverBranches = [];
  const staticBranches = [];

  for (const b of branches) {
    if (b.status !== "done") continue;
    if (!b.path) continue;
    const branchDir = path.join(workspaceRoot, b.path);
    if (!fs.existsSync(branchDir)) continue;

    const kind = classifyBranchDir(branchDir);
    if (kind.kind === "server") serverBranches.push({ ...b, branchDir, entry: kind.entry });
    else if (kind.kind === "static") staticBranches.push({ ...b, branchDir });
  }

  if (serverBranches.length === 0 || staticBranches.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: `not a client/server shape (server=${serverBranches.length} static=${staticBranches.length})`,
    };
  }

  if (serverBranches.length > 1) {
    return {
      ok: true,
      skipped: true,
      reason: `multiple server branches (${serverBranches.length}) — operator-ambiguous, skipping integration`,
    };
  }

  const server = serverBranches[0];

  // Extract fetch URLs from every static branch (not just one; a
  // multi-frontend project should still have its wiring checked).
  const endpoints = new Map(); // url → { methods: Set, sourceBranch, sources: [{file,line}] }
  for (const staticBranch of staticBranches) {
    const jsFiles = walkFiles(staticBranch.branchDir, [".js", ".mjs", ".html", ".htm"], 3);
    for (const abs of jsFiles) {
      try {
        const content = fs.readFileSync(abs, "utf8");
        const found = extractFetchCalls(content);
        for (const f of found) {
          if (!endpoints.has(f.url)) {
            endpoints.set(f.url, {
              methods: new Set([f.method]),
              sourceBranch: staticBranch.name,
              sources: [],
            });
          } else {
            endpoints.get(f.url).methods.add(f.method);
          }
          endpoints.get(f.url).sources.push({
            file: path.relative(workspaceRoot, abs),
            line: f.line,
          });
        }
      } catch {}
    }
  }

  if (endpoints.size === 0) {
    return { ok: true, skipped: true, reason: "no frontend fetch calls found" };
  }

  // Collect GET endpoints for probing; non-GET methods become
  // informational records the swarm can surface in plan.md.
  const getEndpoints = [];
  const nonGetEndpoints = [];
  for (const [url, meta] of endpoints.entries()) {
    if (meta.methods.has("GET")) {
      getEndpoints.push({ url, meta });
    }
    const others = [...meta.methods].filter((m) => m !== "GET");
    if (others.length > 0) {
      nonGetEndpoints.push({ url, methods: others, sources: meta.sources });
    }
  }

  if (getEndpoints.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: "frontend has fetch calls but no GETs — integration probe would mutate state, skipping",
      nonGetEndpoints,
    };
  }

  // Spawn the server branch in isolation and probe every GET endpoint.
  const port = await allocateSmokePort();
  if (!port) {
    return { ok: true, skipped: true, reason: "no free smoke port" };
  }

  const env = {
    PATH: process.env.PATH,
    HOME: server.branchDir,
    NODE_ENV: "development",
    PORT: String(port),
    PREVIEW_PORT: String(port),
  };

  let child;
  try {
    child = spawn("node", [server.entry], {
      cwd: server.branchDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
  } catch (err) {
    return {
      ok: false,
      mismatches: [{
        from: server.name,
        url: "(spawn)",
        status: null,
        reason: `Failed to spawn server for integration: ${err.message}`,
        sources: [],
      }],
      nonGetEndpoints,
    };
  }

  const stderrBuf = [];
  let exited = false;

  child.stdout.on("data", () => {});
  child.stderr.on("data", (buf) => {
    const lines = String(buf).split("\n").filter(Boolean);
    stderrBuf.push(...lines);
    if (stderrBuf.length > STDERR_RING) {
      stderrBuf.splice(0, stderrBuf.length - STDERR_RING);
    }
  });
  child.on("exit", () => {
    exited = true;
  });

  try {
    const listening = await waitForListening(port, SERVER_BOOT_TIMEOUT_MS, () => exited);
    if (!listening) {
      return {
        ok: false,
        mismatches: [{
          from: server.name,
          url: "(boot)",
          status: null,
          reason: exited
            ? `Server crashed during integration boot: ${stderrBuf.slice(-10).join("\n").slice(-500)}`
            : `Server did not listen on port ${port} within ${SERVER_BOOT_TIMEOUT_MS}ms`,
          sources: [],
        }],
        nonGetEndpoints,
      };
    }

    // Server is up. Probe each GET endpoint. Endpoints that return
    // 2xx/3xx pass; 4xx/5xx fail. Network errors (unlikely on localhost)
    // are treated as failures so the operator sees them.
    const mismatches = [];
    for (const endpoint of getEndpoints) {
      const result = await probeOnce(port, endpoint.url);
      if (!result.ok) {
        // Distinguish "404 = frontend calls an endpoint backend doesn't
        // have" from "500 = endpoint exists but crashes". Both surface
        // to operator but the message is different.
        const status = result.status;
        let reason;
        if (status === 404) {
          reason = `Frontend calls GET ${endpoint.url} but backend has no such route`;
        } else if (status && status >= 500) {
          reason = `Backend has GET ${endpoint.url} but it returned ${status} on probe`;
        } else if (status && status >= 400) {
          reason = `Backend has GET ${endpoint.url} but returned ${status} (auth/validation?)`;
        } else {
          reason = result.reason || "probe failed";
        }
        mismatches.push({
          from: server.name,
          url: endpoint.url,
          status,
          reason,
          sources: endpoint.meta.sources,
        });
      }
    }

    if (mismatches.length === 0) {
      log.info(
        "CodeWorkspace",
        `Integration smoke passed: ${getEndpoints.length} GET endpoint(s) probed on ${server.name}`,
      );
      return { ok: true, probed: getEndpoints.length, nonGetEndpoints };
    }

    return { ok: false, mismatches, nonGetEndpoints };
  } finally {
    try {
      if (!exited) child.kill("SIGTERM");
    } catch {}
    setTimeout(() => {
      try {
        if (!child.killed) child.kill("SIGKILL");
      } catch {}
    }, 2000).unref();
  }
}

// ─────────────────────────────────────────────────────────────────────
// CLASSIFICATION (duplicates smoke.js' detectBranchKind by design —
// integration's classifier is simpler because it doesn't handle doc or
// generic branches; they just fall through)
// ─────────────────────────────────────────────────────────────────────

function classifyBranchDir(branchDir) {
  const pkgPath = path.join(branchDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const startCmd = pkg?.scripts?.start;
      if (typeof startCmd === "string") {
        const m = startCmd.match(/^node\s+(\S+)/);
        if (m) {
          const entry = m[1];
          if (fs.existsSync(path.join(branchDir, entry))) {
            return { kind: "server", entry };
          }
        }
      }
    } catch {}
  }
  for (const candidate of ["server.js", "index.js", "app.js", "main.js"]) {
    const abs = path.join(branchDir, candidate);
    if (fs.existsSync(abs)) {
      try {
        const content = fs.readFileSync(abs, "utf8");
        if (/\.listen\s*\(/.test(content) || /createServer/.test(content)) {
          return { kind: "server", entry: candidate };
        }
      } catch {}
    }
  }

  const htmlFiles = walkFiles(branchDir, [".html", ".htm"], 2);
  if (htmlFiles.length > 0) return { kind: "static", htmlFiles };

  return { kind: "generic" };
}

function walkFiles(root, exts, maxDepth) {
  const out = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (exts.includes(ext)) out.push(full);
      }
    }
  }
  walk(root, 0);
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// FETCH-CALL EXTRACTION
// ─────────────────────────────────────────────────────────────────────

/**
 * Scan JS/HTML source for fetch() calls and return an array of
 * { url, method, line } where `url` is the first-argument string
 * literal and `method` is the options.method (or "GET" by default).
 *
 * This is a regex approach, not a parse. It catches the common cases:
 *
 *   fetch('/api/users')                              → GET /api/users
 *   fetch(`/api/users/${id}`)                        → GET /api/users/:id  (template stripped)
 *   fetch('/api/users', { method: 'POST' })          → POST /api/users
 *   fetch("/api/users", { method: "DELETE" })        → DELETE /api/users
 *
 * Template literals with ${...} substitutions get the interpolation
 * replaced with `:PARAM` so we can still probe the route shape. If the
 * substitution is at the end of the path, we drop it and probe the
 * prefix — which is usually the real route (e.g., fetch(`/api/users/${id}`)
 * → probe GET /api/users/1 — the backend probably has /api/users/:id
 * but we're not about to guess an id, so we probe the bare /api/users).
 *
 * What we miss (acceptable false negatives):
 *   - fetch(someVar)                   — dynamic, can't extract
 *   - axios.get('/api/foo')            — different library
 *   - new XMLHttpRequest()             — legacy
 *   - fetch(new URL('/api/foo', base)) — constructor call
 *
 * These are documented as phase-4 extensions. Real projects built by
 * the swarm use plain fetch() with string literals 95% of the time.
 */
export function extractFetchCalls(content) {
  const out = [];
  if (typeof content !== "string" || !content) return out;

  // Match fetch( <string or template> [, { method: '<M>' }] )
  // String form: fetch('...') / fetch("...")
  // Template:    fetch(`...`)
  const pattern = /\bfetch\s*\(\s*(['"`])([^'"`]*)\1(?:\s*,\s*\{([^}]*)\})?/g;
  let m;
  while ((m = pattern.exec(content)) !== null) {
    const rawUrl = m[2];
    const optsBody = m[3] || "";
    if (!rawUrl) continue;

    // Only look at server-relative URLs (start with /) since absolute
    // http://... references aren't this backend's responsibility.
    if (!rawUrl.startsWith("/")) continue;

    // Strip ${...} interpolations. If the interpolation is at the end,
    // also drop the trailing slash so we probe the collection endpoint.
    let url = rawUrl.replace(/\$\{[^}]*\}/g, ":PARAM");
    url = url.replace(/\/:PARAM(?:\/|$)/g, (match) => (match.endsWith("/") ? "/" : ""));
    if (!url) continue;

    // Extract method from options body; default GET.
    const methodMatch = optsBody.match(/\bmethod\s*:\s*['"]([A-Za-z]+)['"]/);
    const method = methodMatch ? methodMatch[1].toUpperCase() : "GET";

    const before = content.slice(0, m.index);
    const line = (before.match(/\n/g) || []).length + 1;

    out.push({ url, method, line });
  }

  return out;
}
