/**
 * Spawn and supervise workspace preview child processes.
 *
 * Security model mirrors code-workspace/sandbox.js:
 *   - Binary whitelist: only `node` (we'll relax to `npx` later if we
 *     need dev servers like vite that shell out). No shell interpretation.
 *   - cwd locked to the workspace directory.
 *   - Env stripped: PATH, HOME (pointed inside the workspace), NODE_ENV,
 *     PORT. No leakage of parent secrets.
 *   - Start command must match `node <file> [args]`. package.json scripts
 *     that do anything fancier are rejected — this is by design. If you
 *     want a complex dev server, write a `start` that's just `node <file>`.
 *   - Child bound to 127.0.0.1 by convention (the child picks; if it
 *     binds to 0.0.0.0 that's the child's choice, but the land's reverse
 *     proxy is what the outside sees). We only proxy 127.0.0.1:<port>.
 *
 * Static mode: when package.json has no `scripts.start` but there's an
 * index.html in `public/` or the project root, we don't spawn anything —
 * the preview server streams the file directly from disk on each request.
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import log from "../../../seed/log.js";
import {
  getEntry,
  setEntry,
  removeEntry,
  slugify,
  allocatePort,
  waitForPortListening,
  allEntries,
} from "./registry.js";

const LOG_RING = 200;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

function readPackageJson(dir) {
  try {
    const p = path.join(dir, "package.json");
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function hasIndexHtml(dir) {
  try {
    return fs.existsSync(path.join(dir, "index.html"));
  } catch {
    return false;
  }
}

// Common subdirectory names where a swarm build might drop server code
// or a static frontend. Searched in order after the workspace root.
const SERVER_SUBDIRS = ["backend", "server", "api", "src", "app"];
const STATIC_SUBDIRS = ["public", "frontend", "client", "dist", "build", "www", "site"];

// Bare entry files we'll spawn with `node <file>` when package.json is
// missing or has no valid scripts.start. Checked in order.
const BARE_ENTRIES = ["server.js", "index.js", "main.js", "app.js"];

function findBareEntry(dir) {
  for (const name of BARE_ENTRIES) {
    try {
      const p = path.join(dir, name);
      if (!fs.existsSync(p)) continue;
      // Skip empty files. A zero-byte entry is almost always a
      // stub that the AI touched during a partial build or an
      // aborted edit — spawning `node <empty-file>` exits cleanly
      // with code 0 and never binds the port, which the probe
      // then times out on. Empty file → not runnable → look past
      // it so the subdir scan can find the real backend/server.js.
      const stat = fs.statSync(p);
      if (!stat.isFile() || stat.size === 0) continue;
      return name;
    } catch {}
  }
  return null;
}

/**
 * Walk the workspace root + any immediate child directory looking for a
 * runnable thing. Returns the first match, preferring a server (has
 * package.json with scripts.start) over a static site. When running a
 * nested server, the child's cwd is the subdir, not the workspace root
 * — so `fs.readFileSync('./data/x.json')` inside the server resolves
 * relative to its own directory.
 *
 * When the workspace has BOTH a server and a static frontend in
 * different subdirs (the common swarm layout: backend/ + frontend/),
 * the returned object includes `fallbackStaticDir`. The proxy serves
 * the frontend files when the server returns 404, so a compound app
 * "just works" without the user having to wire express.static.
 */
