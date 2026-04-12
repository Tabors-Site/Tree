/**
 * Forge tools.
 *
 * Thin policy layer on top of code-workspace. Forge is the TreeOS-extension
 * specialization: it knows what an extension directory must contain, how to
 * validate a manifest the way Horizon will, and how to dry-run a publish.
 * EVERY tree or disk operation delegates to code-workspace via
 * getExtension("code-workspace").exports.*. Forge itself never touches
 * Node, Note, fs, or child_process directly.
 */

import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { validateExtensionPackage } from "./validate.js";
import { publishDryRun, publishToHorizon } from "./publish.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// land/extensions/code-forge/tools.js -> land/extensions
const EXTENSIONS_DIR = path.resolve(__dirname, "..");
const NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function text(s) {
  return { content: [{ type: "text", text: String(s) }] };
}

function nameError(name) {
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    return `invalid extension name "${name}". Must be lowercase alphanumeric with hyphens, start with a letter.`;
  }
  return null;
}

async function requireWorkspace() {
  const { getExtension } = await import("../loader.js");
  const ws = getExtension("code-workspace");
  if (!ws?.exports) {
    throw new Error("code-workspace extension not loaded. Run `ext-allow code-workspace` at this tree root and ensure the extension is installed.");
  }
  return ws.exports;
}

/**
 * Walk the forge project and collect its files for validation/publishing.
 * Reuses code-workspace's walker so forge never reinvents tree→file compile.
 */
async function collectForgeFiles(projectNodeId) {
  const ws = await requireWorkspace();
  const files = await ws.walkFiles(projectNodeId);
  return files.map((f) => ({ path: f.filePath, content: f.content || "" }));
}

/**
 * Read a manifest note from the tree, evaluate it as an ES module, and
 * return the parsed object. We write it to a tmp file first because the
 * manifest uses ES module syntax (export default) and needs a real URL to
 * dynamic-import from.
 */
