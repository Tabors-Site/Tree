import { z } from "zod";
import { ingest, searchCode, getStatus, cloneRepo, isGitUrl } from "./core.js";
import { runSnippet, runFile, runTests } from "./sandbox.js";
import fs from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// Safe commands for code-run
const ALLOWED_COMMANDS = /^(npm test|npm run|npx|node|python|pytest|go test|cargo test|make|gradle|mvn|jest|mocha|vitest|eslint|prettier|tsc|rustfmt|gofmt|black|flake8|rubocop)/;
const BLOCKED_PATTERNS = /rm\s+-rf|>\s*\/|sudo|chmod|chown|kill|pkill|shutdown|reboot|mkfs|dd\s+if/;

export default function getTools() {
  return [
    {
      name: "code-ingest",
      description: "Ingest a codebase into the tree. Directories become nodes. Files become notes. Respects .gitignore.",
      schema: {
        path: z.string().describe("Local path or git URL (https://github.com/user/repo) to ingest"),
      },
      annotations: { readOnlyHint: false },
      async handler({ path: inputPath, userId, nodeId }) {
        if (!inputPath) return { content: [{ type: "text", text: "Path or URL required." }] };
        if (!nodeId) return { content: [{ type: "text", text: "Not in a tree position." }] };

        const Node = (await import("../../seed/models/node.js")).default;
        const node = await Node.findById(nodeId).select("_id name metadata").lean();
        if (!node) return { content: [{ type: "text", text: "Node not found." }] };

        let dirPath = inputPath;
        let clonedDir = null;
        let source = inputPath;

        // Clone if it's a git URL
        if (isGitUrl(inputPath)) {
          try {
            clonedDir = await cloneRepo(inputPath);
            dirPath = clonedDir;
            source = inputPath;
          } catch (err) {
            return { content: [{ type: "text", text: `Clone failed: ${err.message}` }] };
          }
        }

        try {
          const stats = await ingest(nodeId, dirPath, userId);

          // Mark root as code-initialized
          await Node.updateOne({ _id: nodeId }, {
            $set: {
              "metadata.codebase": {
                initialized: true,
                ingestedAt: new Date().toISOString(),
                path: dirPath,
                source,
                fileCount: stats.files,
                dirCount: stats.dirs,
                totalLines: stats.lines,
                skipped: stats.skipped,
              },
              "metadata.modes.respond": "tree:code-browse",
            },
          });

          return {
            content: [{ type: "text", text: `Ingested: ${stats.files} files, ${stats.dirs} directories, ${stats.lines} lines. ${stats.skipped} skipped.` }],
          };
        } finally {
          // Clean up cloned repo
          if (clonedDir) {
            await fs.rm(clonedDir, { recursive: true, force: true }).catch(() => {});
          }
        }
      },
    },

    {
      name: "code-search",
      description: "Search for code patterns across the codebase. Returns matching files with context.",
      schema: {
        query: z.string().describe("Search query: function name, variable, text pattern"),
      },
      annotations: { readOnlyHint: true },
      async handler({ query, rootId }) {
        if (!query) return { content: [{ type: "text", text: "Query required." }] };
        if (!rootId) return { content: [{ type: "text", text: "Not in a tree." }] };

        const results = await searchCode(rootId, query);

        if (results.length === 0) {
          return { content: [{ type: "text", text: `No matches for "${query}".` }] };
        }

        const text = results.map(r =>
          `${r.nodeName}/${r.fileName || "?"} (${r.matchCount} matches)\n  ${r.context}`
        ).join("\n\n");

        return { content: [{ type: "text", text }] };
      },
    },

    {
      name: "code-git",
      description: "Read git state: status, diff, log, or blame. Read-only.",
      schema: {
        action: z.enum(["status", "diff", "log", "blame"]).describe("Git action"),
        path: z.string().optional().describe("File path for blame, or repo path"),
      },
      annotations: { readOnlyHint: true },
      async handler({ action, path: filePath, rootId }) {
        // Find the repo path from the code root metadata
        const Node = (await import("../../seed/models/node.js")).default;
        const root = await Node.findById(rootId).select("metadata").lean();
        const meta = root?.metadata instanceof Map ? root.metadata.get("codebase") : root?.metadata?.code;
        const repoPath = meta?.path;
        if (!repoPath) return { content: [{ type: "text", text: "No code repository ingested at this root." }] };

        const commands = {
          status: ["git", ["status", "--short"]],
          diff: ["git", ["diff", "--stat"]],
          log: ["git", ["log", "--oneline", "-20"]],
          blame: filePath ? ["git", ["blame", "--line-porcelain", filePath]] : null,
        };

        const cmd = commands[action];
        if (!cmd) return { content: [{ type: "text", text: `Unknown action: ${action}` }] };

        try {
          const { stdout } = await execFileAsync(cmd[0], cmd[1], {
            cwd: repoPath,
            timeout: 15000,
            maxBuffer: 1024 * 64,
          });
          const output = stdout.slice(0, 8000);
          return { content: [{ type: "text", text: output || "(empty)" }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Git error: ${err.message}` }] };
        }
      },
    },

    {
      name: "code-run",
      description: "Run build/test/lint commands in the code repository. Sanitized: only allows safe commands.",
      schema: {
        command: z.string().describe("Command to run: npm test, eslint src/, etc."),
      },
      annotations: { readOnlyHint: false },
      async handler({ command, rootId }) {
        if (!command) return { content: [{ type: "text", text: "Command required." }] };
        if (!ALLOWED_COMMANDS.test(command)) {
          return { content: [{ type: "text", text: `Command not allowed. Use: npm test, eslint, prettier, etc.` }] };
        }
        if (BLOCKED_PATTERNS.test(command)) {
          return { content: [{ type: "text", text: "Blocked: dangerous pattern detected." }] };
        }

        const Node = (await import("../../seed/models/node.js")).default;
        const root = await Node.findById(rootId).select("metadata").lean();
        const meta = root?.metadata instanceof Map ? root.metadata.get("codebase") : root?.metadata?.code;
        const repoPath = meta?.path;
        if (!repoPath) return { content: [{ type: "text", text: "No code repository ingested at this root." }] };

        const parts = command.split(/\s+/);
        try {
          const { stdout, stderr } = await execFileAsync(parts[0], parts.slice(1), {
            cwd: repoPath,
            timeout: 30000,
            maxBuffer: 1024 * 64,
          });
          const output = (stdout + (stderr ? "\nSTDERR:\n" + stderr : "")).slice(0, 8000);
          return { content: [{ type: "text", text: output || "(no output)" }] };
        } catch (err) {
          const output = ((err.stdout || "") + "\n" + (err.stderr || "")).slice(0, 8000);
          return { content: [{ type: "text", text: `Exit ${err.code || "error"}:\n${output}` }] };
        }
      },
    },

    {
      name: "code-sandbox",
      description: "Run a JavaScript/Node.js code snippet in an isolated sandbox. No network, no filesystem, no secrets. 30s timeout, 128MB memory. Use for validation, experiments, quick tests.",
      schema: {
        code: z.string().describe("JavaScript code to execute"),
      },
      annotations: { readOnlyHint: false },
      async handler({ code, rootId }) {
        if (!code) return { content: [{ type: "text", text: "Code required." }] };

        const Node = (await import("../../seed/models/node.js")).default;
        const root = rootId ? await Node.findById(rootId).select("metadata").lean() : null;
        const meta = root?.metadata instanceof Map ? root.metadata.get("codebase") : root?.metadata?.code;
        const cwd = meta?.path || null;

        const result = await runSnippet(code, cwd);

        const status = result.success ? "OK" : "FAILED";
        const text = `[${status}] ${result.durationMs}ms\n${result.output}${result.error ? "\nError: " + result.error : ""}`;
        return { content: [{ type: "text", text }] };
      },
    },

    {
      name: "code-test",
      description: "Run the repository's test suite. Auto-detects test runner (npm test, jest, vitest, pytest, cargo test, go test). Returns pass/fail results.",
      schema: {},
      annotations: { readOnlyHint: true },
      async handler({ rootId }) {
        const Node = (await import("../../seed/models/node.js")).default;
        const root = await Node.findById(rootId).select("metadata").lean();
        const meta = root?.metadata instanceof Map ? root.metadata.get("codebase") : root?.metadata?.code;
        const repoPath = meta?.path;
        if (!repoPath) return { content: [{ type: "text", text: "No code repository ingested at this root." }] };

        const result = await runTests(repoPath);

        const status = result.success ? "PASS" : "FAIL";
        const runner = result.runner ? ` (${result.runner})` : "";
        const text = `[${status}]${runner} ${result.durationMs}ms\n${result.output}${result.error ? "\nError: " + result.error : ""}`;
        return { content: [{ type: "text", text }] };
      },
    },

    {
      name: "code-run-file",
      description: "Run a specific file in the sandbox. For test files, scripts, or any executable code file.",
      schema: {
        file: z.string().describe("Relative path to the file within the repo (e.g. tests/auth.test.js)"),
      },
      annotations: { readOnlyHint: false },
      async handler({ file, rootId }) {
        if (!file) return { content: [{ type: "text", text: "File path required." }] };

        const Node = (await import("../../seed/models/node.js")).default;
        const root = await Node.findById(rootId).select("metadata").lean();
        const meta = root?.metadata instanceof Map ? root.metadata.get("codebase") : root?.metadata?.code;
        const repoPath = meta?.path;
        if (!repoPath) return { content: [{ type: "text", text: "No code repository ingested at this root." }] };

        const { default: path } = await import("path");
        const fullPath = path.resolve(repoPath, file);

        // Prevent path traversal
        if (!fullPath.startsWith(repoPath)) {
          return { content: [{ type: "text", text: "Path traversal blocked." }] };
        }

        const result = await runFile(fullPath, repoPath);

        const status = result.success ? "OK" : "FAILED";
        const text = `[${status}] ${result.durationMs}ms\n${result.output}${result.error ? "\nError: " + result.error : ""}`;
        return { content: [{ type: "text", text }] };
      },
    },
  ];
}
