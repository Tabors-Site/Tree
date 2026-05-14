/**
 * Strategy SDK for code-workspace.
 *
 * Third-party coding-domain packages (code-strategy-react, code-strategy-rust,
 * code-strategy-vue, ...) use this to plug in with almost no boilerplate.
 *
 * A strategy has two halves:
 *   - Context: short explanatory markdown the agent reads when the domain
 *     is in play.
 *   - Functions: MCP tool wrappers that emit proven skeletons or do
 *     domain-specific verification.
 *
 * This module exports:
 *   - defineStrategy({ name, contextBlock, appliesWhen, tools })
 *       Registers the context block + predicate with code-workspace, wraps
 *       each tool handler with pre-bound helpers (writeFile, readFiles), and
 *       returns an object ready to spread into your extension's init() value.
 *
 *   - applies.{ contractKind, messageContract, routeContract,
 *                specMatches, any, all, always, never }
 *       Predicate combinators so you don't hand-write the same regex
 *       walks over declared contracts and spec text.
 *
 * Example (the whole strategy is one file):
 *
 *   import { defineStrategy, applies } from "../code-workspace/sdk.js";
 *   import { makeReactComponent } from "./lib.js";
 *
 *   export default defineStrategy({
 *     name: "react",
 *     contextBlock: `React components are pure functions of props ...`,
 *     appliesWhen: applies.any(
 *       applies.specMatches(/\breact\b|\bjsx\b|\bcomponent\b/i),
 *       applies.contractKind(/react|component/),
 *     ),
 *     tools: [
 *       {
 *         name: "react-create-component",
 *         description: "Emit a working React component file.",
 *         schema: { componentName: z.string(), props: z.array(z.string()) },
 *         async handler({ writeFile, componentName, props }) {
 *           return writeFile(`${componentName}.jsx`, makeReactComponent(componentName, props));
 *         },
 *       },
 *     ],
 *   });
 *
 *   // in index.js:
 *   import strategy from "./strategy.js";
 *   export async function init() { return strategy.toInit(); }
 */

import { registerStrategy } from "./strategyRegistry.js";

// ---------------------------------------------------------------------------
// defineStrategy
// ---------------------------------------------------------------------------

export function defineStrategy({
  name,
  contextBlock,
  appliesWhen,
  tools = [],
  // Strategies inject their tools into the typed Workers that
  // actually do code work. Build/Refine/Integrate are the writers;
  // Review reads. Strategies that want their tools available in
  // Review too can extend this list when calling defineStrategy.
  modes = [
    "tree:code-worker-build",
    "tree:code-worker-refine",
    "tree:code-worker-integrate",
  ],
}) {
  if (!name || typeof name !== "string") {
    throw new Error("defineStrategy: name is required");
  }
  if (!contextBlock || typeof contextBlock !== "string") {
    throw new Error(`defineStrategy(${name}): contextBlock is required`);
  }
  const predicate = typeof appliesWhen === "function" ? appliesWhen : () => true;

  const wrappedTools = (Array.isArray(tools) ? tools : []).map(wrapTool);
  const toolNames = wrappedTools.map((t) => t.name);
  const modeTools = modes.map((modeKey) => ({ modeKey, toolNames }));

  return {
    name,
    contextBlock,
    appliesWhen: predicate,
    tools: wrappedTools,
    modeTools,
    /**
     * Call from your extension's init() and return the result. Registers the
     * context block + predicate and returns { tools, modeTools } for the
     * loader to wire through.
     */
    toInit() {
      registerStrategy({ name, contextBlock, appliesWhen: predicate });
      return { tools: wrappedTools, modeTools };
    },
  };
}

// ---------------------------------------------------------------------------
// applies.* — predicate combinators
// ---------------------------------------------------------------------------

export const applies = {
  /**
   * Fire when any declared contract's kind matches the pattern.
   *   applies.contractKind("ws")            — kind === "ws" (case-insensitive)
   *   applies.contractKind(/ws|websocket/)  — regex
   */
  contractKind(pattern) {
    const rx = pattern instanceof RegExp ? pattern : new RegExp(String(pattern), "i");
    return (ctx) => {
      for (const pool of contractPools(ctx)) {
        for (const c of pool) {
          const kind = String(c?.kind || c?.type || "");
          if (rx.test(kind)) return true;
        }
      }
      return false;
    };
  },

  /**
   * Fire when any declared contract has kind="message" with a values.type
   * field. That's the standard WebSocket-style wire-message shape.
   */
  messageContract() {
    return (ctx) => {
      for (const pool of contractPools(ctx)) {
        for (const c of pool) {
          const kind = String(c?.kind || "").toLowerCase();
          if (kind === "message" && c?.values && typeof c.values === "object" && "type" in c.values) {
            return true;
          }
        }
      }
      return false;
    };
  },

  /**
   * Fire when any declared contract looks like an HTTP route: has both
   * a `method` and a `path`, or kind matches route/endpoint patterns.
   */
  routeContract() {
    return (ctx) => {
      for (const pool of contractPools(ctx)) {
        for (const c of pool) {
          if (c?.method && c?.path) return true;
          const kind = String(c?.kind || "").toLowerCase();
          if (/route|endpoint|http|rest|api/.test(kind)) return true;
        }
      }
      return false;
    };
  },

  /**
   * Fire when the user's request, project spec, or any similar text field
   * matches the pattern.
   */
  specMatches(pattern) {
    const rx = pattern instanceof RegExp ? pattern : new RegExp(String(pattern), "i");
    return (ctx) => rx.test(specTexts(ctx));
  },

  /** OR-compose: fire if any predicate matches. */
  any(...preds) {
    return (ctx) => preds.some((p) => {
      try { return !!p(ctx); } catch { return false; }
    });
  },

  /** AND-compose: fire only if all predicates match. */
  all(...preds) {
    return (ctx) => preds.every((p) => {
      try { return !!p(ctx); } catch { return false; }
    });
  },

  /** Always fires — useful for language-level strategies that carry general rules. */
  always: () => () => true,

  /** Never fires — useful while prototyping a new strategy. */
  never: () => () => false,
};

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function contractPools(ctx) {
  const ec = ctx?.enrichedContext || {};
  return [ec.declaredContracts, ec.contracts, ctx?.contracts].filter(Array.isArray);
}

