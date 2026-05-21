/**
 * code-workspace sandbox.
 *
 * Spawns allowed binaries inside a project's workspace directory. cwd is
 * locked to the workspace via realpath+startsWith, env is stripped, and
 * output is capped. Only node / npm / npx / git and anything under
 * <workspace>/node_modules/.bin/ can run.
 *
 * This is the narrower cousin of codebase/sandbox.js. It persists across
 * calls (unlike code snippet execution), runs real tools against real files,
 * but still refuses anything outside the whitelist.
 */

import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

export const DEFAULTS = {
  snippetMs: 30_000,
  buildMs: 120_000,
  testMs: 300_000,
  installMs: 300_000,
  outputBytes: 64 * 1024,
  memoryMb: 512,
};

const ALLOWED_BINARIES = new Set(["node", "npm", "npx", "git"]);

function envFor(workspacePath) {
  return {
    PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: path.join(workspacePath, ".home"),
    NODE_ENV: "sandbox",
    CI: "true",
    npm_config_cache: path.join(workspacePath, ".npm-cache"),
    npm_config_ignore_scripts: "true",
  };
}

async function ensureWorkspace(workspacePath) {
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(path.join(workspacePath, ".home"), { recursive: true });
}

function withinWorkspace(workspacePath, target) {
  const root = path.resolve(workspacePath) + path.sep;
  const res = path.resolve(target);
  return res === path.resolve(workspacePath) || res.startsWith(root);
}

/**
 * Run a binary inside the workspace dir. Returns { exitCode, stdout,
 * stderr, timedOut, durationMs }.
 */
export async function runInWorkspace({
  workspacePath,
  binary,
  args = [],
  timeoutMs = DEFAULTS.buildMs,
  outputCap = DEFAULTS.outputBytes,
}) {
  if (!workspacePath) throw new Error("workspacePath required");
  if (!binary || typeof binary !== "string") throw new Error("binary required");

  const directAllowed = ALLOWED_BINARIES.has(binary);
  let resolved = binary;
  if (!directAllowed) {
    // Allow anything under <workspace>/node_modules/.bin/
    const binDir = path.join(workspacePath, "node_modules", ".bin");
    const candidate = path.join(binDir, binary);
    try {
      await fs.access(candidate);
      if (!withinWorkspace(workspacePath, candidate)) {
        throw new Error(`resolved binary escaped workspace: ${candidate}`);
      }
      resolved = candidate;
    } catch {
      throw new Error(
        `binary "${binary}" not allowed. Allowed: ${[...ALLOWED_BINARIES].join(", ")} or <workspace>/node_modules/.bin/*`,
      );
    }
  }

  await ensureWorkspace(workspacePath);

  const start = Date.now();
  return new Promise((resolve) => {
    const nodeArgs = resolved === "node" ? [`--max-old-space-size=${DEFAULTS.memoryMb}`, ...args] : args;
    const child = spawn(resolved, nodeArgs, {
      cwd: workspacePath,
      env: envFor(workspacePath),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (d) => {
      if (stdout.length < outputCap) stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      if (stderr.length < outputCap) stderr += d.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: exitCode ?? -1,
        signal,
        stdout: stdout.slice(0, outputCap),
        stderr: stderr.slice(0, outputCap),
        timedOut: timedOut || signal === "SIGKILL",
        durationMs: Date.now() - start,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        signal: null,
        stdout: "",
        stderr: err.message,
        timedOut: false,
        durationMs: Date.now() - start,
      });
    });
  });
}
