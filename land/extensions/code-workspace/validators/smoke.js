/**
 * Per-branch unit smoke validator.
 *
 * Phase 3 of the validator pipeline. Phase 1 (syntax) catches parse
 * failures on every write. Phase 3 catches RUNTIME failures the branch
 * built into its own files: server crashes on boot, missing local
 * assets, broken markdown. Integration concerns (frontend ↔ backend
 * contract probing) live in validators/integration.js, NOT here — this
 * file tests each branch in isolation so a backend branch can pass
 * before its frontend sibling even exists.
 *
 * Called from swarm.js in the existing branch-done sweep, right after
 * the syntax sweep passes. If smoke fails, the branch is flipped to
 * "failed" with structured errors appended to signalInbox, exactly
 * like a syntax error — the retry loop picks it up on the next pass.
 *
 * Kind detection walks the branch's disk subdirectory (NOT the tree)
 * because disk is authoritative: writes have already been persisted by
 * the afterNote hook, and we want to test what the operator would
 * actually run via preview.
 *
 *   server  — package.json with scripts.start + entry file exists
 *             → spawn `node <entry>`, wait for listen, probe GET /
 *   static  — index.html present, no server
 *             → HTML parse + local asset existence check
 *   doc     — only markdown files
 *             → basic well-formedness (fenced blocks balanced)
 *   generic — anything else
 *             → pass through (phase 1 already validated syntax)
 *
 * Retry budget is enforced in swarm.js, not here. This function just
 * returns { ok, errors, skipped, reason }.
 */

import { spawn, spawnSync } from "child_process";
import fs from "fs";
import http from "http";
import net from "net";
import path from "path";
import log from "../../../seed/log.js";
import { parseNodeStack, extractErrorHeader } from "./stackParser.js";

const NPM_INSTALL_TIMEOUT_MS = 180000;

const SMOKE_PORT_MIN = 51900;
const SMOKE_PORT_MAX = 51999;
const SERVER_BOOT_TIMEOUT_MS = 10000;
const SERVER_PROBE_TIMEOUT_MS = 3000;
const SPAWN_GRACE_MS = 500;
const STDERR_RING = 200;

/**
 * Main entry. Called once per branch in the branch-done sweep.
 *
 *   smokeBranch({ workspaceRoot, branchPath, branchName })
 *     → { ok: true }
 *     → { ok: false, errors: [{ kind, file, line, column, message, context, raw }] }
 *     → { ok: true, skipped: true, reason: "..." }
 *
 * `branchPath` is the relative subdir ("backend", "frontend", or "" for
 * top-level project work). If empty, this function skips because we
 * can't distinguish branch files from other branches' files on disk.
 */
export async function smokeBranch({ workspaceRoot, branchPath, branchName }) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    return { ok: true, skipped: true, reason: "no workspaceRoot" };
  }
  if (!branchPath) {
    return { ok: true, skipped: true, reason: "no branch path (top-level work)" };
  }

  const branchDir = path.join(workspaceRoot, branchPath);
  if (!fs.existsSync(branchDir)) {
    return { ok: true, skipped: true, reason: `branch dir missing: ${branchPath}` };
  }

  const kind = detectBranchKind(branchDir);

  switch (kind.kind) {
    case "server":
      return smokeServer({ branchDir, branchPath, branchName, entry: kind.entry });
    case "static":
      return smokeStatic({ branchDir, branchPath, branchName, htmlFiles: kind.htmlFiles });
    case "doc":
      return smokeDoc({ branchDir, branchPath, branchName, mdFiles: kind.mdFiles });
    case "generic":
    default:
      return { ok: true, skipped: true, reason: `unknown kind (${kind.reason || "no entry"})` };
  }
}

// ─────────────────────────────────────────────────────────────────────
// KIND DETECTION
// ─────────────────────────────────────────────────────────────────────

/**
 * Walk a branch directory to classify it. Cheap sync scan — branches
 * have <50 files typically. Returns { kind, ...details }.
 */
