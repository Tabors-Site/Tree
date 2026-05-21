/**
 * Behavioral test runner — phase 4 of the validator pipeline.
 *
 * The previous phases (syntax, contracts, smoke, integration) all
 * verify that the code is well-formed and structurally connected, but
 * none of them prove the code actually DOES the right thing. Empty-
 * shell apps slip through: server boots, frontend loads, contracts
 * match, every probe returns 200 — and yet the buttons don't work
 * because every handler silently no-ops on uninitialized state.
 *
 * Phase 4 closes the loop by having the model write its own behavioral
 * tests against the spec, then running those tests as the final
 * validation gate. The test file lives at `tests/spec.test.js` (or
 * any `tests/*.test.js`) at the project root and uses plain
 * `node:assert` — no framework dependency.
 *
 * The convention is intentionally minimal. The model writes:
 *
 *   import assert from 'node:assert/strict';
 *   import { test } from 'node:test';
 *
 *   test('user can join a room', async () => {
 *     // spawn the server, connect, send join, expect ack
 *     ...
 *   });
 *
 * `node --test tests/` runs every test file. We capture stdout/stderr,
 * parse the TAP output for failures, and return them as structured
 * issues. Any non-zero exit OR any failed test = ok: false.
 *
 * Why node:test (built-in) instead of jest/mocha
 * ──────────────────────────────────────────────
 *   - Zero install — works on any node ≥18 out of the box
 *   - TAP output is easy to parse without a framework dependency
 *   - The model can lean on the built-in pattern instead of guessing
 *     which framework is set up
 *   - One less thing to npm install in every workspace
 *
 * Failure shape
 * ─────────────
 * Each failure becomes a `{kind, file, line, column, message, ...}`
 * object the cascade renderer formats into a readable correction
 * instruction. The TAP parser extracts the test name, error message,
 * expected/actual, and stack trace.
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import log from "../../../seed/log.js";

const TEST_TIMEOUT_MS = 60000;
const STDERR_RING = 400;

/**
 * Main entry. Looks for a tests/ directory at the project workspace
 * root, runs every test file under it via `node --test`, parses the
 * TAP output, and returns structured failures.
 *
 *   runBehavioralTests({ workspaceRoot })
 *     → { ok: true, ran: 5 }                    // all green
 *     → { ok: true, skipped: true, reason }     // no tests dir
 *     → { ok: false, failures: [...] }          // parse failures
 */