function detectKind(workspacePath) {
  // 1. Check the workspace root first. We ONLY accept a root package.json
  // whose `scripts.start` parses as a plain `node <file>` invocation —
  // shell-compound commands like `cd server && npm run start` or
  // `npm-run-all ...` can't be run by the parser and would be rejected
  // at spawn time. Skipping them here (fall through to the subdir scan)
  // is the right move because a root package.json that delegates to a
  // subdir almost always means the REAL entry is in that subdir.
  const rootPkg = readPackageJson(workspacePath);
  if (rootPkg?.scripts?.start && parseStartCommand(rootPkg.scripts.start)) {
    return {
      kind: "server",
      startCmd: rootPkg.scripts.start,
      childCwd: workspacePath,
      fallbackStaticDir: findStaticDir(workspacePath),
    };
  }

  // Bare entry at workspace root: no package.json scripts.start, but a
  // server.js (or index.js / main.js / app.js) is present. Spawn it
  // directly. Common case: AI writes server.js first, package.json second.
  const rootBare = findBareEntry(workspacePath);
  if (rootBare) {
    return {
      kind: "server",
      startCmd: `node ${rootBare}`,
      childCwd: workspacePath,
      fallbackStaticDir: findStaticDir(workspacePath),
    };
  }

  // Server subdirs BEFORE static fallbacks. A project with both a
  // backend/ directory AND a public/index.html is a compound app
  // (swarm-built: one branch writes the server, another writes the
  // static frontend). Previously the static check came first and short-
  // circuited the scan, so the proxy served public/ without ever
  // starting the server — WebSocket connections failed and the app
  // couldn't join rooms. Server subdir wins; the static files are
  // reachable via the fallbackStaticDir path if the server 404s on a
  // path, or via the server's own static middleware if it mounts one.
  for (const sub of SERVER_SUBDIRS) {
    const subDir = path.join(workspacePath, sub);
    if (!fs.existsSync(subDir)) continue;
    const pkg = readPackageJson(subDir);
    if (pkg?.scripts?.start && parseStartCommand(pkg.scripts.start)) {
      return {
        kind: "server",
        startCmd: pkg.scripts.start,
        childCwd: subDir,
        fallbackStaticDir: findStaticDir(workspacePath),
      };
    }
    const bare = findBareEntry(subDir);
    if (bare) {
      return {
        kind: "server",
        startCmd: `node ${bare}`,
        childCwd: subDir,
        fallbackStaticDir: findStaticDir(workspacePath),
      };
    }
  }

  // Root-level static fallbacks (only if no server was found above)
  if (hasIndexHtml(path.join(workspacePath, "public"))) {
    return { kind: "static", staticDir: path.join(workspacePath, "public") };
  }
  if (hasIndexHtml(workspacePath)) {
    return { kind: "static", staticDir: workspacePath };
  }

  // 3. Generic scan: any 1-level child dir with package.json + scripts.start
  try {
    const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      const subDir = path.join(workspacePath, entry.name);
      const pkg = readPackageJson(subDir);
      if (pkg?.scripts?.start && parseStartCommand(pkg.scripts.start)) {
        return {
          kind: "server",
          startCmd: pkg.scripts.start,
          childCwd: subDir,
          fallbackStaticDir: findStaticDir(workspacePath),
        };
      }
    }
  } catch {}

  // 4. Static fallbacks in known static subdirs
  for (const sub of STATIC_SUBDIRS) {
    const subDir = path.join(workspacePath, sub);
    if (hasIndexHtml(subDir)) {
      return { kind: "static", staticDir: subDir };
    }
  }

  // 5. Generic scan: any 1-level child dir with index.html
  try {
    const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      const subDir = path.join(workspacePath, entry.name);
      if (hasIndexHtml(subDir)) {
        return { kind: "static", staticDir: subDir };
      }
    }
  } catch {}

  return null;
}

/**
 * Find a static-file directory adjacent to a server, so the preview
 * proxy can serve HTML/CSS/JS files that the server itself doesn't
 * mount. Checks the known STATIC_SUBDIRS first, then any 1-level
 * subdir with index.html. Returns absolute path or null.
 */
function findStaticDir(workspacePath) {
  for (const sub of STATIC_SUBDIRS) {
    const subDir = path.join(workspacePath, sub);
    if (hasIndexHtml(subDir)) return subDir;
  }
  try {
    const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "node_modules") continue;
      const subDir = path.join(workspacePath, entry.name);
      if (hasIndexHtml(subDir)) return subDir;
    }
  } catch {}
  return null;
}

/**
 * Parse a `node <file> [args]` start command into an args array. Anything
 * else is rejected as unsupported so operators can't accidentally run
 * shells, binaries, or scripts with arbitrary interpreters.
 */
function parseStartCommand(cmd) {
  const m = cmd.match(/^node\s+(\S+)(?:\s+(.+))?$/);
  if (!m) return null;
  const [, scriptFile, extraArgs = ""] = m;
  const args = [scriptFile, ...extraArgs.trim().split(/\s+/).filter(Boolean)];
  return { args };
}

/**
 * Ensure `node_modules` exists and is up to date relative to package.json.
 * Runs `npm install` when package.json declares dependencies and either
 * node_modules is missing, or package.json has been modified more recently
 * than node_modules was last touched.
 *
 * Returns { ok, skipped, output } — output is the combined stdout+stderr
 * of the install, surfaced into the preview's log ring so workspace-logs
 * shows what happened when an install fails.
 *
 * Safe to call repeatedly: the mtime check makes it a no-op on warm
 * workspaces. The install command itself is `npm install --no-audit
 * --no-fund --loglevel=error --prefer-offline` — quiet and cache-friendly.
 */
