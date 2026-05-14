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
  REGISTRY.set(workspaceName, sanitized);
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