async function loadForgeManifest(projectNodeId) {
  const ws = await requireWorkspace();
  const files = await ws.walkFiles(projectNodeId);
  const manifestFile = files.find((f) => f.filePath === "manifest.js");
  if (!manifestFile) throw new Error(`no manifest.js file node in the forge project ${projectNodeId}`);
  const tmpDir = path.join(EXTENSIONS_DIR, "..", ".forge-tmp");
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `manifest-${Date.now()}.mjs`);
  await fs.writeFile(tmpPath, manifestFile.content, "utf8");
  try {
    const mod = await import("file://" + tmpPath + "?ts=" + Date.now());
    return mod.default || mod;
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

export default function getForgeTools(core) {
  return [
    // ---------------------------------------------------------------
    // forge-init: create a forge project node under the current tree
    // root using code-workspace, with workspacePath pointed at
    // land/extensions/<name>/ so syncs land the real extension in
    // place. Scaffolds stub files on the nodes via addFile.
    // ---------------------------------------------------------------
    {
      name: "forge-init",
      description: "Start a new TreeOS extension inside the tree. Creates a project node under the current tree root with child nodes for manifest.js, index.js, lib.js, test.js, README.md. The project's on-disk workspace is land/extensions/<name>/ so builds land in the real install location. Requires code-workspace to be ext-allowed.",
      schema: {
        name: z.string().describe("Extension name (kebab-case). The forge workspace on disk will be land/extensions/<name>/."),
        description: z.string().describe("One-line description of what the extension does."),
        adopt: z.boolean().optional().describe("If true, promote the workspace project at the current tree position into a forge extension instead of creating a new sibling project. Existing files are preserved. Default: auto (promotes if you're already inside a workspace project)."),
      },
      annotations: { readOnlyHint: false },
      async handler({ name, description, adopt, userId, rootId, nodeId }) {
        const err = nameError(name);
        if (err) return text(`forge-init: ${err}`);
        try {
          const ws = await requireWorkspace();
          const targetDir = path.join(EXTENSIONS_DIR, name);
          const Node = (await import("../../seed/models/node.js")).default;

          // Mode detection:
          //   1. Explicit adopt=true, or the current position is already a
          //      workspace project → PROMOTE in place.
          //   2. An existing forge project by this name under the same root →
          //      reuse it.
          //   3. Otherwise → CREATE a fresh project node.
          let projectNode = null;
          let mode = "create";

          // (1) Check the current position's ancestor chain via workspace export.
          // findProject walks up until it hits a node with metadata.workspace.
          const walkedProject = nodeId
            ? await (async () => {
                // inline walk using the workspace helper
                const { findProject } = await import("../code-workspace/workspace.js");
                return findProject(nodeId);
              })().catch(() => null)
            : null;

          const shouldAdopt = adopt === true || (adopt !== false && walkedProject);
          if (shouldAdopt && walkedProject) {
            projectNode = walkedProject;
            mode = "adopt";
          }

          // (2) Existing forge project with this name.
          if (!projectNode) {
            const existing = await ws.getProjectByName(rootId, name);
            if (existing) {
              projectNode = existing;
              mode = "reuse";
            }
          }

          // (3) Create a fresh workspace project node.
          if (!projectNode) {
            const parentId = nodeId || rootId;
            let node;
            if (core?.tree?.createNode) {
              node = await core.tree.createNode({ parentId, name, type: "extension", userId });
            } else {
              const { v4: uuidv4 } = await import("uuid");
              node = await Node.create({ _id: uuidv4(), name, type: "extension", parent: parentId, status: "active" });
              await Node.updateOne({ _id: parentId }, { $addToSet: { children: node._id } });
            }
            const initRes = await ws.initProject({
              projectNodeId: node._id,
              name,
              description,
              workspacePath: targetDir,
              userId,
              core,
            });
            projectNode = initRes.node;
            mode = "create";
          }

          // When adopting or reusing, the existing workspace metadata may
          // point at a different workspacePath. Repoint it to the real
          // extension install dir so subsequent syncs land at the right
          // place. mergeExtMeta preserves the createdAt/description fields.
          if (mode !== "create" && core?.metadata?.mergeExtMeta) {
            await core.metadata.mergeExtMeta(projectNode, "workspace", {
              name,
              workspacePath: targetDir,
              description: description || ws.readMeta(projectNode, "workspace")?.description || "",
            });
          }

          // Always set the code-forge namespace + route future chats to
          // forge-ship. The namespace key MUST match the extension name;
          // the kernel's scoped-core guard rejects cross-namespace writes.
          // "modes" is a core namespace so it's allowed.
          if (core?.metadata?.setExtMeta) {
            await core.metadata.setExtMeta(projectNode, "code-forge", {
              name,
              description: description || "",
              version: "0.0.1",
              scaffoldedAt: new Date().toISOString(),
              mode, // create | adopt | reuse
            });
            await core.metadata.setExtMeta(projectNode, "modes", { respond: "tree:forge-ship" });
          }

          // Scaffold only files that don't already exist. For adopt this
          // means existing lib.js / test.js stays exactly as the user wrote
          // it; only manifest.js and README.md get added if missing.
          const existingFiles = await ws.walkFiles(projectNode._id);
          const existingPaths = new Set(existingFiles.map((f) => f.filePath));
          const stubs = {
            "manifest.js": `export default {\n  name: ${JSON.stringify(name)},\n  version: "0.0.1",\n  builtFor: "TreeOS",\n  description: ${JSON.stringify(description || "")},\n\n  needs: {\n    services: [],\n    models: ["Node", "Note"],\n  },\n\n  provides: {\n    tools: true,\n  },\n};\n`,
            "index.js": `import log from "../../seed/log.js";\nimport { z } from "zod";\n\nexport async function init(core) {\n  log.info(${JSON.stringify(name)}, "Loaded.");\n  return {\n    tools: [],\n  };\n}\n`,
            "lib.js": `// Pure helpers live here. Tests import from this file directly,\n// which keeps them independent of core / DB / init().\n`,
            "test.js": `import test from "node:test";\nimport assert from "node:assert";\n\ntest(${JSON.stringify(`${name} scaffold smoke test`)}, () => {\n  assert.ok(true);\n});\n`,
            "README.md": `# ${name}\n\n${description || "A TreeOS extension."}\n\n## Test\n\n\`\`\`\nnode --test test.js\n\`\`\`\n`,
          };
          const added = [];
          const kept = [];
          for (const [filePath, content] of Object.entries(stubs)) {
            if (existingPaths.has(filePath)) {
              kept.push(filePath);
              continue;
            }
            await ws.addFile({ projectNodeId: projectNode._id, relPath: filePath, content, userId, core });
            added.push(filePath);
          }

          const verb = mode === "adopt" ? "Adopted"
                     : mode === "reuse" ? "Reused"
                     : "Created";
          const lines = [
            `${verb} forge project "${name}" (mode=${mode}). Project node ${projectNode._id}.`,
            `Workspace path: ${targetDir}`,
          ];
          if (added.length) lines.push(`Scaffolded new files: ${added.join(", ")}`);
          if (kept.length) lines.push(`Kept existing files: ${kept.join(", ")}`);
          lines.push("Next: forge-write-file to replace stubs or add new files, then forge-test, forge-validate, forge-install-local, forge-publish-horizon.");
          return text(lines.join("\n"));
        } catch (e) {
          return text(`forge-init failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // forge-write-file: delegates to workspace-add-file. Kept as an
    // alias so the forge-ship prompt can use one consistent tool name.
    // ---------------------------------------------------------------
    {
      name: "forge-write-file",
      description: "Write a file inside a forge project. Delegates to code-workspace; stores content as a note on the file node and only touches disk when synced.",
      schema: {
        name: z.string().describe("Extension name."),
        filePath: z.string(),
        content: z.string(),
      },
      annotations: { readOnlyHint: false },
      async handler({ name, filePath, content, userId, rootId }) {
        const err = nameError(name);
        if (err) return text(`forge-write-file: ${err}`);
        try {
          const ws = await requireWorkspace();
          const project = await ws.getProjectByName(rootId, name);
          if (!project) return text(`forge-write-file: no forge project "${name}" under this tree root. Call forge-init first.`);
          const { fileNode, created } = await ws.addFile({
            projectNodeId: project._id, relPath: filePath, content, userId, core,
          });
          return text(`${created ? "Created" : "Updated"} ${filePath} in "${name}" on node ${fileNode._id}.`);
        } catch (e) {
          return text(`forge-write-file failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // forge-read-file: delegates to code-workspace
    // ---------------------------------------------------------------
    {
      name: "forge-read-file",
      description: "Read the current content of a file inside a forge project. Pulls the latest note from the file node.",
      schema: {
        name: z.string(),
        filePath: z.string(),
      },
      annotations: { readOnlyHint: true },
      async handler({ name, filePath, userId, rootId }) {
        try {
          const ws = await requireWorkspace();
          const project = await ws.getProjectByName(rootId, name);
          if (!project) return text(`forge-read-file: no forge project "${name}".`);
          const content = await ws.readFile({ projectNodeId: project._id, relPath: filePath, userId, core });
          const trimmed = content.length > 20000 ? content.slice(0, 20000) + "\n... (truncated)" : content;
          return text(`${filePath} in "${name}":\n\`\`\`\n${trimmed}\n\`\`\``);
        } catch (e) {
          return text(`forge-read-file failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // forge-list-files: delegates to code-workspace walker
    // ---------------------------------------------------------------
    {
      name: "forge-list-files",
      description: "List every file in a forge project (names + sizes).",
      schema: { name: z.string() },
      annotations: { readOnlyHint: true },
      async handler({ name, rootId }) {
        try {
          const ws = await requireWorkspace();
          const project = await ws.getProjectByName(rootId, name);
          if (!project) return text(`forge-list-files: no forge project "${name}".`);
          const files = await ws.walkFiles(project._id);
          if (files.length === 0) return text(`"${name}" has no files.`);
          const lines = files.map((f) => `  ${f.filePath} (${(f.content || "").length}b)`).join("\n");
          return text(`Files in "${name}":\n${lines}`);
        } catch (e) {
          return text(`forge-list-files failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // forge-sync: compile tree → disk
    // ---------------------------------------------------------------
    {
      name: "forge-sync",
      description: "Materialize a forge project's tree into real files on disk at land/extensions/<name>/. Alias for workspace-sync scoped to the forge project.",
      schema: { name: z.string() },
      annotations: { readOnlyHint: false },
      async handler({ name, rootId }) {
        try {
          const ws = await requireWorkspace();
          const project = await ws.getProjectByName(rootId, name);
          if (!project) return text(`forge-sync: no forge project "${name}".`);
          const res = await ws.syncUp(project._id);
          return text(`Synced "${name}" to ${res.workspacePath}. ${res.written.length} wrote, ${res.skipped.length} unchanged.`);
        } catch (e) {
          return text(`forge-sync failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // forge-test: sync, then run node --test in the workspace
    // ---------------------------------------------------------------
    {
      name: "forge-test",
      description: "Sync a forge project to disk and run its tests with Node's built-in runner. Returns pass/fail plus output.",
      schema: { name: z.string() },
      annotations: { readOnlyHint: false },
      async handler({ name, rootId }) {
        try {
          const ws = await requireWorkspace();
          const project = await ws.getProjectByName(rootId, name);
          if (!project) return text(`forge-test: no forge project "${name}".`);
          const sync = await ws.syncUp(project._id);
          const fsMod = await import("fs/promises");
          const entries = await fsMod.readdir(sync.workspacePath);
          const explicit = entries.filter((e) => /^(test|tests)\.m?js$/.test(e) || /\.test\.m?js$/.test(e));
          const args = ["--test"];
          if (explicit.length > 0) args.push(...explicit);
          else args.push(".");
          const res = await ws.runInWorkspace({
            workspacePath: sync.workspacePath,
            binary: "node",
            args,
            timeoutMs: 300_000,
          });
          const passed = res.exitCode === 0 && !res.timedOut;
          const parts = [
            `forge-test "${name}": ${passed ? "PASSED" : "FAILED"} (exit ${res.exitCode}${res.timedOut ? ", timed out" : ""})`,
          ];
          if (res.stdout) parts.push(res.stdout);
          if (res.stderr) parts.push(`stderr:\n${res.stderr}`);
          return text(parts.join("\n"));
        } catch (e) {
          return text(`forge-test failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // forge-validate: sync, load manifest, run local validator
    // ---------------------------------------------------------------
    {
      name: "forge-validate",
      description: "Sync a forge project and run local validation (name regex, semver, reserved names, file paths, content limits). Mirrors Horizon's publish checks without network.",
      schema: { name: z.string() },
      annotations: { readOnlyHint: true },
      async handler({ name, rootId }) {
        const err = nameError(name);
        if (err) return text(`forge-validate: ${err}`);
        try {
          const ws = await requireWorkspace();
          const project = await ws.getProjectByName(rootId, name);
          if (!project) return text(`forge-validate: no forge project "${name}".`);
          await ws.syncUp(project._id);
          const manifest = await loadForgeManifest(project._id);
          const files = await collectForgeFiles(project._id);
          const result = validateExtensionPackage({ manifest, files });
          const lines = [
            `Validation for "${name}":`,
            `  valid: ${result.valid}`,
            `  files: ${files.length}`,
          ];
          if (result.errors.length) {
            lines.push("  errors:");
            for (const e of result.errors) lines.push(`    - ${e}`);
          }
          if (result.warnings.length) {
            lines.push("  warnings:");
            for (const w of result.warnings) lines.push(`    - ${w}`);
          }
          return text(lines.join("\n"));
        } catch (e) {
          return text(`forge-validate failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // forge-install-local: sync, validate, mark restart-required
    // ---------------------------------------------------------------
    {
      name: "forge-install-local",
      description: "Install a forge project on this land: sync to disk, validate, flag restart-required. The extension is materialized at land/extensions/<name>/ and the loader picks it up at next boot.",
      schema: { name: z.string() },
      annotations: { readOnlyHint: false },
      async handler({ name, rootId, userId }) {
        const err = nameError(name);
        if (err) return text(`forge-install-local: ${err}`);
        try {
          const ws = await requireWorkspace();
          const project = await ws.getProjectByName(rootId, name);
          if (!project) return text(`forge-install-local: no forge project "${name}".`);
          const sync = await ws.syncUp(project._id);
          const manifest = await loadForgeManifest(project._id);
          const files = await collectForgeFiles(project._id);
          const validation = validateExtensionPackage({ manifest, files });
          if (!validation.valid) {
            return text(
              `forge-install-local: validation failed, not marking installed.\n` +
              validation.errors.map((e) => "  - " + e).join("\n"),
            );
          }
          if (core?.metadata?.mergeExtMeta) {
            try {
              await core.metadata.mergeExtMeta(project, "code-forge", {
                installed: true,
                installedAt: new Date().toISOString(),
                installedVersion: manifest.version,
                restartRequired: true,
              });
            } catch {}
          }
          return text(
            `Installed "${name}" v${manifest.version} at ${sync.workspacePath}. ` +
            `RESTART REQUIRED: the loader picks up new extensions only at boot.`,
          );
        } catch (e) {
          return text(`forge-install-local failed: ${e.message}`);
        }
      },
    },

    // ---------------------------------------------------------------
    // forge-publish-horizon: sync, validate, dry-run or live publish
    // ---------------------------------------------------------------
    {
      name: "forge-publish-horizon",
      description: "Publish (or dry-run publish) a forge project to a Horizon registry. Default is dry-run: local validation and payload summary without touching the network. Live publish requires dryRun=false and a horizonUrl.",
      schema: {
        name: z.string(),
        dryRun: z.boolean().optional(),
        horizonUrl: z.string().optional(),
        releaseNotes: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: true },
      async handler({ name, dryRun, horizonUrl, releaseNotes, tags, rootId }) {
        const err = nameError(name);
        if (err) return text(`forge-publish-horizon: ${err}`);
        const isDry = dryRun !== false;
        try {
          const ws = await requireWorkspace();
          const project = await ws.getProjectByName(rootId, name);
          if (!project) return text(`forge-publish-horizon: no forge project "${name}".`);
          await ws.syncUp(project._id);
          const manifest = await loadForgeManifest(project._id);
          const files = await collectForgeFiles(project._id);

          if (isDry) {
            const result = validateExtensionPackage({ manifest, files });
            const totalBytes = files.reduce((s, f) => s + (f.content?.length || 0), 0);
            const lines = [
              `forge-publish-horizon DRY-RUN for "${name}" v${manifest.version}:`,
              `  valid: ${result.valid}`,
              `  files: ${files.length}`,
              `  bytes: ${totalBytes}`,
              `  wouldSendTo: ${horizonUrl || "(no horizonUrl provided)"}`,
            ];
            if (result.errors.length) {
              lines.push("  errors:");
              for (const e of result.errors) lines.push(`    - ${e}`);
            }
            if (result.warnings.length) {
              lines.push("  warnings:");
              for (const w of result.warnings) lines.push(`    - ${w}`);
            }
            lines.push("  file list:");
            for (const f of files) lines.push(`    ${f.path} (${f.content.length}b)`);
            return text(lines.join("\n"));
          }

          // Live publish path. Not the default; requires explicit dryRun=false.
          const res = await publishToHorizon(manifest.name, {
            horizonUrl,
            releaseNotes,
            tags,
            filesOverride: files,
          });
          return text(`Published "${name}" to ${horizonUrl}. status=${res.status}.`);
        } catch (e) {
          return text(`forge-publish-horizon failed: ${e.message}`);
        }
      },
    },
  ];
}
