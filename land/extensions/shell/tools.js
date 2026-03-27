import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import User from "../../seed/models/user.js";
import log from "../../seed/log.js";

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 30000;
const MAX_OUTPUT = 8000;

let _useEnergy = async () => ({ energyUsed: 0 });

export function setEnergyService(energy) {
  if (energy?.useEnergy) _useEnergy = energy.useEnergy;
}

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
        const user = await User.findById(userId).select("isAdmin").lean();
        if (!user || !user.isAdmin) {
          return { content: [{ type: "text", text: "Permission denied. Shell access requires admin." }] };
        }
        if (!command) {
          return { content: [{ type: "text", text: "No command provided." }] };
        }

        // Block dangerous commands
        const BLOCKED = [
          /\brm\s+.*-[a-zA-Z]*r/i,        // rm -r, rm -rf, rm -fr
          /\brm\s+.*\//,                   // rm with any path
          /\brmdir\b/i,                    // rmdir
          /\bmkfs\b/i,                     // format filesystem
          /\bdd\s+/i,                      // disk destroy
          /\b:\(\)\{.*\|.*\}/,             // fork bomb
          /\bchmod\s+(777|000|\+s)\b/,     // dangerous permission changes
          /\bchown\b/i,                    // any ownership change
          />\s*\/dev\/sd/,                 // overwrite disk devices
          /\bshutdown\b/i,                // shutdown
          /\breboot\b/i,                  // reboot
          /\binit\s+[06]\b/,              // init shutdown/reboot
          /\bsystemctl\s+(stop|disable|mask|restart)\b/i, // stop/restart services
          /\bkill\s+-9\s+1\b/,            // kill init
          /\biptables\s+-F\b/i,           // flush firewall
          /\bufw\s+(disable|reset)\b/i,   // disable firewall
          /\bpasswd\b/i,                  // change passwords
          /\busermod\b/i,                 // modify users
          /\buserdel\b/i,                 // delete users
          /\bcurl\b.*\|\s*(bash|sh)\b/i,  // pipe to shell
          /\bwget\b.*\|\s*(bash|sh)\b/i,  // pipe to shell
          /\beval\b/i,                    // eval execution
          /`[^`]*`/,                      // backtick command substitution
          /\$\([^)]*\)/,                  // $() command substitution
        ];

        const blocked = BLOCKED.find(re => re.test(command));
        if (blocked) {
          log.warn("Shell", `BLOCKED dangerous command from ${userId}: ${command.slice(0, 200)}`);
          return { content: [{ type: "text", text: "Blocked: this command pattern is not allowed for safety. Use the server directly for destructive operations." }] };
        }

        // Energy metering
        try {
          await _useEnergy({ userId, action: "shellExecute" });
        } catch {
          return { content: [{ type: "text", text: "Insufficient energy for shell execution." }] };
        }

        log.warn("Shell", `${userId} executing: ${command.slice(0, 200)}`);

        // Execute via /bin/sh -c but with execFile (no double shell interpretation).
        // execFile with explicit shell path avoids the implicit shell spawning of exec().
        // The command is passed as a single argument to sh -c, not interpreted by Node.
        try {
          const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", command], {
            timeout: TIMEOUT_MS,
            cwd: process.cwd(),
            maxBuffer: 1024 * 1024,
            env: { ...process.env, PATH: process.env.PATH },
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