function detectBranchKind(branchDir) {
  // Server: package.json with scripts.start AND the entry exists
  const pkgPath = path.join(branchDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const startCmd = pkg?.scripts?.start;
      if (typeof startCmd === "string") {
        const m = startCmd.match(/^node\s+(\S+)/);
        if (m) {
          const entryRel = m[1];
          const entryAbs = path.join(branchDir, entryRel);
          if (fs.existsSync(entryAbs)) {
            return { kind: "server", entry: entryRel };
          }
        }
      }
    } catch {
      // corrupt package.json — fall through to other detectors
    }
  }

  // Server fallback: a bare server.js or index.js next to package.json
  // (no scripts.start, but clearly a server shape)
  for (const candidate of ["server.js", "index.js", "app.js", "main.js"]) {
    if (fs.existsSync(path.join(branchDir, candidate))) {
      // Only treat as server if it looks like one — has http.createServer,
      // app.listen, or similar. Otherwise it's just a generic module.
      try {
        const content = fs.readFileSync(path.join(branchDir, candidate), "utf8");
        if (/\.listen\s*\(/.test(content) || /createServer/.test(content)) {
          return { kind: "server", entry: candidate };
        }
      } catch {}
    }
  }

  // Static: any HTML file under the branch dir (shallow: root + one
  // level down, skipping node_modules and dotdirs)
  const htmlFiles = findFilesByExt(branchDir, [".html", ".htm"], 2);
  if (htmlFiles.length > 0) {
    return { kind: "static", htmlFiles };
  }

  // Doc: only markdown files (no .js, no .html)
  const mdFiles = findFilesByExt(branchDir, [".md"], 2);
  const jsFiles = findFilesByExt(branchDir, [".js", ".mjs", ".cjs"], 2);
  if (mdFiles.length > 0 && jsFiles.length === 0) {
    return { kind: "doc", mdFiles };
  }

  return { kind: "generic", reason: "no server entry, no html, no doc-only layout" };
}

