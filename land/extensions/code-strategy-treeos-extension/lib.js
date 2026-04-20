/**
 * Private helpers for the treeos-extension strategy — scaffold templates
 * and the verify check.
 */

export const IDENT_RX = /^[a-z][a-z0-9-]*$/;
export const MODE_KEY_RX = /^[a-z]+:[a-z0-9_-]+$/;

export function manifestSkeleton({ name, description, scope, needs }) {
  const scopeLine = scope === "confined" ? `  scope: "confined",\n` : "";
  const extensionsLine = needs?.extensions?.length
    ? `    extensions: [${needs.extensions.map((e) => JSON.stringify(e)).join(", ")}],\n`
    : `    extensions: [],\n`;
  const servicesLine = needs?.services?.length
    ? `    services: [${needs.services.map((e) => JSON.stringify(e)).join(", ")}],\n`
    : `    services: [],\n`;
  return `export default {
  name: ${JSON.stringify(name)},
  version: "0.1.0",
  description: ${JSON.stringify(description || `${name} extension`)},
${scopeLine}
  needs: {
${servicesLine}    models: ["Node"],
${extensionsLine}  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],
  },
};
`;
}

export function indexSkeleton({ name }) {
  return `import log from "../../seed/log.js";

export async function init(core) {
  log.info(${JSON.stringify(name)}, "loaded");

  // core.hooks.register("enrichContext", async ({ context, node, meta }) => {
  //   const data = meta[${JSON.stringify(name)}] || {};
  //   if (Object.keys(data).length > 0) context.${name.replace(/-/g, "_")} = data;
  // }, ${JSON.stringify(name)});

  return {
    // router,
    // tools,
    // modes,
    // modeTools,
    // jobs,
  };
}
`;
}

export function modeSkeleton({ key }) {
  const suffix = key.split(":")[1];
  return `export default {
  name: ${JSON.stringify(key)},
  emoji: "🔹",
  label: ${JSON.stringify(suffix)},
  bigMode: "tree",

  toolNames: [
    // list the MCP tool names this mode can call
  ],

  buildSystemPrompt(ctx = {}) {
    return \`You are a ${suffix} agent for \${ctx.username || "the user"}.\`;
  },
};
`;
}

export function toolSkeleton({ name }) {
  return `import { z } from "zod";

export default [
  {
    name: ${JSON.stringify(name)},
    description: "TODO: describe what this tool does.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false },
    async handler({ userId }) {
      return { content: [{ type: "text", text: ${JSON.stringify(name)} + " ran (no implementation yet)." }] };
    },
  },
];
`;
}

export function verifyScaffold(files) {
  const lookup = new Map();
  for (const f of files || []) lookup.set(f.filePath, f.content || "");

  const manifestFile = [...lookup.keys()].find((p) => p.endsWith("manifest.js"));
  const indexFile = [...lookup.keys()].find((p) => p.endsWith("index.js"));

  const issues = [];
  if (!manifestFile) issues.push("no manifest.js found in project");
  if (!indexFile) issues.push("no index.js found in project");

  if (manifestFile) {
    const content = lookup.get(manifestFile);
    if (!/export\s+default\s*\{/.test(content)) issues.push(`${manifestFile}: missing "export default { ... }" block`);
    if (!/\bname\s*:/.test(content)) issues.push(`${manifestFile}: missing name field`);
    if (!/\bprovides\s*:/.test(content)) issues.push(`${manifestFile}: missing provides block`);
    if (!/\bneeds\s*:/.test(content)) issues.push(`${manifestFile}: missing needs block`);
  }
  if (indexFile) {
    const content = lookup.get(indexFile);
    if (!/export\s+async\s+function\s+init\s*\(/.test(content)) issues.push(`${indexFile}: missing "export async function init(core)"`);
  }

  return { ok: issues.length === 0, manifestFile, indexFile, issues };
}
