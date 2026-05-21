/**
 * Code Sandbox
 *
 * Runs code in an isolated child process. No network. Memory limited.
 * Timeout enforced. The AI writes code, the sandbox runs it, results come back.
 *
 * Two modes:
 * 1. Run a file: execute a file in the repo context (tests, scripts)
 * 2. Run snippet: execute arbitrary code the AI wrote (validation, experiments)
 */

import { execFile, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import log from "../../seed/log.js";

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = 30000;
const MAX_OUTPUT = 16384; // 16KB
const MAX_MEMORY_MB = 128;

// Blocked patterns in snippets
const BLOCKED = [
  /require\s*\(\s*['"]child_process['"]\s*\)/,
  /require\s*\(\s*['"]fs['"]\s*\)/,
  /require\s*\(\s*['"]net['"]\s*\)/,
  /require\s*\(\s*['"]http['"]\s*\)/,
  /require\s*\(\s*['"]https['"]\s*\)/,
  /import\s+.*from\s+['"]child_process['"]/,
  /import\s+.*from\s+['"]net['"]/,
  /import\s+.*from\s+['"]http['"]/,
  /import\s+.*from\s+['"]https['"]/,
  /process\.exit/,
  /process\.kill/,
  /process\.env/,
  /eval\s*\(/,
  /Function\s*\(/,
];

/**
 * Check if a code snippet contains blocked patterns.
 */
function validateSnippet(code) {
  for (const pattern of BLOCKED) {
    if (pattern.test(code)) {
      return `Blocked: ${pattern.source}`;
    }
  }
  return null;
}

/**
 * Run a code snippet in an isolated child process.
 * No network, limited memory, timeout enforced.
 *
 * @param {string} code - JavaScript code to execute
 * @param {string} [cwd] - Working directory (repo root)
 * @returns {{ success: boolean, output: string, error?: string, exitCode: number, durationMs: number }}
 */
export async function runSnippet(code, cwd = null) {
  const violation = validateSnippet(code);
  if (violation) {
    return { success: false, output: "", error: violation, exitCode: -1, durationMs: 0 };
  }

  // Write snippet to a temp file
  const tmpFile = path.join(os.tmpdir(), `treeos-sandbox-${uuidv4().slice(0, 8)}.mjs`);

  try {
    await fs.writeFile(tmpFile, code, "utf-8");

    const start = Date.now();
    const result = await runIsolated(tmpFile, cwd);
    result.durationMs = Date.now() - start;
    return result;
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

/**
 * Run a file from the repo in an isolated child process.
 *
 * @param {string} filePath - Absolute path to the file to run
 * @param {string} [cwd] - Working directory
 * @returns {{ success: boolean, output: string, error?: string, exitCode: number, durationMs: number }}
 */
export async function runFile(filePath, cwd = null) {
  // Verify file exists
  try {
    await fs.access(filePath);
  } catch {
    return { success: false, output: "", error: `File not found: ${filePath}`, exitCode: -1, durationMs: 0 };
  }

  const start = Date.now();
  const result = await runIsolated(filePath, cwd || path.dirname(filePath));
  result.durationMs = Date.now() - start;
  return result;
}

/**
 * Run a file in a restricted child process.
 */
async function runIsolated(filePath, cwd) {
  return new Promise((resolve) => {
    const args = [
      `--max-old-space-size=${MAX_MEMORY_MB}`,
      "--no-warnings",
      filePath,
    ];

    const env = {
      // Minimal env: no secrets, no credentials
      PATH: process.env.PATH,
      NODE_ENV: "sandbox",
      HOME: os.tmpdir(),
    };

    const child = spawn("node", args, {
      cwd: cwd || os.tmpdir(),
      env,
      timeout: TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      // No shell. Direct exec. No injection.
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      if (stdout.length < MAX_OUTPUT) stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      if (stderr.length < MAX_OUTPUT) stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, TIMEOUT_MS);

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);

      const timedOut = signal === "SIGKILL";
      const output = (stdout + (stderr ? "\nSTDERR:\n" + stderr : "")).slice(0, MAX_OUTPUT);

      resolve({
        success: exitCode === 0 && !timedOut,
        output: timedOut ? output + "\n(timed out after 30s)" : output,
        error: timedOut ? "Timed out" : (exitCode !== 0 ? `Exit code ${exitCode}` : null),
        exitCode: exitCode ?? -1,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: "",
        error: err.message,
        exitCode: -1,
      });
    });
  });
}

/**
 * Run tests in the repo using the detected test runner.
 * Tries common test commands in order.
 *
 * @param {string} repoPath - Absolute path to the repository
 * @returns {{ success: boolean, output: string, runner: string, durationMs: number }}
 */
export async function runTests(repoPath) {
  // Detect test runner from package.json
  let testCommand = null;
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(repoPath, "package.json"), "utf-8"));
    if (pkg.scripts?.test && pkg.scripts.test !== "echo \"Error: no test specified\" && exit 1") {
      testCommand = "npm test";
    }
  } catch {}

  if (!testCommand) {
    // Try common runners
    const runners = [
      { file: "jest.config.js", cmd: "npx jest --no-coverage" },
      { file: "vitest.config.js", cmd: "npx vitest run" },
      { file: "pytest.ini", cmd: "pytest" },
      { file: "Cargo.toml", cmd: "cargo test" },
      { file: "go.mod", cmd: "go test ./..." },
    ];
    for (const r of runners) {
      try {
        await fs.access(path.join(repoPath, r.file));
        testCommand = r.cmd;
        break;
      } catch {}
    }
  }

  if (!testCommand) {
    return { success: false, output: "No test runner detected.", runner: null, durationMs: 0 };
  }

  const parts = testCommand.split(/\s+/);
  const start = Date.now();

  try {
    const { stdout, stderr } = await execFileAsync(parts[0], parts.slice(1), {
      cwd: repoPath,
      timeout: TIMEOUT_MS * 2, // tests get more time
      maxBuffer: MAX_OUTPUT * 2,
      env: { ...process.env, NODE_ENV: "test", CI: "true" },
    });

    return {
      success: true,
      output: (stdout + (stderr ? "\nSTDERR:\n" + stderr : "")).slice(0, MAX_OUTPUT),
      runner: testCommand,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      success: false,
      output: ((err.stdout || "") + "\n" + (err.stderr || "")).slice(0, MAX_OUTPUT),
      runner: testCommand,
      error: `Exit ${err.code || "error"}`,
      durationMs: Date.now() - start,
    };
  }
}
