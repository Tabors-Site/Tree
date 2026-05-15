// Workspace worker-type registry.
//
// Workspaces (code-workspace, book-workspace, design-workspace, ...)
// register their typed Worker specializations here so dispatch can
// look up the right mode key per workerType without having to probe
// hardcoded extension names. The registry is a process-wide singleton
// because mode registration happens at boot and workspace activation
// is decided per-scope at runtime — dispatch needs O(1) lookup, not
// a per-call extension scan.
//
// Shape:
//   workspaceName → { build?: { modeKey }, refine?: ..., review?: ..., integrate?: ... }
//
// The keys mirror governing's WORKER_TYPES list; an unknown key is
// silently ignored (a workspace declaring "wargame" type doesn't
// poison the registry — the type just won't resolve and dispatch
// falls back to the governing base mode for the canonical type).
//
// Reads are tolerant: a workspace that registered but isn't active at
// the current scope is still returned (the dispatch caller is what
// decides whether to use the entry, e.g. by reading spatial scope).
//
// This is the substrate that makes "the typing is real at the leaves"
// — without the registry, dispatch can't find the typed worker mode
// the workspace specialized.

import { WORKER_TYPES } from "../modes/workerBase.js";

const REGISTRY = new Map();

/**
 * Register a workspace's typed-Worker specializations. Idempotent —
 * calling again replaces the entry. Called from workspace init()
 * (typically after registerMode for the typed modes themselves).
 *
 * @param {string} workspaceName — e.g. "code-workspace"
 * @param {object} types — { build?: { modeKey }, refine?: {...}, ... }
 */
export function registerWorkspaceWorkerTypes(workspaceName, types) {
  if (!workspaceName || !types || typeof types !== "object") return;
  const sanitized = {};
  for (const t of WORKER_TYPES) {
    if (types[t] && typeof types[t].modeKey === "string") {
      sanitized[t] = { modeKey: types[t].modeKey };
    }
  }
  // Pass-through for workspace-declared decomposition hints. The
  // Planner reads these via getWorkspaceDecompositionHints when
  // building its prompt so it can pick branch-vs-leaf shapes that
  // suit the workspace's typical work pattern. Free-text — the
  // workspace owns the semantics.
  if (types._decompositionHints && typeof types._decompositionHints === "object") {
    sanitized._decompositionHints = types._decompositionHints;
  }
  REGISTRY.set(workspaceName, sanitized);
}

/**
 * Read a workspace's decomposition hints (free-text guidance the
 * Planner injects into its prompt). Returns null when the workspace
 * registered no hints OR the workspace isn't in the registry.
 *
 * Shape (workspace-declared):
 *   {
 *     defaultShape: "single-leaf-with-internal-structure"
 *                 | "branch-per-major-sub-domain"
 *                 | "mixed-leaf-and-branch"
 *                 | <custom string>,
 *     branchWhen: "<one sentence: when to use branches>",
 *     leafWhen:   "<one sentence: when to use leaves>",
 *     integrateWhen: "<one sentence: when integrate is meaningful>",
 *     antiPatterns: ["<phrase>", ...],  // shapes the Planner should NOT emit
 *     example: "<concrete example plan shape for this workspace>",
 *   }
 *
 * The hints are SUGGESTIONS, not validators — the Planner reads
 * them as architectural guidance during decomposition.
 */
export function getWorkspaceDecompositionHints(workspaceName) {
  if (!workspaceName) return null;
  const entry = REGISTRY.get(workspaceName);
  if (!entry?._decompositionHints) return null;
  return entry._decompositionHints;
}

/**
 * Unregister a workspace (e.g. on hot-unload, future feature).
 */
export function unregisterWorkspaceWorkerTypes(workspaceName) {
  REGISTRY.delete(workspaceName);
}

/**
 * Look up a mode key by workerType across all registered workspaces.
 * Returns the first match in registry-insertion order — adequate for
 * Pass 1 where one workspace is active per land in practice. If two
 * workspaces both register typed workers and both are allowed at the
 * scope, the dispatcher caller should pass `preferWorkspace` to
 * disambiguate.
 *
 * @param {string} workerType — one of WORKER_TYPES
 * @param {object} [opts]
 * @param {string} [opts.preferWorkspace] — workspace name to consult first
 * @returns {{ workspaceName, modeKey } | null}
 */