function findFilesByExt(root, exts, maxDepth) {
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
// SERVER SMOKE
// ─────────────────────────────────────────────────────────────────────

/**
 * Spawn the server in isolation (no preview registry, no operator
 * visibility) on an allocated smoke port. Wait for listen. Probe GET /
 * (or /health/api/health if the server has one). Kill the child.
 *
 * Failure modes:
 *   - spawn error (node missing, permission)       → runtime-error, no file
 *   - child crashes before listen (stderr has error) → parse stack, point at file
 *   - child never listens within timeout            → runtime-error, message about timeout
 *   - listens but returns 5xx on probe              → runtime-error, probe response
 */
async function smokeServer({ branchDir, branchPath, branchName, entry, installAttempted = false }) {
  const port = await allocateSmokePort();
  if (!port) {
    return {
      ok: true,
      skipped: true,
      reason: "no free smoke port in range",
    };
  }

  // Mirror the alias set in serve/spawner.js so AI-generated servers
  // bind to the smoke port regardless of which env var convention
  // they chose (PORT, WS_PORT, HTTP_PORT, etc).
  const portStr = String(port);
  const env = {
    PATH: process.env.PATH,
    HOME: branchDir,
    NODE_ENV: "development",
    PORT: portStr,
    PREVIEW_PORT: portStr,
    HTTP_PORT: portStr,
    SERVER_PORT: portStr,
    APP_PORT: portStr,
    WS_PORT: portStr,
    WEBSOCKET_PORT: portStr,
    LISTEN_PORT: portStr,
  };

  let child;
  try {
    child = spawn("node", [entry], {
      cwd: branchDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });
  } catch (err) {
    return {
      ok: false,
      errors: [{
        kind: "runtime-error",
        file: path.join(branchPath, entry),
        line: 1,
        column: 1,
        message: `Failed to spawn: ${err.message}`,
        context: "(spawn error — check node is available and entry file is readable)",
        raw: err.message,
      }],
    };
  }

  const stderrBuf = [];
  const stdoutBuf = [];
  let exited = false;
  let exitCode = null;
  let exitSignal = null;

  child.stdout.on("data", (buf) => {
    const lines = String(buf).split("\n").filter(Boolean);
    stdoutBuf.push(...lines);
    if (stdoutBuf.length > STDERR_RING) {
      stdoutBuf.splice(0, stdoutBuf.length - STDERR_RING);
    }
  });
  child.stderr.on("data", (buf) => {
    const lines = String(buf).split("\n").filter(Boolean);
    stderrBuf.push(...lines);
    if (stderrBuf.length > STDERR_RING) {
      stderrBuf.splice(0, stderrBuf.length - STDERR_RING);
    }
  });
  child.on("exit", (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });

  try {
    // Give the process a beat to start before we begin polling, so a
    // synchronous crash (import error, syntax issue) has stderr flushed
    // before we try to interpret it.
    await sleep(SPAWN_GRACE_MS);

    // If it already died, check for a missing module first (auto
    // install once, then retry). Otherwise build a runtime-error.
    if (exited) {
      const stderr = stderrBuf.join("\n");
      const missing = detectMissingModule(stderr);
      if (missing && !installAttempted) {
        const installed = await runNpmInstall(branchDir, missing);
        if (installed.ok) {
          log.info(
            "CodeWorkspace",
            `📦 smoke: installed missing deps for ${branchPath} (${installed.method}), retrying`,
          );
          // Re-enter the server smoke ONCE. The flag prevents infinite
          // loops if the install itself didn't fix the error.
          return await smokeServer({
            branchDir,
            branchPath,
            branchName,
            entry,
            installAttempted: true,
          });
        }
        // Install failed — surface the install error as the smoke
        // failure. Operator sees exactly what npm complained about.
        return {
          ok: false,
          errors: [{
            kind: "runtime-error",
            file: path.join(branchPath, "package.json"),
            line: 1,
            column: 1,
            message: `Missing dependency "${missing}" and npm install failed: ${installed.reason}`,
            context: installed.stderr ? installed.stderr.slice(-800) : "(no npm stderr)",
            raw: installed.stderr || null,
          }],
        };
      }
      return buildRuntimeErrorResult({
        branchDir,
        branchPath,
        branchName,
        entry,
        stderr,
        exitCode,
        exitSignal,
      });
    }

    // Wait for the port to listen (or timeout)
    const listening = await waitForListening(port, SERVER_BOOT_TIMEOUT_MS, () => exited);

    if (!listening) {
      // Child never listened. Either it's still starting up or it crashed.
      const stderr = stderrBuf.join("\n");
      if (exited) {
        // Same auto-install path as the synchronous-crash branch above.
        const missing = detectMissingModule(stderr);
        if (missing && !installAttempted) {
          const installed = await runNpmInstall(branchDir, missing);
          if (installed.ok) {
            log.info(
              "CodeWorkspace",
              `📦 smoke: installed missing deps for ${branchPath} (${installed.method}), retrying`,
            );
            return await smokeServer({
              branchDir,
              branchPath,
              branchName,
              entry,
              installAttempted: true,
            });
          }
        }
        return buildRuntimeErrorResult({
          branchDir,
          branchPath,
          branchName,
          entry,
          stderr,
          exitCode,
          exitSignal,
        });
      }
      // Still alive but not listening — probably a config issue. Report
      // the tail of stderr if any, else a generic timeout.
      return {
        ok: false,
        errors: [{
          kind: "runtime-error",
          file: path.join(branchPath, entry),
          line: 1,
          column: 1,
          message: stderr
            ? `Server did not bind to port ${port} within ${SERVER_BOOT_TIMEOUT_MS}ms. Stderr: ${stderr.slice(-500)}`
            : `Server did not bind to port ${port} within ${SERVER_BOOT_TIMEOUT_MS}ms (no stderr output).`,
          context: "(server started but never called app.listen(PORT) — check that PORT env var is honored)",
          raw: stderr.slice(0, 2000),
        }],
      };
    }

    // Listening. Probe it.
    const probeResult = await probeServer(port);
    if (probeResult.ok) {
      return { ok: true };
    }

    // Probe returned 5xx or error
    const stderr = stderrBuf.join("\n");
    return {
      ok: false,
      errors: [{
        kind: "runtime-error",
        file: path.join(branchPath, entry),
        line: 1,
        column: 1,
        message: `Server bound but ${probeResult.reason}. Probe: ${probeResult.method} ${probeResult.url} → ${probeResult.status || "error"}`,
        context: stderr
          ? `Stderr during probe:\n${stderr.slice(-800)}`
          : "(no stderr — server responded but with a 5xx or error)",
        raw: stderr.slice(0, 2000),
      }],
    };
  } finally {
    // Always clean up the child
    try {
      if (!exited) child.kill("SIGTERM");
    } catch {}
    // Force kill after a grace period if SIGTERM didn't stick
    setTimeout(() => {
      try {
        if (!child.killed) child.kill("SIGKILL");
      } catch {}
    }, 2000).unref();
  }
}

/**
 * Build a structured runtime-error result from a crashed child. Uses
 * the stack parser to pinpoint the offending file/line inside the
 * branch, and attaches a source context snippet when possible.
 */
function buildRuntimeErrorResult({ branchDir, branchPath, branchName, entry, stderr, exitCode, exitSignal }) {
  const parsed = parseNodeStack(stderr, branchDir);
  const header = extractErrorHeader(stderr) || `Exited code=${exitCode} signal=${exitSignal}`;

  // Prefer the parsed stack frame; fall back to the entry file.
  const file = parsed?.file
    ? path.join(branchPath, parsed.file)
    : path.join(branchPath, entry);
  const line = parsed?.line || 1;
  const column = parsed?.column || 1;

  let context = "(no source snippet available)";
  if (parsed?.file) {
    try {
      const abs = path.join(branchDir, parsed.file);
      const source = fs.readFileSync(abs, "utf8");
      context = sliceSourceContext(source, line, column);
    } catch {}
  }

  return {
    ok: false,
    errors: [{
      kind: "runtime-error",
      file,
      line,
      column,
      message: header,
      context,
      raw: stderr.slice(0, 2000),
    }],
  };
}

/**
 * Render a small source window around the error location, same style
 * as the syntax validator so the model sees familiar formatting.
 */
function sliceSourceContext(content, line, column) {
  if (!content || typeof content !== "string") return "(no source)";
  const lines = content.split("\n");
  const lineIdx = Math.max(0, line - 1);
  const startIdx = Math.max(0, lineIdx - 2);
  const endIdx = Math.min(lines.length - 1, lineIdx + 2);
  const maxLineNum = endIdx + 1;
  const gutter = String(maxLineNum).length;

  const out = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const num = String(i + 1).padStart(gutter, " ");
    const marker = i === lineIdx ? "→" : " ";
    out.push(`${marker} ${num} | ${lines[i] || ""}`);
    if (i === lineIdx && column > 0) {
      out.push(`  ${" ".repeat(gutter)} | ${" ".repeat(Math.max(0, column - 1))}^`);
    }
  }
  return out.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// STATIC SMOKE
// ─────────────────────────────────────────────────────────────────────

/**
 * For each HTML file in the branch, parse out local asset references
 * (src/href to relative paths) and verify the referenced files exist
 * on disk. Absolute /api/... paths are collected as "expected endpoints"
 * but NOT failed — those are for integration.js to verify later.
 *
 * Biased toward false negatives: we only fail on things that are
 * unambiguously broken (relative path that doesn't resolve). Anything
 * else passes.
 */
async function smokeStatic({ branchDir, branchPath, htmlFiles }) {
  const errors = [];

  for (const htmlAbs of htmlFiles) {
    let content;
    try {
      content = fs.readFileSync(htmlAbs, "utf8");
    } catch (err) {
      errors.push({
        kind: "runtime-error",
        file: path.relative(branchDir, htmlAbs),
        line: 1,
        column: 1,
        message: `Failed to read HTML: ${err.message}`,
        context: "",
        raw: err.message,
      });
      continue;
    }

    const htmlRel = path.relative(branchDir, htmlAbs);
    const htmlFileBranchRel = path.join(branchPath, htmlRel);
    const htmlDir = path.dirname(htmlAbs);

    // Collect src= and href= values from common tags. Not a real HTML
    // parser; a regex is enough to catch obvious breakage without
    // pulling in a dependency.
    const refs = extractLocalRefs(content);

    for (const ref of refs) {
      if (!ref.value) continue;

      // Skip protocol-qualified URLs (http://, https://, //, data:, mailto:)
      if (/^(https?:)?\/\//.test(ref.value)) continue;
      if (/^(data|mailto|tel|javascript):/i.test(ref.value)) continue;

      // Skip absolute paths starting with /api/, /static/, etc — those
      // are served by whatever backend runs this frontend. Not our
      // problem in a unit smoke.
      if (ref.value.startsWith("/")) continue;

      // Skip anchor fragments
      if (ref.value.startsWith("#")) continue;

      // Resolve relative to the HTML file's directory
      const assetAbs = path.resolve(htmlDir, ref.value.split(/[?#]/)[0]);
      if (!fs.existsSync(assetAbs)) {
        errors.push({
          kind: "runtime-error",
          file: htmlFileBranchRel,
          line: ref.line,
          column: 1,
          message: `Missing local asset: <${ref.tag} ${ref.attr}="${ref.value}"> — file not found on disk`,
          context: `Resolved to: ${path.relative(branchDir, assetAbs)}\nReferenced from: ${htmlRel}`,
          raw: null,
        });
      }
    }
  }

  if (errors.length === 0) return { ok: true };
  return { ok: false, errors };
}

/**
 * Regex-based extraction of src/href attributes from HTML. Tracks line
 * numbers by counting newlines up to each match. Handles both quoted
 * forms. Returns `{ tag, attr, value, line }`.
 */
function extractLocalRefs(content) {
  const refs = [];
  const pattern = /<(script|link|img|a|source|iframe)\b[^>]*?\b(src|href)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = pattern.exec(content)) !== null) {
    const before = content.slice(0, m.index);
    const line = (before.match(/\n/g) || []).length + 1;
    refs.push({
      tag: m[1].toLowerCase(),
      attr: m[2].toLowerCase(),
      value: m[3],
      line,
    });
  }
  return refs;
}

// ─────────────────────────────────────────────────────────────────────
// DOC SMOKE
// ─────────────────────────────────────────────────────────────────────

/**
 * Very cheap markdown well-formedness check. We only flag the one thing
 * that trips the AI regularly: unbalanced fenced code blocks (```).
 * Everything else in markdown is permissive — unbalanced asterisks or
 * brackets are not "errors", they're stylistic. No parser, no deps.
 */
async function smokeDoc({ branchDir, branchPath, mdFiles }) {
  const errors = [];

  for (const mdAbs of mdFiles) {
    let content;
    try {
      content = fs.readFileSync(mdAbs, "utf8");
    } catch (err) {
      errors.push({
        kind: "runtime-error",
        file: path.join(branchPath, path.relative(branchDir, mdAbs)),
        line: 1,
        column: 1,
        message: `Failed to read markdown: ${err.message}`,
        context: "",
        raw: err.message,
      });
      continue;
    }

    // Count fenced blocks. Unbalanced = unclosed ``` somewhere.
    const fences = content.match(/^```/gm) || [];
    if (fences.length % 2 !== 0) {
      const lines = content.split("\n");
      const lastFenceLine = lines.reduce((acc, ln, i) => (/^```/.test(ln) ? i + 1 : acc), 0);
      errors.push({
        kind: "runtime-error",
        file: path.join(branchPath, path.relative(branchDir, mdAbs)),
        line: lastFenceLine || 1,
        column: 1,
        message: `Unclosed fenced code block (found ${fences.length} fence markers — expected an even number)`,
        context: "(the last ``` is missing a matching close. Add a ``` on its own line to close the block.)",
        raw: null,
      });
    }
  }

  if (errors.length === 0) return { ok: true };
  return { ok: false, errors };
}

// ─────────────────────────────────────────────────────────────────────
// NET HELPERS
// ─────────────────────────────────────────────────────────────────────

/**
 * Find a free port in the smoke range by probing bind. Returns null if
 * nothing's free (operator is running 100+ smoke tests concurrently?
 * unlikely but fail-gracefully).
 */
export async function allocateSmokePort() {
  for (let port = SMOKE_PORT_MIN; port <= SMOKE_PORT_MAX; port++) {
    if (await isPortFree(port)) return port;
  }
  return null;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, "127.0.0.1");
  });
}