export async function runBehavioralTests({ workspaceRoot, projectNode, core }) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    return { ok: true, skipped: true, reason: "no workspaceRoot" };
  }

  const testsDir = path.join(workspaceRoot, "tests");
  if (!fs.existsSync(testsDir)) {
    return {
      ok: true,
      skipped: true,
      reason: "no tests/ directory at project root",
    };
  }

  // Find any test files. node --test will recurse, but we want to
  // detect "no test files" upfront and return a meaningful skip.
  const testFiles = findTestFiles(testsDir);
  if (testFiles.length === 0) {
    return {
      ok: true,
      skipped: true,
      reason: "tests/ exists but contains no *.test.js files",
    };
  }

  // Before running anything, lint the test files themselves to catch
  // the #1 failure mode we keep seeing: the model writes tests that
  // reimplement the server inside the test file (inline routes, a
  // fresh Express app, a parallel state map) and then passes green
  // while the real server stays broken. This is a fake test — it
  // validates a parallel reality, not the real code. Reject before
  // running so the model gets a clear instruction to fix the test.
  const lintIssues = lintTestFiles(testFiles, workspaceRoot);
  if (lintIssues.length > 0) {
    return {
      ok: false,
      failures: lintIssues,
    };
  }

  log.info("CodeWorkspace", `🧪 Running ${testFiles.length} behavioral test file(s) for project at ${workspaceRoot}`);

  // Spawn the REAL preview before running tests. The preview is the
  // actual server.js the model built, running on a dedicated port.
  // Tests that read PREVIEW_URL fetch against it. Tests that import
  // server.js directly still work — they just don't need the env var.
  // Best-effort: if the preview can't be started, we still run the
  // tests (they may self-import the server) and report as usual.
  let previewUrl = null;
  let startedPreview = null;
  if (projectNode) {
    try {
      const { startPreview, stopPreview } = await import("../serve/spawner.js");
      startedPreview = await startPreview({
        projectNode,
        workspacePath: workspaceRoot,
      });
      if (startedPreview?.port) {
        previewUrl = `http://127.0.0.1:${startedPreview.port}`;
        log.info("CodeWorkspace", `🧪 Tests will use PREVIEW_URL=${previewUrl}`);
        // Give the child a beat to actually start listening
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch (startErr) {
      log.warn("CodeWorkspace", `Behavioral tests: preview spawn failed (non-fatal): ${startErr.message}`);
    }
  }

  // Run node --test against the tests directory. Pipe stdout/stderr
  // for parsing. Use the workspace as cwd so test files can resolve
  // ../server/..., ../client/... etc.
  const result = await runNodeTest(workspaceRoot, previewUrl);

  if (result.timedOut) {
    return {
      ok: false,
      failures: [{
        kind: "test-failure",
        severity: "error",
        file: "tests/",
        line: 1,
        column: 1,
        message: `Test runner exceeded ${TEST_TIMEOUT_MS}ms timeout — likely a hanging test or unhandled promise. Check that all server/socket cleanup runs in test teardown.`,
        stack: result.stderr.slice(-1500),
        appOutput: result.stdout.slice(-800),
      }],
    };
  }

  if (result.spawnError) {
    return {
      ok: false,
      failures: [{
        kind: "test-failure",
        severity: "error",
        file: "tests/",
        line: 1,
        column: 1,
        message: `Could not run node --test: ${result.spawnError}`,
        stack: null,
      }],
    };
  }

  const failures = parseTAPFailures(result.stdout, result.stderr);

  if (result.exitCode === 0 && failures.length === 0) {
    return { ok: true, ran: testFiles.length };
  }

  // Exit code non-zero, possibly with parse-able failures
  if (failures.length === 0) {
    // No structured failures but still failed — surface raw output
    return {
      ok: false,
      failures: [{
        kind: "test-failure",
        severity: "error",
        file: "tests/",
        line: 1,
        column: 1,
        message: `Test runner exited code=${result.exitCode} but produced no parseable failure (raw stderr below)`,
        stack: result.stderr.slice(-1500),
        appOutput: result.stdout.slice(-800),
      }],
    };
  }

  return { ok: false, failures };
}

// ─────────────────────────────────────────────────────────────────────
// FILE DISCOVERY
// ─────────────────────────────────────────────────────────────────────

/**
 * Recursively find *.test.js / *.test.mjs files under tests/. Caps at
 * 50 files because if you have more than that, something's wrong.
 */
function findTestFiles(testsDir) {
  const out = [];
  function walk(dir, depth) {
    if (depth > 4) return;
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
      } else if (entry.isFile() && /\.test\.[cm]?js$/.test(entry.name)) {
        out.push(full);
        if (out.length >= 50) return;
      }
    }
  }
  walk(testsDir, 0);
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// TEST FILE LINTER — reject fake tests before running
// ─────────────────────────────────────────────────────────────────────

/**
 * Scan each test file for patterns that indicate a fake test — one
 * that reimplements the server inline instead of exercising the real
 * app. The failure modes we catch:
 *
 *   1. Test declares its own routes
 *      `app.post(...)` / `router.get(...)` / `expressApp.X(...)`
 *      → the test is building a parallel server and testing that.
 *      The bugs in the REAL server survive because nothing touches it.
 *
 *   2. Test doesn't import or spawn the real server
 *      No `import ... from '../server.js'`, no `spawn('node', ['server.js'...])`,
 *      no `fetch('http://localhost:<PORT>')` against a known port env var.
 *      → the test isn't exercising the real app at all.
 *
 * When a lint issue fires, we return it as a structured test-failure
 * record so the retry loop hands it back to the model as a correction
 * instruction. The message explicitly tells the model what to do:
 * import the server, or spawn it, and delete the parallel routes.
 */
