import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { fileURLToPath } from "url";
import User from "../../db/models/user.js";
import log from "../../core/log.js";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(__dirname, "../../../cli/index.js");

const TIMEOUT_MS = 30000;
const MAX_OUTPUT = 8000;

async function requireGod(userId) {
  const user = await User.findById(userId).select("profileType").lean();
  return user?.profileType === "god";
}

export default function getTools() {
  return [
    {
      name: "treeos-cli",
      description: "Execute a TreeOS CLI command on the land server. Runs as the land operator. God-tier only. Examples: 'ext list', 'ext install understanding', 'ext disable solana', 'config set LAND_NAME MyLand', 'protocol'.",
      schema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The CLI command to run (without 'treeos' prefix). e.g. 'ext list', 'ext install blog', 'protocol'",
          },
          userId: { type: "string", description: "Injected by server. Ignore." },
        },
        required: ["command", "userId"],
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      async handler({ command, userId }) {
        if (!await requireGod(userId)) {
          return { content: [{ type: "text", text: "Permission denied. CLI access requires god-tier profile." }] };
        }

        if (!command) {
          return { content: [{ type: "text", text: "No command provided. Example: ext list" }] };
        }

        log.warn("TreeCLI", `${userId} running: treeos ${command.slice(0, 200)}`);

        try {
          const { stdout, stderr } = await execAsync(
            `node ${CLI_PATH} ${command}`,
            { timeout: TIMEOUT_MS, cwd: path.resolve(__dirname, "../../.."), maxBuffer: 1024 * 1024 }
          );

          const out = (stdout || "").slice(0, MAX_OUTPUT);
          const err = (stderr || "").slice(0, MAX_OUTPUT);
          let result = out || "(no output)";
          if (err) result += "\n" + err;

          return { content: [{ type: "text", text: result }] };
        } catch (err) {
          const output = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").slice(0, MAX_OUTPUT);
          return { content: [{ type: "text", text: `CLI failed: ${output}` }] };
        }
      },
    },

    {
      name: "treeos-ext-install",
      description: "Install a TreeOS extension from the registry. God-tier only.",
      schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Extension name to install" },
          version: { type: "string", description: "Optional version (default: latest)" },
          userId: { type: "string", description: "Injected by server. Ignore." },
        },
        required: ["name", "userId"],
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
      async handler({ name: extName, version, userId }) {
        if (!await requireGod(userId)) {
          return { content: [{ type: "text", text: "Permission denied." }] };
        }
        const cmd = version ? `ext install ${extName} ${version}` : `ext install ${extName}`;
        log.warn("TreeCLI", `${userId} installing: ${extName}`);
        try {
          const { stdout } = await execAsync(`node ${CLI_PATH} ${cmd}`, { timeout: TIMEOUT_MS, cwd: path.resolve(__dirname, "../../..") });
          return { content: [{ type: "text", text: stdout.slice(0, MAX_OUTPUT) || "Installed. Restart land to load." }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Install failed: ${err.message}` }] };
        }
      },
    },

    {
      name: "treeos-ext-list",
      description: "List all loaded extensions on this land.",
      schema: {
        type: "object",
        properties: {
          userId: { type: "string", description: "Injected by server. Ignore." },
        },
        required: ["userId"],
      },
      annotations: { readOnlyHint: true },
      async handler({ userId }) {
        try {
          const { getLoadedManifests } = await import("../../extensions/loader.js");
          const manifests = getLoadedManifests();
          const lines = manifests.map(m => `${m.name} v${m.version} . ${m.description || ""}`);
          return { content: [{ type: "text", text: lines.join("\n") || "No extensions loaded." }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err.message}` }] };
        }
      },
    },
  ];
}