export function lookupWorkerMode(workerType, { preferWorkspace } = {}) {
  if (!workerType) return null;
  if (preferWorkspace) {
    const entry = REGISTRY.get(preferWorkspace);
    if (entry?.[workerType]?.modeKey) {
      return { workspaceName: preferWorkspace, modeKey: entry[workerType].modeKey };
    }
  }
  for (const [name, entry] of REGISTRY.entries()) {
    if (entry?.[workerType]?.modeKey) {
      return { workspaceName: name, modeKey: entry[workerType].modeKey };
    }
  }
  return null;
}

/**
 * List all registered workspaces and the types each supports. Useful
 * for diagnostics, Horizon listings, and the dashboard.
 */
export function listWorkerTypeRegistrations() {
  const out = [];
  for (const [name, entry] of REGISTRY.entries()) {
    out.push({
      workspaceName: name,
      types: Object.keys(entry).filter((k) => entry[k]?.modeKey),
      modeKeys: { ...entry },
    });
  }
  return out;
}

/**
 * Find which registered workspace is active at a tree scope.
 *
 * Reads the scope's effective ext-allow chain (via the kernel's
 * scope resolver) and returns the first registered workspace name
 * that appears in the allowed set. Returns null when no workspace
 * is allowed here.
 *
 * Used by dispatch's resolveWorkerModeForType to pick the RIGHT
 * workspace's typed Worker per scope — without this, the registry's
 * insertion-order first-match wins, which means lands with multiple
 * workspaces registered route every leaf to whichever workspace
 * loaded first. A code project at a code-workspace scope would
 * then dispatch book-workspace's typed Worker (note-creating) even
 * though code-workspace is the active workspace here.
 */
export async function findActiveWorkspaceAtScope(nodeId) {
  if (!nodeId) return null;
  if (REGISTRY.size === 0) return null;
  try {
    const { getBlockedExtensionsAtNode } = await import(
      "../../../seed/tree/extensionScope.js"
    );
    const { allowed } = await getBlockedExtensionsAtNode(nodeId);
    if (!allowed || allowed.size === 0) return null;
    for (const name of REGISTRY.keys()) {
      if (allowed.has(name)) return name;
    }
  } catch {}
  return null;
}

/**
 * Decide whether governance should take over at this tree scope.
 *
 * Two cases return true:
 *   1. A workspace extension (one that registered typed Workers with
 *      this registry) is ext-allow'd at this scope. Workspaces depend
 *      on governing — wherever a workspace is active, governance is
 *      in charge of work dispatch.
 *   2. NO workspace extensions are registered in this land at all
 *      (governing-alone case). Lands that install governing without
 *      any workspace are coordination-only lands; every message at a
 *      tree position goes through the Ruler.
 *
 * Returns false when workspaces exist in the land but none is active
 * at this specific scope. The tree zone might still resolve other
 * modes (e.g., direct-chat coach/ask) at that position, and the
 * orchestrator's classifier handles them normally.
 *
 * Used by tree-orchestrator/dispatch.js's Ruler-takeover detection.
 * The legacy `isWorkspacePlanMode(mode)` check broke when workspaces
 * stopped registering `-plan` modes after the typed-Worker landing;
 * this presence-based check restores Ruler-takeover at workspace
 * positions without depending on classifier mode picks.
 */
export async function shouldGovernAtScope(nodeId) {
  if (!nodeId) return false;

  // Case 2: no workspaces registered → governing-alone land. Every
  // tree-zone message routes through the Ruler. Cheap check up front
  // so we don't even need to read scope metadata.
  if (REGISTRY.size === 0) return true;

  // Case 1: a registered workspace is ext-allow'd at this scope.
  // Walk the ancestor chain via the kernel's scope resolver and
  // check the `allowed` set for any registered workspace name.
  try {
    const { getBlockedExtensionsAtNode } = await import(
      "../../../seed/tree/extensionScope.js"
    );
    const { allowed } = await getBlockedExtensionsAtNode(nodeId);
    if (!allowed || allowed.size === 0) return false;
    for (const name of REGISTRY.keys()) {
      if (allowed.has(name)) return true;
    }
  } catch {
    // Scope resolution failed — fall through to false. The dispatch
    // path's other signals (existing Ruler upstream) still decide.
  }
  return false;
}
