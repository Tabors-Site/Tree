import { z } from "zod";
import { defineStrategy, applies } from "../code-workspace/sdk.js";
import {
  IDENT_RX,
  MODE_KEY_RX,
  manifestSkeleton,
  indexSkeleton,
  modeSkeleton,
  toolSkeleton,
  verifyScaffold,
} from "./lib.js";

const CONTEXT_BLOCK = `A TreeOS extension is a folder with two required files: \`manifest.js\`
(declares the name, dependencies, and what it provides) and \`index.js\`
(exports \`async function init(core)\` which wires up hooks, tools, modes,
etc. and returns what the extension provides).

Extensions never modify the kernel. They read and write their own
metadata namespace on nodes via \`core.metadata.setExtMeta\` and they
register hooks to react to lifecycle events. They cannot add fields to
the Node or User schemas.

An extension can declare \`scope: "confined"\` which keeps it inactive
until an operator runs \`ext-allow <name>\` at a tree root. Use confined
scope for anything powerful, destructive, or optional.

Before writing any TreeOS-specific file by hand, source-read at least
one working reference from .source. The fitness extension is a complete
working reference:

  source-read extensions/fitness/manifest.js
  source-read extensions/fitness/index.js
  source-read extensions/fitness/tools.js

Use source-read, not workspace-read-file, for anything under .source.

Four functions you can call.

  treeos-ext-scaffold({ name, description, scope, needsExtensions,
    needsServices }) — write manifest.js + index.js with sensible
    defaults.
  treeos-ext-add-mode({ key }) — add modes/<suffix>.js with the mode
    contract (buildSystemPrompt, toolNames).
  treeos-ext-add-tool({ name }) — add tools.js with one MCP tool
    definition in the standard shape.
  treeos-ext-verify() — verify the scaffold parses and matches the
    manifest + init contract.

After scaffolding, wire what you added into init() by returning
\`{ tools, modeTools, ... }\` from it. The verify function checks the
scaffold is coherent but does not run the extension; that happens
when the operator loads it.`;

function text(s) {
  return { content: [{ type: "text", text: String(s) }] };
}

const strategy = defineStrategy({
  name: "treeos-extension",
  contextBlock: CONTEXT_BLOCK,
  appliesWhen: applies.any(
    applies.specMatches(/\b(treeos\s+extension|build\s+an\s+extension|scaffold\s+.*extension|manifest\.js|init\s*\(\s*core\s*\))/i),
    applies.contractKind(/treeos|extension|manifest/),
  ),
  tools: [
    {
      name: "treeos-ext-scaffold",
      description:
        "Scaffold a new TreeOS extension: writes manifest.js + index.js with " +
        "sensible defaults. Disabled until 'ext-allow <name>' for confined scope.",
      schema: {
        name: z.string().describe("Extension name. Lowercase identifier with hyphens (e.g. 'my-ext')."),
        description: z.string().optional().describe("One-line description."),
        scope: z.enum(["global", "confined"]).optional().describe("'global' (default) or 'confined'."),
        needsExtensions: z.array(z.string()).optional().describe("Other extensions this one depends on."),
        needsServices: z.array(z.string()).optional().describe("Core services required."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false },
      async handler({ writeFile, name, description, scope, needsExtensions, needsServices }) {
        const cleanName = String(name || "").trim();
        if (!IDENT_RX.test(cleanName)) {
          return text(`treeos-ext-scaffold rejected: name "${name}" must be lowercase with hyphens (a-z, 0-9, -)`);
        }
        const manifest = manifestSkeleton({
          name: cleanName,
          description,
          scope,
          needs: { extensions: needsExtensions, services: needsServices },
        });
        const index = indexSkeleton({ name: cleanName });
        const r1 = await writeFile("manifest.js", manifest);
        if (!r1.ok) return text(`treeos-ext-scaffold rejected: ${r1.error}`);
        const r2 = await writeFile("index.js", index);
        if (!r2.ok) return text(`treeos-ext-scaffold rejected: ${r2.error}`);
        return text(
          `Scaffolded extension "${cleanName}" — wrote ${r1.filePath} and ${r2.filePath}. ` +
          `${scope === "confined" ? `Confined scope: run 'ext-allow ${cleanName}' at a tree root to activate.` : "Global scope: active everywhere by default."}`
        );
      },
    },
    {
      name: "treeos-ext-add-mode",
      description: "Add a custom AI mode file to an extension scaffold.",
      schema: {
        key: z.string().describe("Mode key, e.g. 'tree:my-ext-plan'. Must match ^[a-z]+:[a-z0-9_-]+$."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false },
      async handler({ writeFile, key }) {
        const cleanKey = String(key || "").trim();
        if (!MODE_KEY_RX.test(cleanKey)) {
          return text(`treeos-ext-add-mode rejected: key "${key}" must look like 'tree:plan' or 'home:ask'`);
        }
        const suffix = cleanKey.split(":")[1];
        const result = await writeFile(`modes/${suffix}.js`, modeSkeleton({ key: cleanKey }));
        if (!result.ok) return text(`treeos-ext-add-mode rejected: ${result.error}`);
        return text(
          `${result.created ? "Created" : "Updated"} ${result.filePath} — mode "${cleanKey}". ` +
          `Wire it into init() via core.modes.registerMode(${JSON.stringify(cleanKey)}, handler, extName).`
        );
      },
    },
    {
      name: "treeos-ext-add-tool",
      description: "Add an MCP tool file to an extension scaffold.",
      schema: {
        name: z.string().describe("Tool name, kebab-case (e.g. 'my-ext-list')."),
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: false },
      async handler({ writeFile, name }) {
        const cleanName = String(name || "").trim();
        if (!IDENT_RX.test(cleanName)) {
          return text(`treeos-ext-add-tool rejected: name "${name}" must be kebab-case (a-z, 0-9, -)`);
        }
        const result = await writeFile("tools.js", toolSkeleton({ name: cleanName }));
        if (!result.ok) return text(`treeos-ext-add-tool rejected: ${result.error}`);
        return text(
          `${result.created ? "Created" : "Updated"} ${result.filePath} — tool "${cleanName}". ` +
          `Wire it into init() by returning { tools } from your init() function.`
        );
      },
    },
    {
      name: "treeos-ext-verify",
      description:
        "Verify the extension scaffold: manifest.js parses and declares a name, " +
        "index.js exports async init. PASS/FAIL with any missing pieces listed.",
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
        chatId: z.string().nullable().optional().describe("Injected by server. Ignore."),
        sessionId: z.string().nullable().optional().describe("Injected by server. Ignore."),
      },
      annotations: { readOnlyHint: true },
      async handler({ readWorkspaceFiles }) {
        const files = await readWorkspaceFiles();
        if (files.length === 0) return text("treeos-ext-verify: no files in active project");
        const result = verifyScaffold(files);
        if (result.ok) {
          return text(`PASS — extension scaffold looks valid (${result.manifestFile}, ${result.indexFile}).`);
        }
        return text(["FAIL — extension scaffold issues:", ...result.issues.map((i) => "  " + i)].join("\n"));
      },
    },
  ],
});

export async function init() {
  return strategy.toInit();
}
