import { z } from "zod";
import { exec } from "child_process";
import { promisify } from "util";
import User from "../../db/models/user.js";
import log from "../../core/log.js";

const execAsync = promisify(exec);
const TIMEOUT_MS = 30000;
const MAX_OUTPUT = 8000;

export default function getTools() {
  return [
    {
      name: "execute-shell",
      description: "Execute a shell command on the land server. Returns stdout and stderr. God-tier users only. 30 second timeout.",
      schema: {
        command: z.string().describe("The shell command to execute."),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
      async handler({ command, userId }) {
        const user = await User.findById(userId).select("profileType").lean();
        if (!user || user.profileType !== "god") {
          return { content: [{ type: "text", text: "Permission denied. Shell access requires god-tier profile." }] };
        }
        if (!command) {
          return { content: [{ type: "text", text: "No command provided." }] };
        }

        log.warn("Shell", `${userId} executing: ${command.slice(0, 200)}`);

        try {
          const { stdout, stderr } = await execAsync(command, {
            timeout: TIMEOUT_MS,
            cwd: process.cwd(),
            maxBuffer: 1024 * 1024,
          });
          const out = (stdout || "").slice(0, MAX_OUTPUT);
          const err = (stderr || "").slice(0, MAX_OUTPUT);
          let result = out || "(no output)";
          if (err) result += "\n--- stderr ---\n" + err;
          return { content: [{ type: "text", text: result }] };
        } catch (err) {
          const output = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").slice(0, MAX_OUTPUT);
          return { content: [{ type: "text", text: `Command failed (exit ${err.code || "?"})\n${output}` }] };
        }
      },
    },
  ];
}