export async function ensureDepsInstalled(childCwd) {
  try {
    const pkgPath = path.join(childCwd, "package.json");
    if (!fs.existsSync(pkgPath)) return { ok: true, skipped: true, reason: "no package.json" };
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    const hasDeps =
      (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) ||
      (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0);
    if (!hasDeps) return { ok: true, skipped: true, reason: "no dependencies declared" };

    const nmPath = path.join(childCwd, "node_modules");
    const nmExists = fs.existsSync(nmPath);
    if (nmExists) {
      try {
        const pkgMtime = fs.statSync(pkgPath).mtimeMs;
        const nmMtime = fs.statSync(nmPath).mtimeMs;
        if (nmMtime >= pkgMtime) {
          return { ok: true, skipped: true, reason: "node_modules up to date" };
        }
      } catch {
        // Fall through to install on stat failure.
      }
    }

    log.info("CodeServe", `📦 npm install (${childCwd})`);
    const result = await new Promise((resolve) => {
      const child = spawn(
        "npm",
        ["install", "--no-audit", "--no-fund", "--loglevel=error", "--prefer-offline"],
        {
          cwd: childCwd,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME, // real HOME so npm's cache works
            npm_config_cache: path.join(process.env.HOME || "/tmp", ".npm"),
            NODE_ENV: "development",
          },
          stdio: ["ignore", "pipe", "pipe"],
          detached: false,
        },
      );
      let out = "";
      let err = "";
      child.stdout?.on("data", (b) => { out += b.toString(); });
      child.stderr?.on("data", (b) => { err += b.toString(); });
      child.on("error", (e) => {
        resolve({ ok: false, skipped: false, output: `npm spawn failed: ${e.message}` });
      });
      child.on("close", (code) => {
        const combined = [out, err].filter(Boolean).join("\n").trim();
        if (code === 0) {
          // Touch node_modules so the next check sees a fresh mtime.
          try {
            const now = new Date();
            fs.utimesSync(nmPath, now, now);
          } catch {}
          resolve({ ok: true, skipped: false, output: combined || "installed" });
        } else {
          resolve({ ok: false, skipped: false, output: combined || `npm install exited ${code}` });
        }
      });
    });

    if (result.ok) {
      log.info("CodeServe", `📦 npm install ok (${childCwd})`);
    } else {
      log.warn("CodeServe", `📦 npm install FAILED in ${childCwd}:\n${result.output.slice(-800)}`);
    }
    return result;
  } catch (err) {
    return { ok: false, skipped: false, output: `ensureDepsInstalled threw: ${err.message}` };
  }
}

/**
 * Start a preview. Idempotent: if `slug` is already running, returns the
 * existing entry instead of spawning again.
 */