/**
 * Poll until a port is being listened on (by the child) or timeout.
 * `exitedCheck` short-circuits the poll if the child dies mid-wait.
 */
export async function waitForListening(port, timeoutMs, exitedCheck) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exitedCheck && exitedCheck()) return false;
    const free = await isPortFree(port);
    if (!free) return true; // something's bound to it — the child
    await sleep(100);
  }
  return false;
}

/**
 * Probe the running child over HTTP. Tries /api/health, then /health,
 * then /. Any non-5xx response counts as a pass. Timeouts count as
 * failures — the server is bound but not responding.
 */
function probeServer(port) {
  const paths = ["/api/health", "/health", "/"];
  return new Promise(async (resolve) => {
    for (const p of paths) {
      const result = await probeOnce(port, p);
      if (result.ok) {
        resolve(result);
        return;
      }
      // 404 on /health is fine, just move on to /
      if (result.status && result.status >= 400 && result.status < 500 && p !== "/") {
        continue;
      }
      // Any other non-ok on the last path (/) is the terminal answer
      if (p === "/") {
        resolve(result);
        return;
      }
    }
    resolve({ ok: false, reason: "all probes failed", method: "GET", url: "/" });
  });
}

export function probeOnce(port, urlPath) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        method: "GET",
        timeout: SERVER_PROBE_TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode || 0;
        res.resume();
        if (status < 500) {
          resolve({ ok: true, status, method: "GET", url: urlPath });
        } else {
          resolve({
            ok: false,
            status,
            reason: `returned ${status}`,
            method: "GET",
            url: urlPath,
          });
        }
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, reason: "probe timed out", method: "GET", url: urlPath });
    });
    req.on("error", (err) => {
      resolve({ ok: false, reason: err.message, method: "GET", url: urlPath });
    });
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────────────
// NPM AUTO-INSTALL
// ─────────────────────────────────────────────────────────────────────

