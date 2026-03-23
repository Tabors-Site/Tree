import { exec } from "child_process";
import { promisify } from "util";
import User from "../../db/models/user.js";
import log from "../../core/log.js";

const execAsync = promisify(exec);

const TIMEOUT_MS = 30000; // 30 second max per command
const MAX_OUTPUT = 8000; // characters

export default function getTools() {
  return [
    {
      name: "execute-shell",
      description: "Execute a shell command on the land server. Returns stdout and stderr. God-tier users only. 30 second timeout. Use responsibly.",
      schema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute. Runs in the land directory.",
          },
          userId: {
            type: "string",
            description: "Injected by server. Ignore.",
          },
        },
        required: ["command", "userId"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      async handler({ command, userId }) {
        // Verify god tier
        const user = await User.findById(userId).select("profileType").lean();
        if (!user || user.profileType !== "god") {
          return {
            content: [{ type: "text", text: "Permission denied. Shell access requires god-tier profile." }],
          };
        }

        if (!command || typeof command !== "string") {
          return {
            content: [{ type: "text", text: "No command provided." }],
          };
        }

        log.warn("Shell", `${userId} executing: ${command.slice(0, 200)}`);

        try {
          const { stdout, stderr } = await execAsync(command, {
            timeout: TIMEOUT_MS,
            cwd: process.cwd(),
            maxBuffer: 1024 * 1024, // 1MB
          });

          const out = (stdout || "").slice(0, MAX_OUTPUT);
          const err = (stderr || "").slice(0, MAX_OUTPUT);

          let result = "";
          if (out) result += out;
          if (err) result += (result ? "\n--- stderr ---\n" : "") + err;
          if (!result) result = "(no output)";

          return {
            content: [{ type: "text", text: result }],
          };
        } catch (err) {
          const output = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").slice(0, MAX_OUTPUT);
          return {
            content: [{ type: "text", text: `Command failed (exit ${err.code || "?"})\n${output}` }],
          };
        }
      },
    },
  ];
}