export async function startPreview({ projectNode, workspacePath }) {
  if (!projectNode || !workspacePath) {
    throw new Error("startPreview requires projectNode and workspacePath");
  }
  if (!fs.existsSync(workspacePath)) {
    throw new Error(`Workspace path does not exist: ${workspacePath}`);
  }

  const slug = slugify(projectNode.name || String(projectNode._id), projectNode._id);
  const existing = getEntry(slug);
  if (existing) return existing;

  const detected = detectKind(workspacePath);
  if (!detected) {
    throw new Error(
      `Nothing runnable in ${workspacePath}: no package.json "scripts.start" ` +
      `and no index.html in ./ or ./public/. Write a server.js or an ` +
      `index.html and try again.`,
    );
  }

  if (detected.kind === "static") {
    const entry = {
      slug,
      nodeId: String(projectNode._id),
      kind: "static",
      workspacePath,
      staticDir: detected.staticDir,
      pid: null,
      port: null,
      child: null,
      startedAt: Date.now(),
      lastHit: Date.now(),
      stdout: [],
      stderr: [],
    };
    setEntry(slug, entry);
    log.info("CodeServe", `Static preview ready: ${slug} → ${detected.staticDir}`);
    return entry;
  }

  // kind === "server"
  const parsed = parseStartCommand(detected.startCmd);
  if (!parsed) {
    throw new Error(
      `Unsupported start command: "${detected.startCmd}". Only ` +
      `"node <file> [args]" is allowed for preview spawning.`,
    );
  }

  // Child's cwd comes from detected.childCwd — either the workspace root
  // or a nested server subdir (backend/, server/, etc.). The server's
  // relative file reads (e.g. fs.readFileSync('./data/x.json')) resolve
  // against that directory, which is how a swarm-built project with
  // nested layouts runs correctly.
  const childCwd = detected.childCwd || workspacePath;
  const scriptPath = path.join(childCwd, parsed.args[0]);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Start script not found at ${scriptPath}`);
  }

  // Ensure node_modules exists before spawning. Every time the AI writes
  // a package.json with deps and then a server.js that imports them, the
  // first spawn would fail with ERR_MODULE_NOT_FOUND because nothing
  // ever ran `npm install`. This runs it once, caches via mtime, and
  // surfaces install errors into the preview logs so workspace-logs
  // shows the AI what broke.
  const installResult = await ensureDepsInstalled(childCwd);
  if (!installResult.ok) {
    throw new Error(
      `npm install failed in ${childCwd}:\n${installResult.output || "(no output)"}`,
    );
  }

  const port = await allocatePort();
  // Export every reasonable port env var alias so AI-generated servers
  // work regardless of the convention they picked. Previous runs hit
  // ERR_CONNECTION_REFUSED because a server.js used
  // `process.env.WS_PORT || 8080` and the spawner only set PORT — so
  // the child listened on 8080 while the spawner expected 51000. Now
  // every alias resolves to the same allocated port, the server finds
  // whichever it reads, and the spawner's wait-for-listen hits the
  // correct one.
  const portStr = String(port);
  const env = {
    PATH: process.env.PATH,
    HOME: childCwd,
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

  log.info("CodeServe", `Spawning: node ${parsed.args.join(" ")}  [cwd=${childCwd} port=${port}]${detected.fallbackStaticDir ? ` + static fallback ${detected.fallbackStaticDir}` : ""}`);

  const child = spawn("node", parsed.args, {
    cwd: childCwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const entry = {
    slug,
    nodeId: String(projectNode._id),
    kind: "server",
    workspacePath,
    childCwd,
    staticDir: null,
    fallbackStaticDir: detected.fallbackStaticDir || null,
    pid: child.pid,
    port,
    child,
    startedAt: Date.now(),
    lastHit: Date.now(),
    stdout: [],
    stderr: [],
  };

  child.stdout.on("data", (buf) => {
    const lines = String(buf).split("\n").filter(Boolean);
    entry.stdout.push(...lines);
    if (entry.stdout.length > LOG_RING) {
      entry.stdout.splice(0, entry.stdout.length - LOG_RING);
    }
  });

  child.stderr.on("data", (buf) => {
    const lines = String(buf).split("\n").filter(Boolean);
    entry.stderr.push(...lines);
    if (entry.stderr.length > LOG_RING) {
      entry.stderr.splice(0, entry.stderr.length - LOG_RING);
    }
  });

  child.on("exit", (code, signal) => {
    if (code === 0 || code === null) {
      log.info("CodeServe", `${slug} exited cleanly (code=${code} signal=${signal})`);
    } else {
      // Non-zero exit: surface the captured stderr so the operator
      // (and the resume detector / run page) can see WHY it crashed.
      // Without this, the only signal was "exited code=1" with the
      // actual error message buried in entry.stderr — useless for
      // debugging and invisible to the validator pipeline.
      const tail = (entry.stderr || []).slice(-15).join("\n");
      log.warn(
        "CodeServe",
        `${slug} exited code=${code} signal=${signal}\n${tail || "(no stderr captured)"}`,
      );
    }
    removeEntry(slug);
  });

  child.on("error", (err) => {
    log.error("CodeServe", `${slug} spawn error: ${err.message}`);
    removeEntry(slug);
  });

  setEntry(slug, entry);

  // Wait up to 5s for the child to actually listen.
  const listening = await waitForPortListening(port, 5000);
  if (!listening) {
    log.warn("CodeServe", `${slug} did not listen on port ${port} within 5s (may still be starting)`);
  }

  return entry;
}

/**
 * Stop a preview by slug. Returns true if something was stopped, false
 * if nothing was running under that slug.
 */
export function stopPreview(slug) {
  const entry = getEntry(slug);
  if (!entry) return false;
  if (entry.child) {
    try {
      entry.child.kill("SIGTERM");
    } catch (err) {
      log.warn("CodeServe", `SIGTERM failed on ${slug}: ${err.message}`);
    }
    // Force kill if it hasn't died in 3s.
    const child = entry.child;
    setTimeout(() => {
      try {
        if (!child.killed) child.kill("SIGKILL");
      } catch {}
    }, 3000);
  }
  removeEntry(slug);
  log.info("CodeServe", `Stopped preview: ${slug}`);
  return true;
}

/**
 * Kill every running preview. Called at shutdown so children don't
 * outlive the land process.
 */
export function stopAllPreviews() {
  for (const entry of allEntries()) {
    stopPreview(entry.slug);
  }
}

/**
 * Background reaper. Any preview whose lastHit is older than the idle
 * timeout gets shut down to free its port. Runs every 60s, unref'd so
 * it never keeps the process alive on its own.
 */
export function startIdleReaper() {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const entry of allEntries()) {
      if (now - entry.lastHit > IDLE_TIMEOUT_MS) {
        log.info("CodeServe", `Idle shutdown (${Math.round((now - entry.lastHit) / 1000)}s): ${entry.slug}`);
        stopPreview(entry.slug);
      }
    }
  }, 60 * 1000);
  timer.unref();
  return timer;
}