/**
 * Pull the missing module name out of a Node.js error message. Handles
 * both CJS (`Cannot find module 'foo'`) and ESM
 * (`Cannot find package 'foo'` / `ERR_MODULE_NOT_FOUND`) variants.
 * Returns null if the stderr doesn't look like a dependency error.
 */
function detectMissingModule(stderr) {
  if (typeof stderr !== "string" || !stderr) return null;
  const patterns = [
    /Cannot find module '([^']+)'/,
    /Cannot find package '([^']+)'/,
    /ERR_MODULE_NOT_FOUND[^']*'([^']+)'/,
    /Error \[ERR_MODULE_NOT_FOUND\][^'"]*['"]([^'"]+)['"]/,
  ];
  for (const p of patterns) {
    const m = stderr.match(p);
    if (m && m[1]) {
      // Node sometimes reports the resolved file path instead of the
      // package name (e.g. '/abs/path/node_modules/ws/index.js'). Peel
      // it back to the package root if possible.
      let name = m[1];
      const nmIdx = name.indexOf("node_modules/");
      if (nmIdx !== -1) {
        const after = name.slice(nmIdx + "node_modules/".length);
        const seg = after.split("/");
        name = seg[0].startsWith("@") && seg.length >= 2
          ? `${seg[0]}/${seg[1]}`
          : seg[0];
      }
      // Skip relative paths (those are our own code, not a package)
      if (name.startsWith(".") || name.startsWith("/")) continue;
      return name;
    }
  }
  return null;
}

/**
 * Run `npm install` inside the branch directory. Prefers the
 * package.json-driven "install everything declared" when a
 * package.json is present (safest path — installs exactly what the
 * branch author specified). Falls back to installing the specific
 * missing module on its own if no package.json exists (the branch
 * forgot to declare deps but we can still rescue the run).
 *
 * Synchronous spawn via spawnSync so the smoke retry loop is simple.
 * The timeout guard (`NPM_INSTALL_TIMEOUT_MS`) prevents a stuck npm
 * from hanging the whole swarm.
 *
 * Returns { ok, method, stderr?, reason? }.
 */
async function runNpmInstall(branchDir, missingName) {
  const pkgPath = path.join(branchDir, "package.json");
  const hasPkg = fs.existsSync(pkgPath);

  let args;
  let method;
  if (hasPkg) {
    // If the package.json doesn't list the missing module, add it
    // explicitly in the install call so the retry has a chance of
    // actually resolving it.
    let missingDeclared = false;
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      const deps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };
      missingDeclared = Object.prototype.hasOwnProperty.call(deps, missingName);
    } catch {}
    args = missingDeclared ? ["install"] : ["install", missingName];
    method = missingDeclared ? "npm install (declared)" : `npm install ${missingName}`;
  } else {
    args = ["install", missingName];
    method = `npm install ${missingName} (no package.json)`;
  }

  log.info("CodeWorkspace", `📦 Running ${method} in ${branchDir}`);

  let result;
  try {
    result = spawnSync("npm", args, {
      cwd: branchDir,
      encoding: "utf8",
      timeout: NPM_INSTALL_TIMEOUT_MS,
      windowsHide: true,
      env: {
        ...process.env,
        // Silence npm's progress bar (big stderr, no useful info for
        // us) and suppress audit requests (slow + not relevant here).
        npm_config_progress: "false",
        npm_config_audit: "false",
        npm_config_fund: "false",
      },
    });
  } catch (err) {
    return { ok: false, method, reason: err.message };
  }

  if (result.error) {
    return { ok: false, method, reason: result.error.message, stderr: result.stderr || null };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      method,
      reason: `npm exited code=${result.status}`,
      stderr: result.stderr || null,
    };
  }
  return { ok: true, method };
}