function lintTestFiles(testFiles, workspaceRoot) {
  const issues = [];
  for (const abs of testFiles) {
    let content;
    try {
      content = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const relPath = path.relative(workspaceRoot, abs);

    // Rule A: reject inline route declarations
    const inlineRoutes = [];
    const routeRe = /\b([a-zA-Z_$][\w$]*)\.(get|post|put|patch|delete|use|listen)\s*\(\s*['"`]/g;
    let rm;
    while ((rm = routeRe.exec(content)) !== null) {
      const receiver = rm[1];
      const verb = rm[2];
      // Only flag receivers that look like Express apps/routers
      // AND only if the path starts with / (URL) or the verb is listen
      // — this filters out e.g. `strict.get('...')` or unrelated method
      // calls that happen to use an HTTP verb name.
      if (!/^(app|expressApp|router|server|httpServer|srv|api|mini|testApp)/.test(receiver)) continue;
      // Also check this isn't `app.use(express.static(...))` — that's
      // fine, it's just mounting middleware
      const after = content.slice(rm.index + rm[0].length, rm.index + rm[0].length + 40);
      if (verb === "use" && /^[a-zA-Z_$][\w$]*\s*\(/.test(after)) continue;
      const line = (content.slice(0, rm.index).match(/\n/g) || []).length + 1;
      inlineRoutes.push(`${relPath}:${line} — ${receiver}.${verb}(...)`);
    }

    if (inlineRoutes.length >= 2) {
      // 2+ hits is the "reimplemented the server" smell. A single one
      // might be a legitimate micro-mock for isolated unit testing.
      issues.push({
        kind: "test-failure",
        severity: "error",
        file: relPath,
        line: 1,
        column: 1,
        message:
          `Test file reimplements the server — ${inlineRoutes.length} inline route declarations found. ` +
          `This is a FAKE test: it validates a parallel Express app you built inside the test file, NOT your real server.js. ` +
          `The actual bugs in server.js will pass this test because nothing under test touches them. ` +
          `Rewrite the test to exercise the REAL server: either ` +
          `(a) import from '../server.js' and hit the exported app, ` +
          `or (b) spawn the real server as a child_process and fetch against its port. ` +
          `Delete every app.post/router.get declaration from the test file.`,
        context: inlineRoutes.slice(0, 10).join("\n"),
      });
      continue;  // don't also flag "doesn't exercise real server" for this same file
    }

    // Rule B: test must import or spawn the real server
    const importsRealServer =
      /\bfrom\s+['"`]\.\.?\/(?:\.\.\/)*server(?:\.js)?['"`]/.test(content) ||
      /\bfrom\s+['"`]\.\.?\/(?:\.\.\/)*backend\/server(?:\.js)?['"`]/.test(content) ||
      /\brequire\s*\(\s*['"`]\.\.?\/(?:\.\.\/)*server(?:\.js)?['"`]/.test(content);
    const spawnsRealServer =
      /\bspawn(?:Sync)?\s*\(\s*['"`]node['"`]\s*,\s*\[[^\]]*['"`][^'"`]*server\.js/.test(content) ||
      /\bfork\s*\(\s*['"`][^'"`]*server\.js/.test(content);
    // A weaker signal: the test calls fetch against a hard-coded
    // http://localhost:PORT and doesn't declare its own routes. That's
    // OK if PORT matches the real server's port (3000 by default for
    // code-workspace projects) OR comes from env.
    const fetchesLocalhost =
      /\bfetch\s*\(\s*[`'"]http:\/\/(?:127\.0\.0\.1|localhost):/.test(content) ||
      /\bprocess\.env\.(?:PREVIEW_URL|PORT|APP_URL)\b/.test(content);

    if (!importsRealServer && !spawnsRealServer && !fetchesLocalhost) {
      issues.push({
        kind: "test-failure",
        severity: "error",
        file: relPath,
        line: 1,
        column: 1,
        message:
          `Test file never imports, spawns, or fetches the real server. ` +
          `A test that doesn't touch the actual application code can't detect bugs in it. ` +
          `Do ONE of these: ` +
          `(a) import from '../server.js' and call its exported app/handlers, ` +
          `(b) use child_process.spawn('node', ['../server.js']) to start the real server, then fetch against its port, ` +
          `or (c) set a PREVIEW_URL env var pointing at the running preview and fetch() against it. ` +
          `The test runner will set PREVIEW_URL automatically.`,
        context: null,
      });
    }
  }
  return issues;
}

// ─────────────────────────────────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────────────────────────────────

/**
 * Spawn `node --test tests/` in the workspace and capture its output.
 * Returns { exitCode, stdout, stderr, timedOut, spawnError }.
 *
 * Uses `--test-reporter=tap` explicitly so we get a stable format to
 * parse, regardless of the node version's default reporter.
 */
function runNodeTest(workspaceRoot, previewUrl = null) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        "node",
        ["--test", "--test-reporter=tap", "tests/"],
        {
          cwd: workspaceRoot,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            NODE_ENV: "test",
            // Pass the running preview URL to tests so they can fetch
            // against the real server without having to start their own.
            // Tests that want the URL read process.env.PREVIEW_URL.
            ...(previewUrl ? { PREVIEW_URL: previewUrl } : {}),
          },
        },
      );
    } catch (err) {
      return resolve({ exitCode: -1, stdout: "", stderr: "", spawnError: err.message });
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const stdoutChunks = [];
    const stderrChunks = [];

    child.stdout.on("data", (b) => {
      stdoutChunks.push(b);
      if (stdoutChunks.length > STDERR_RING) stdoutChunks.shift();
    });
    child.stderr.on("data", (b) => {
      stderrChunks.push(b);
      if (stderrChunks.length > STDERR_RING) stderrChunks.shift();
    });

    const killTimer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch {}
    }, TEST_TIMEOUT_MS);

    child.on("exit", (code) => {
      clearTimeout(killTimer);
      stdout = Buffer.concat(stdoutChunks).toString("utf8");
      stderr = Buffer.concat(stderrChunks).toString("utf8");
      resolve({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
      });
    });
    child.on("error", (err) => {
      clearTimeout(killTimer);
      stdout = Buffer.concat(stdoutChunks).toString("utf8");
      stderr = Buffer.concat(stderrChunks).toString("utf8");
      resolve({
        exitCode: -1,
        stdout,
        stderr,
        spawnError: err.message,
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────
// TAP OUTPUT PARSER
// ─────────────────────────────────────────────────────────────────────

/**
 * Parse node --test's TAP output for failed assertions. The TAP format
 * for node:test looks like:
 *
 *   TAP version 13
 *   # Subtest: user can join a room
 *   not ok 1 - user can join a room
 *     ---
 *     duration_ms: 12.5
 *     location: '/abs/path/tests/spec.test.js:14:1'
 *     failureType: 'testCodeFailure'
 *     error: 'Expected values to be strictly equal'
 *     code: 'ERR_ASSERTION'
 *     name: 'AssertionError'
 *     expected: 'sessionId'
 *     actual: undefined
 *     stack: |-
 *       TestContext.<anonymous> (...)
 *     ...
 *
 * We extract one record per `not ok` line, pull the YAML-ish indented
 * block that follows, and return structured failures.
 */
function parseTAPFailures(stdout, stderr) {
  const failures = [];
  if (!stdout) return failures;

  const lines = stdout.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const notOk = line.match(/^not ok\s+\d+\s+-\s+(.+)$/);
    if (!notOk) continue;

    // Skip "subtest" failure aggregations — they double-report the
    // child failure that already got captured below them.
    if (/^# Subtest:/.test(lines[i - 1] || "")) {
      // continue — this is the actual leaf test
    }

    const name = notOk[1].trim();
    const failure = {
      kind: "test-failure",
      severity: "error",
      file: "tests/spec.test.js",
      line: 1,
      column: 1,
      name,
      message: name,
      stack: null,
      expected: undefined,
      actual: undefined,
      appOutput: stderr ? stderr.slice(-500) : null,
    };

    // Walk forward into the YAML-ish block (indented lines)
    let j = i + 1;
    while (j < lines.length && /^\s+/.test(lines[j])) {
      const yamlLine = lines[j].trim();
      const kv = yamlLine.match(/^([a-zA-Z_]+):\s*(.+)$/);
      if (kv) {
        const key = kv[1];
        const value = kv[2].replace(/^['"]/, "").replace(/['"]$/, "").replace(/^\|-?$/, "");
        if (key === "error") failure.message = value || failure.message;
        else if (key === "expected") failure.expected = value;
        else if (key === "actual") failure.actual = value;
        else if (key === "location") {
          const locMatch = value.match(/([^:'"]+):(\d+):(\d+)/);
          if (locMatch) {
            failure.file = locMatch[1];
            failure.line = parseInt(locMatch[2], 10);
            failure.column = parseInt(locMatch[3], 10);
          }
        }
      }
      // Stack capture — multi-line block under "stack: |-"
      if (/^stack:/.test(yamlLine)) {
        const stackLines = [];
        let k = j + 1;
        while (k < lines.length && /^\s{4,}/.test(lines[k])) {
          stackLines.push(lines[k].trim());
          k++;
        }
        failure.stack = stackLines.join("\n");
        j = k - 1;
      }
      j++;
    }

    failures.push(failure);
  }

  return failures;
}