function specTexts(ctx) {
  const ec = ctx?.enrichedContext || {};
  return [
    ctx?.userRequest,
    ctx?.message,
    ctx?.systemSpec,
    ec?.systemSpec,
    ec?.spec,
    ec?.projectSystemSpec,
  ].filter(Boolean).map(String).join(" ");
}

/**
 * Wrap a strategy tool so its handler receives pre-bound helpers:
 *
 *   writeFile(filePath, content)
 *     — branch-aware single-file write. Rejects paths that leave the caller's
 *       branch. Returns { ok, filePath, created, error }.
 *
 *   readFile(filePath)
 *     — branch-aware single-file read. Same rooting as writeFile.
 *       Returns { ok, filePath, content, error }. content is null if the
 *       file doesn't exist (ok still true — use this to distinguish "no file"
 *       from "path rejected").
 *
 *   readWorkspaceFiles()
 *     — returns the full [{ filePath, content }] list for the active project,
 *       so a verify tool can scan without re-implementing project lookup.
 *
 * All three helpers respect the same branch-rooted virtual FS as the base
 * workspace-add-file tool. A strategy can never accidentally write into a
 * sibling branch; the sandbox is enforced at injection, not at the call site.
 *
 * The user's handler still receives everything it declared in schema, plus
 * the MCP-standard injected fields (userId, nodeId, rootId, chatId, sessionId).
 */
function wrapTool(tool) {
  if (!tool?.name) return tool;
  if (typeof tool.handler !== "function") return tool;

  const userHandler = tool.handler;
  return {
    name: tool.name,
    description: tool.description || "",
    schema: tool.schema || {},
    annotations: tool.annotations || {},
    async handler(args) {
      const { nodeId, userId, rootId } = args || {};
      const cw = await loadCodeWorkspace();

      const writeFile = async (filePath, content) => {
        if (!cw?.writeFileInBranch) {
          return { ok: false, error: "code-workspace.writeFileInBranch unavailable" };
        }
        return cw.writeFileInBranch({ nodeId, userId, rootId, filePath, content });
      };

      const readFile = async (filePath) => {
        if (!cw?.readFileInBranch) {
          return { ok: false, error: "code-workspace.readFileInBranch unavailable" };
        }
        return cw.readFileInBranch({ nodeId, userId, rootId, filePath });
      };

      const readWorkspaceFiles = async () => {
        if (!cw?.walkFiles) return [];
        try {
          const { findProject } = await import("./workspace.js");
          const project = await findProject(nodeId || rootId);
          if (!project) return [];
          return (await cw.walkFiles(project._id)) || [];
        } catch {
          return [];
        }
      };

      /**
       * Merge npm deps into the branch's package.json. Accepts either an
       * array of names (versions default to "*") or an object of
       * { name: versionRange }. Creates the package.json if missing,
       * preserving any existing scripts/main/etc. Idempotent: deps that
       * already match are left alone.
       *
       * The spawner's ensureDepsInstalled picks up the change on next boot
       * and runs `npm install`. Strategy wrappers should call this BEFORE
       * writeFile so the dep lands before the file that requires it.
       */
      const ensureDeps = async (deps) => {
        const asMap = Array.isArray(deps)
          ? Object.fromEntries(deps.map((n) => [String(n), "*"]))
          : (deps && typeof deps === "object" ? deps : {});
        const names = Object.keys(asMap);
        if (names.length === 0) return { ok: true, skipped: true, reason: "no deps" };

        const read = await readFile("package.json");
        if (!read.ok) return { ok: false, error: read.error };

        let pkg;
        try {
          pkg = read.content ? JSON.parse(read.content) : {};
        } catch (err) {
          return { ok: false, error: `package.json does not parse: ${err.message}` };
        }

        // Synthesize a minimal shell when the file is new. npm install
        // tolerates missing name/version but warns; a valid shell avoids
        // the warnings and makes the dep list obvious.
        if (!read.content) {
          pkg.name = pkg.name || "workspace-branch";
          pkg.version = pkg.version || "0.0.0";
          pkg.private = pkg.private ?? true;
        }
        pkg.dependencies = pkg.dependencies && typeof pkg.dependencies === "object" ? pkg.dependencies : {};
        let changed = !read.content;
        for (const [name, version] of Object.entries(asMap)) {
          if (pkg.dependencies[name] === version) continue;
          if (pkg.dependencies[name] && version === "*") continue;
          pkg.dependencies[name] = version;
          changed = true;
        }
        if (!changed) return { ok: true, skipped: true, reason: "deps already present" };

        const next = JSON.stringify(pkg, null, 2) + "\n";
        const write = await writeFile("package.json", next);
        if (!write.ok) return { ok: false, error: write.error };
        return { ok: true, deps: names, filePath: write.filePath };
      };

      return userHandler({ ...args, writeFile, readFile, readWorkspaceFiles, ensureDeps });
    },
  };
}

async function loadCodeWorkspace() {
  try {
    const { getExtension } = await import("../loader.js");
    return getExtension("code-workspace")?.exports || null;
  } catch {
    return null;
  }
}
