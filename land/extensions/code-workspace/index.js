import log from "../../seed/log.js";
import getWorkspaceTools from "./tools.js";
import { readMeta, localNodeView } from "./workspace.js";
import { ensureSourceTree } from "./source.js";
import { getLandConfigValue } from "../../seed/landConfig.js";
import {
  findBranchContext,
  findProjectForNode,
  findBranchSiblings,
  recordSwarmEvent,
  readSwarmEvents,
  readSubPlan,
  readAggregatedDetail,
  readSignalInbox,
  rollUpDetail,
  appendSignalInbox,
  pruneSignalInboxForFile,
  formatAggregatedDetail,
  formatSignalInbox,
  formatSwarmContext,
  formatContracts,
  readContracts,
  replaceContractsFromFile,
  summarizeWrite,
  SIGNAL_KIND,
  readNodePlanSteps,
  readNodeStepRollup,
  readPlanDrift,
  markPlanDrift,
  formatNodePlan,
  findBlockingSyntaxError,
  readProjectContracts,
} from "./swarmEvents.js";
import { classifyWrite } from "./perspectiveFilter.js";
import { validateSyntax } from "./validators/syntax.js";
import {
  extractBackendContracts,
  extractFrontendExpectations,
  extractMountPrefixes,
  diffContracts,
} from "./validators/contracts.js";
import { detectDeadReceivers } from "./validators/deadReceivers.js";
import {
  registerWatcher,
  unregisterWatcher,
  notifySignal,
  partitionCascaded,
  formatFreshBanner,
  maybeApplyCascadeNudge,
  dumpContextForSession,
} from "./sessionWatch.js";

import planMode from "./modes/plan.js";
import logMode from "./modes/log.js";
import coachMode from "./modes/coach.js";
import askMode from "./modes/ask.js";
import reviewMode from "./modes/review.js";

// Serve subsystem — live preview of workspace projects
import createServeRouter from "./serve/routes.js";
import {
  startPreview,
  stopPreview,
  startIdleReaper,
  stopAllPreviews,
} from "./serve/spawner.js";
import { getEntryByNodeId, allEntries, slugify } from "./serve/registry.js";
import { loadProjectNode, workspacePathFor } from "./serve/projectLookup.js";
import { registerCodeServeSlot } from "./serve/slot.js";
import { installPreviewUpgradeProxy } from "./serve/wsProxy.js";
import { z } from "zod";

const DEFAULT_PREVIEW_PORT = 3100;

/**
 * Walk from nodeId up to the project root and render a breadcrumb that
 * shows the AI its position in the tree. Each level gets a one-line
 * summary: name, role, spec (if any), and a marker for the current
 * position. The result is a small string the enrichContext hook
 * injects as `context.swarmPosition`.
 *
 * Why this helps: every turn, the AI sees not just its own task but
 * its place in the larger project — the project spec at the root, the
 * branch sibling structure (via subPlan in the parent), and any
 * intermediate directories. Cuts the "where am I and why" cost the
 * AI pays at the top of every continuation.
 *
 *   ~/Projects/games/snake-multiplayer (project)
 *     spec: "Real-time multiplayer snake with rooms"
 *     status: 2/4 branches done
 *   └ backend (branch — you are here)
 *     spec: "WebSocket server with room management"
 *     files: server.js, game.js, package.json
 *
 * Cheap: max 8 ancestor reads with .lean() projection. No joins.
 */
async function buildPositionBreadcrumb(nodeId) {
  if (!nodeId) return null;
  const { default: NodeModel } = await import("../../seed/models/node.js");

  // Walk up collecting nodes
  const chain = [];
  let cursor = String(nodeId);
  let guard = 0;
  while (cursor && guard < 8) {
    const n = await NodeModel.findById(cursor).select("_id name parent metadata").lean();
    if (!n) break;
    const meta = n.metadata instanceof Map
      ? n.metadata.get("code-workspace")
      : n.metadata?.["code-workspace"];
    chain.push({ node: n, meta });
    if (meta?.role === "project") break;
    if (!n.parent) break;
    cursor = String(n.parent);
    guard++;
  }
  if (chain.length === 0) return null;
  // Reverse so root is first, current node last
  chain.reverse();

  // Find the project entry to surface its spec at the top
  const project = chain.find((c) => c.meta?.role === "project");
  if (!project) return null;

  const lines = ["## YOUR POSITION IN THE TREE"];
  lines.push("");

  for (let i = 0; i < chain.length; i++) {
    const { node, meta } = chain[i];
    const isCurrent = i === chain.length - 1;
    const indent = "  ".repeat(i);
    const arrow = i > 0 ? "└ " : "";
    const here = isCurrent ? "  ← YOU ARE HERE" : "";
    const role = meta?.role ? ` (${meta.role})` : "";
    lines.push(`${indent}${arrow}${node.name}${role}${here}`);

    // Per-level details
    if (meta?.role === "project") {
      if (meta.systemSpec) lines.push(`${indent}  spec: ${truncate(meta.systemSpec, 200)}`);
      const counts = meta.aggregatedDetail?.statusCounts;
      const subBranches = meta.subPlan?.branches?.length || 0;
      if (subBranches > 0) {
        const done = counts?.done || 0;
        lines.push(`${indent}  status: ${done}/${subBranches} branches done`);
      }
      const verified = meta.aggregatedDetail?.verifiedEndpoints;
      if (verified && Object.keys(verified).length > 0) {
        lines.push(`${indent}  verified endpoints: ${Object.keys(verified).length}`);
      }
    } else if (meta?.role === "branch") {
      const spec = meta.systemSpec || meta.spec;
      if (spec) lines.push(`${indent}  spec: ${truncate(spec, 160)}`);
      if (meta.path) lines.push(`${indent}  path: ${meta.path}`);
      const filesWritten = meta.aggregatedDetail?.filesWritten || 0;
      if (filesWritten > 0) lines.push(`${indent}  files written so far: ${filesWritten}`);
      const sigCount = Array.isArray(meta.signalInbox) ? meta.signalInbox.length : 0;
      if (sigCount > 0) lines.push(`${indent}  pending signals: ${sigCount}`);
    } else if (meta?.role === "file") {
      if (meta.filePath) lines.push(`${indent}  file: ${meta.filePath}`);
    }
  }

  return lines.join("\n");
}

function truncate(s, n) {
  const str = String(s || "");
  return str.length > n ? str.slice(0, n - 1) + "…" : str;
}

/**
 * Render a localNodeView into a compact prompt block the AI sees at
 * the top of every turn. Shows the current node + its children +
 * sibling peers + parent. One level deep in each direction — the AI
 * navigates deeper via tools if needed.
 *
 * This is the fix for "AI ignores what already exists": the AI at a
 * project root that already has `manifest.js`, `index.js`, `tools.js`
 * as children will SEE those in its context BEFORE it decides to scan
 * .source for references. An empty project renders a clean "(no
 * children yet)" line so the AI knows it's starting from scratch.
 */
function formatLocalView(view) {
  if (!view) return null;
  const lines = ["## LOCAL TREE VIEW"];
  lines.push("");
  lines.push("What exists right here — your current position, its parent,");
  lines.push("direct children, and sibling peers. Always consult this");
  lines.push("before writing new files. If something already exists that");
  lines.push("matches what you'd write, READ it first via workspace-read-file");
  lines.push("and extend it — don't rebuild from scratch.");
  lines.push("");

  if (view.parent) {
    const role = view.parent.role ? ` (${view.parent.role})` : "";
    lines.push(`Parent: ${view.parent.name}${role}`);
  }

  const selfRole = view.self.role ? ` (${view.self.role})` : "";
  const selfKids = view.self.childCount
    ? `, ${view.self.childCount} direct child${view.self.childCount === 1 ? "" : "ren"}`
    : ", empty";
  lines.push(`You are at: ${view.self.name}${selfRole}${selfKids}`);

  if (view.children.length > 0) {
    lines.push("");
    lines.push("Direct children (things INSIDE you — already written):");
    for (const c of view.children) {
      const role = c.role ? ` [${c.role}]` : "";
      lines.push(`  • ${c.name}${role}`);
    }
    if (view.self.childCount > view.children.length) {
      lines.push(`  ... and ${view.self.childCount - view.children.length} more (navigate to see)`);
    }
  } else if (view.self.childCount === 0) {
    lines.push("");
    lines.push("(no children yet — this position is empty, a good place to create)");
  }

  if (view.siblings.length > 0) {
    lines.push("");
    lines.push("Sibling peers (alongside you — already exist):");
    for (const s of view.siblings) {
      const role = s.role ? ` [${s.role}]` : "";
      lines.push(`  • ${s.name}${role}`);
    }
  }

  return lines.join("\n");
}

/**
 * Walk from any node up to the project root, returning the project
 * node + a Set of every ancestor nodeId on the path. The Set is used
 * by the plan-tree renderer to highlight the "you are here" lineage —
 * not just the current branch, but every ancestor up to the root.
 *
 * Returns { projectNode, ancestorIds: Set<string> } or null if no
 * project ancestor exists.
 */
async function findProjectAndAncestors(nodeId) {
  if (!nodeId) return null;
  const { default: NodeModel } = await import("../../seed/models/node.js");
  const ancestorIds = new Set();
  let cursor = String(nodeId);
  let guard = 0;
  while (cursor && guard < 16) {
    ancestorIds.add(cursor);
    const n = await NodeModel.findById(cursor).select("_id name parent metadata").lean();
    if (!n) return null;
    const meta = n.metadata instanceof Map
      ? n.metadata.get("code-workspace")
      : n.metadata?.["code-workspace"];
    if (meta?.role === "project") {
      return { projectNode: n, projectMeta: meta, ancestorIds };
    }
    if (!n.parent) return null;
    cursor = String(n.parent);
    guard++;
  }
  return null;
}

/**
 * Recursively render the project's full subPlan tree as a multi-line
 * string. Walks each subPlan branch, looks up its actual metadata to
 * get its current status + spec, marks the path from the project root
 * to the current node with "← here", and recurses into nested
 * sub-branches.
 *
 *   ## PROJECT PLAN
 *
 *   snake-multiplayer
 *   ✓ contracts             — done [3 files written, 0 signals pending]
 *   🟡 backend              — running ← here
 *      ✓ routes
 *      🟡 sockets           — running ← here (your branch)
 *      ⏳ tests
 *   ⏳ frontend             — pending
 *   ⏳ deploy               — pending
 *
 * Bounded recursion: max depth 5, max 30 branches total. Catches the
 * pathological case of a runaway swarm without breaking small projects.
 */
async function buildPlanTree(projectNodeId, currentAncestorIds) {
  if (!projectNodeId) return null;
  const { default: NodeModel } = await import("../../seed/models/node.js");

  const lines = ["## PROJECT PLAN"];
  lines.push("");
  let totalRendered = 0;
  const MAX_BRANCHES = 30;
  const MAX_DEPTH = 5;

  async function renderLevel(parentNodeId, depth) {
    if (depth > MAX_DEPTH) return;
    if (totalRendered >= MAX_BRANCHES) return;
    const parent = await NodeModel.findById(parentNodeId).select("_id metadata").lean();
    if (!parent) return;
    const parentMeta = parent.metadata instanceof Map
      ? parent.metadata.get("code-workspace")
      : parent.metadata?.["code-workspace"];
    const subBranches = parentMeta?.subPlan?.branches;
    if (!Array.isArray(subBranches) || subBranches.length === 0) return;

    for (const child of subBranches) {
      if (totalRendered >= MAX_BRANCHES) {
        lines.push(`${"  ".repeat(depth)}... (${subBranches.length - totalRendered} more truncated)`);
        return;
      }
      totalRendered++;

      const childNodeId = child.nodeId ? String(child.nodeId) : null;
      const isAncestor = childNodeId && currentAncestorIds.has(childNodeId);
      const here = isAncestor ? "  ← here" : "";

      const status = child.status || "pending";
      const icon =
        status === "done" ? "✓" :
        status === "failed" ? "✗" :
        status === "running" ? "🟡" :
        status === "paused" ? "⏸" : "⏳";

      const indent = "  ".repeat(depth);
      let summary = "";
      if (status === "done" && child.summary) summary = ` — ${truncate(child.summary, 80)}`;
      else if (status === "failed" && child.error) summary = ` — error: ${truncate(child.error, 80)}`;
      else if (status === "running") summary = " — running";
      else if (status === "pending") summary = " — pending";
      else if (status === "paused") summary = " — paused";

      lines.push(`${indent}${icon} ${child.name}${summary}${here}`);

      // If this child has its own sub-plan, recurse
      if (childNodeId && depth < MAX_DEPTH - 1) {
        await renderLevel(childNodeId, depth + 1);
      }
    }
  }

  await renderLevel(projectNodeId, 0);

  if (totalRendered === 0) {
    return null; // No subPlan declared at any level
  }
  return lines.join("\n");
}

function text(s) {
  return { content: [{ type: "text", text: String(s) }] };
}

function buildServeTools(previewPort) {
  return [
    {
      name: "workspace-serve",
      description:
        "Start (or reuse) a live preview for the workspace project at the current tree position. " +
        "Spawns the project's `node server.js` or serves its static index.html, and makes it reachable " +
        "at //<host>:" + previewPort + "/preview/<slug>/. Idempotent — reusing an already-running preview.",
      schema: { projectNodeId: z.string().optional() },
      annotations: { readOnlyHint: false },
      async handler({ projectNodeId, userId, rootId, nodeId }) {
        try {
          const targetId = projectNodeId || rootId || nodeId;
          const project = await loadProjectNode(targetId);
          if (!project) return text(`workspace-serve: node ${targetId} is not a project root. Run this at the project root.`);
          const wsPath = workspacePathFor(project);
          const entry = await startPreview({ projectNode: project, workspacePath: wsPath });
          const where = entry.kind === "static" ? `static dir: ${entry.staticDir}` : `child pid ${entry.pid} on :${entry.port}`;
          return text(`Preview "${entry.slug}" running — ${where}\nPreview URL: /preview/${entry.slug}/ (server on :${previewPort})`);
        } catch (err) {
          return text(`workspace-serve failed: ${err.message}`);
        }
      },
    },
    {
      name: "workspace-stop",
      description: "Stop a running preview for the workspace project at the current tree position.",
      schema: { projectNodeId: z.string().optional() },
      annotations: { readOnlyHint: false },
      async handler({ projectNodeId, userId, rootId, nodeId }) {
        try {
          const targetId = projectNodeId || rootId || nodeId;
          const project = await loadProjectNode(targetId);
          if (!project) return text(`workspace-stop: node ${targetId} is not a project root.`);
          const slug = slugify(project.name, project._id);
          const stopped = stopPreview(slug);
          return text(stopped ? `Stopped preview "${slug}".` : `No preview was running for "${slug}".`);
        } catch (err) {
          return text(`workspace-stop failed: ${err.message}`);
        }
      },
    },
    {
      name: "workspace-serve-status",
      description: "Report the running state of the preview for the current workspace project.",
      schema: { projectNodeId: z.string().optional() },
      annotations: { readOnlyHint: true },
      async handler({ projectNodeId, userId, rootId, nodeId }) {
        try {
          const targetId = projectNodeId || rootId || nodeId;
          const project = await loadProjectNode(targetId);
          if (!project) return text(`No project at node ${targetId}.`);
          const entry = getEntryByNodeId(project._id);
          if (!entry) return text(`"${project.name}" is not running.`);
          const tail = entry.stdout.slice(-10).join("\n") || "(no stdout)";
          return text(`"${entry.slug}" — kind=${entry.kind}${entry.port ? " port=" + entry.port : ""}${entry.pid ? " pid=" + entry.pid : ""}\nLast stdout:\n${tail}`);
        } catch (err) {
          return text(`workspace-serve-status failed: ${err.message}`);
        }
      },
    },
  ];
}

export async function init(core) {
  // LLM slots: one per mode so operators can pin a cheap model to
  // ask/coach and a strong model to plan/log.
  try {
    core.llm?.registerRootLlmSlot?.("code-plan");
    core.llm?.registerRootLlmSlot?.("code-log");
    core.llm?.registerRootLlmSlot?.("code-coach");
    core.llm?.registerRootLlmSlot?.("code-ask");
    core.llm?.registerRootLlmSlot?.("code-review");
  } catch {}

  core.modes.registerMode("tree:code-plan", planMode, "code-workspace");
  core.modes.registerMode("tree:code-log", logMode, "code-workspace");
  core.modes.registerMode("tree:code-coach", coachMode, "code-workspace");
  core.modes.registerMode("tree:code-ask", askMode, "code-workspace");
  core.modes.registerMode("tree:code-review", reviewMode, "code-workspace");

  try {
    core.llm?.registerModeAssignment?.("tree:code-plan", "code-plan");
    core.llm?.registerModeAssignment?.("tree:code-log", "code-log");
    core.llm?.registerModeAssignment?.("tree:code-coach", "code-coach");
    core.llm?.registerModeAssignment?.("tree:code-ask", "code-ask");
    core.llm?.registerModeAssignment?.("tree:code-review", "code-review");
  } catch {}

  // enrichContext:
  //   - Project root: inject workspace summary + its own aggregatedDetail
  //   - Branch node:  inject systemSpec + aggregatedDetail under this branch
  //                   + signalInbox (lateral sibling signals)
  //                   + subPlan (this branch's decomposition, if any)
  //   - File / dir:   file info for the current file position
  //
  // The self-similar shape means this handler reads the same fields
  // whether you're at the root, a mid-level branch, or a leaf file — the
  // rollup ensures every level has an up-to-date picture of what's under
  // it, and signalInbox carries lateral signals between siblings.
  core.hooks.register(
    "enrichContext",
    async ({ context, meta, nodeId, sessionId, dumpMode }) => {
      const data = meta?.["code-workspace"] || null;
      // Note: we do NOT return when data is null. Freshly-created tree
      // roots have no code-workspace metadata until the first file
      // write auto-initializes them, but the AI's turn-1 system prompt
      // still needs localView + nodePlan injection so the
      // compoundBranches and nodePlan facets fire. We only skip the
      // project/branch specific sections further down when data is
      // absent.

      // Active cascade watcher registration. When the AI's session
      // enriches context for a project or branch node, we treat that
      // as "session is working here" and register it as a watcher
      // so cross-session signals can find it. Skipped when called
      // via dumpContextForSession (dumpMode=true) so inspection
      // doesn't register fake watchers.
      if (data && sessionId && !dumpMode && (data.role === "project" || data.role === "branch")) {
        try {
          const projectId = data.role === "project"
            ? String(nodeId)
            : (data.parentProjectId || null);
          registerWatcher(sessionId, nodeId, projectId);
        } catch (err) {
          log.debug("CodeWorkspace", `registerWatcher failed: ${err.message}`);
        }
      }

      // Local node view — TreeOS principle: every node knows itself
      // and its immediate neighbors (parent + children + siblings).
      // If the AI needs to see deeper it navigates (workspace-list /
      // cd) and the view shifts. Flat project-wide walks are against
      // the grain — they centralize state that's meant to live
      // locally at each position. One level at a time, like a
      // filesystem.
      //
      // This is the fix for "AI ignores what already exists": with a
      // local view in its context, the AI sees existing files +
      // sibling branches on turn 0 instead of scanning .source for
      // references.
      try {
        const view = await localNodeView(nodeId);
        if (view) {
          // Two consumers, two shapes: the rendered string goes into
          // the prompt's CONTEXT FOR THIS TURN block so the AI can
          // read its neighbors, and the raw object goes under
          // localViewData so facet shouldInject checks can read
          // view.self.role / childCount. Without the raw object,
          // compoundBranches (and any future structural facet) was
          // walking `"string".self` and silently always returning
          // false — which is why branching never fired for a hundred
          // multi-layer requests.
          context.localView = formatLocalView(view);
          context.localViewData = view;
        }
      } catch (err) {
        log.debug("CodeWorkspace", `localNodeView skipped: ${err.message}`);
      }

      // Node-local plan steps + rolled-up descendant counts. Every node
      // plans for its own scope; the rollup lets a parent see the total
      // pending/done/blocked across its whole subtree without walking it.
      // The AI at each position reads its own plan and advances ONE step
      // per turn via workspace-plan.
      try {
        const [localSteps, rollup, drift, nodeDoc] = await Promise.all([
          readNodePlanSteps(nodeId),
          readNodeStepRollup(nodeId),
          readPlanDrift(nodeId),
          // Fall back to the raw node name when code-workspace metadata
          // doesn't exist yet (fresh uninitialized project root).
          (async () => {
            const N = (await import("../../seed/models/node.js")).default;
            return N.findById(nodeId).select("name").lean();
          })(),
        ]);
        // ALWAYS inject nodePlan so the facet fires on every workspace
        // turn — even when the plan is empty. An empty plan block is
        // how the AI learns "you need to set a plan first". If we only
        // injected when a plan existed, a fresh project would never
        // see the nodePlan facet and would start writing files without
        // planning. That was the bug on the snake build: turn 1 had no
        // facets because context.nodePlan was gated on hasLocal.
        context.nodePlan = formatNodePlan({
          steps: localSteps || [],
          rollup,
          nodeName: data?.name || nodeDoc?.name || null,
          drift,
        });
      } catch (err) {
        log.debug("CodeWorkspace", `nodePlan injection skipped: ${err.message}`);
      }

      // Blocking-syntax-error banner. If a file in this project is
      // still failing to parse, the tool handler will reject any
      // write that targets a DIFFERENT file. Surface the block in
      // the system prompt BEFORE the AI composes the next file, so
      // it never wastes tokens generating content that will be
      // rejected at submit time. Walks up to the project root once
      // to find the one checked against the write gate.
      try {
        const { findProjectForNode } = await import("./swarmEvents.js");
        const projectNode = data?.role === "project"
          ? { _id: nodeId, name: data?.name || null }
          : await findProjectForNode(nodeId);
        if (projectNode?._id) {
          const blocker = await findBlockingSyntaxError({
            projectNodeId: projectNode._id,
            targetFilePath: null, // we want "is ANY file broken?"
          });
          if (blocker) {
            const errFile = blocker?.payload?.file || blocker?.filePath;
            const line = blocker?.payload?.line;
            const msg = blocker?.payload?.message || "syntax error";
            context.blockingSyntaxError = {
              file: errFile,
              line,
              message: msg,
            };
          }
        }
      } catch (err) {
        log.debug("CodeWorkspace", `blocking-error injection skipped: ${err.message}`);
      }

      // Declared contracts. The architect publishes them on the
      // project root via setProjectContracts when it emits a
      // [[CONTRACTS]] block alongside [[BRANCHES]]. Every branch's
      // session walks to its project root and picks them up here, so
      // the system prompt at every branch position has the exact wire
      // protocol the architect designed. Branches implement the
      // declared types; the post-swarm conformance check flags any
      // branch that sends/receives a type not in the contracts.
      try {
        // Try from the current node first (walks ancestor chain),
        // then fall back to rootId directly. Branch nodes created
        // by the swarm may not have their parent set to the project
        // root, so the ancestor walk returns null. rootId is the
        // tree root, which IS the project root for code-workspace.
        let contracts = await readProjectContracts(nodeId);
        if (!contracts && rootId && rootId !== nodeId) {
          contracts = await readProjectContracts(rootId);
        }
        if (Array.isArray(contracts) && contracts.length > 0) {
          context.declaredContracts = contracts;
        }
      } catch (err) {
        log.debug("CodeWorkspace", `declaredContracts injection skipped: ${err.message}`);
      }

      // Position breadcrumb — walk the parent chain from the current
      // node up to the project root and render it as a tree-shaped
      // "you are here" marker. Available at every node level (file,
      // directory, branch, project) so the AI knows its tree position
      // and the spec at each enclosing level. Cheap: max ~6 ancestor
      // lookups with .lean(). Renders into context.swarmPosition.
      let projectMetaForContext = null;
      let ancestorIdsForContext = null;
      try {
        const breadcrumb = await buildPositionBreadcrumb(nodeId);
        if (breadcrumb) context.swarmPosition = breadcrumb;

        // Look up project + ancestor chain ONCE so the next two
        // injections (project spec + plan tree) don't repeat the walk.
        const found = await findProjectAndAncestors(nodeId);
        if (found) {
          projectMetaForContext = found.projectMeta;
          ancestorIdsForContext = found.ancestorIds;

          // Project spec propagation — surface the project's overall
          // systemSpec at every level (not just the project root).
          // A branch deep in routes/auth.js needs to know the project
          // is a "multiplayer snake game" without parsing the full
          // breadcrumb. This is a flat field so the prompt can render
          // it cleanly at the top of every continuation.
          if (found.projectMeta?.systemSpec) {
            context.projectSystemSpec = String(found.projectMeta.systemSpec).slice(0, 600);
          }
          if (found.projectNode?.name) {
            context.projectName = found.projectNode.name;
          }

          // Mid-build plan tree — render the WHOLE project plan
          // recursively, marking the path from the project root to
          // the current node. Every continuation turn sees what's
          // ahead, what's behind, what depends on its work, and where
          // it is in the tree.
          try {
            const planTree = await buildPlanTree(found.projectNode._id, found.ancestorIds);
            if (planTree) context.swarmPlanTree = planTree;
          } catch (planErr) {
            log.debug("CodeWorkspace", `plan tree skipped: ${planErr.message}`);
          }
        }
      } catch (err) {
        log.debug("CodeWorkspace", `position/spec/plan skipped: ${err.message}`);
      }

      if (data && (data.role === "project" || data.role === "branch")) {
        const levelName = data.role === "project" ? (data.name || "project") : null;
        context.workspace = data.role === "project"
          ? {
              name: data.name || null,
              workspacePath: data.workspacePath || null,
              initialized: !!data.initialized,
              task: data.systemSpec || null,
            }
          : undefined;

        if (data.role === "branch") {
          context.swarmBranch = {
            systemSpec: data.systemSpec || data.spec || null,
            path: data.path || null,
            files: data.files || [],
            status: data.status || "pending",
            parentBranch: data.parentBranch || null,
          };
        }

        // Aggregated detail — what's rolled up under this level. Works
        // identically at project and branch levels thanks to self-similar
        // storage. At root = everything. At a branch = everything below
        // this branch. Nothing if nothing's written yet.
        const aggFormatted = formatAggregatedDetail(
          data.aggregatedDetail,
          levelName,
        );
        if (aggFormatted) context.swarmAggregated = aggFormatted;

        // Cascaded context — lateral signals this level received from
        // siblings (the perspective filter decided what was worth
        // propagating). Key to solving the seam problem: frontend sees
        // backend's actual routes, not assumed ones.
        //
        // Active cascade: partition signals by the session's watermark.
        // Signals that arrived AFTER the session's last enrichContext
        // run render as a prominent "🔔 NEW SIGNALS" banner at the top
        // of the AI's context. Older signals render normally below.
        // Watermark advances AFTER rendering so a mid-turn crash
        // doesn't silently drop fresh signals.
        let sessionWatermark = null;
        let sessionPrevMeta = null;
        if (sessionId) {
          try {
            const { getSession } = await import("../../seed/ws/sessionRegistry.js");
            const sess = getSession(sessionId);
            sessionPrevMeta = sess?.meta?.codeWorkspace || null;
            sessionWatermark = sessionPrevMeta?.lastSeenCascadedAt || null;
          } catch {}
        }
        const { fresh, seen } = partitionCascaded(data.signalInbox, sessionWatermark);
        const freshBanner = formatFreshBanner(fresh);
        if (freshBanner) context.swarmFreshSignals = freshBanner;
        const signalsFormatted = formatSignalInbox(seen);
        if (signalsFormatted) context.swarmLateralSignals = signalsFormatted;

        // Advance the watermark now that rendering succeeded — but ONLY
        // when not in dump mode. dumpContextForSession is read-only:
        // the operator inspecting context must not "consume" fresh
        // signals and hide them from the next real turn.
        if (sessionId && !dumpMode && Array.isArray(data.signalInbox) && data.signalInbox.length > 0) {
          try {
            const { updateSessionMeta } = await import("../../seed/ws/sessionRegistry.js");
            updateSessionMeta(sessionId, {
              codeWorkspace: {
                ...(sessionPrevMeta || {}),
                lastSeenCascadedAt: Date.now(),
                nudgeFlag: false,
                nudgeReason: null,
              },
            });
          } catch (err) {
            log.debug("CodeWorkspace", `watermark advance failed: ${err.message}`);
          }
        }

        // Declared contracts — shared truth between branches. Only
        // rendered at branch level (the project root already has other
        // context) and only for branches that might be consuming the
        // contracts (i.e., anything that writes frontend-style fetch
        // calls or another backend route for the same project). We
        // err on the side of ALWAYS showing to any working branch so
        // the model has no excuse to invent field names.
        if (data.role === "branch") {
          try {
            const { default: NodeModel } = await import("../../seed/models/node.js");
            const cur = await NodeModel.findById(nodeId).select("metadata").lean();
            const curMeta = cur?.metadata instanceof Map
              ? cur.metadata.get("code-workspace")
              : cur?.metadata?.["code-workspace"];
            const projectId = curMeta?.parentProjectId;
            if (projectId) {
              const contracts = await readContracts(projectId);
              const formatted = formatContracts(contracts);
              if (formatted) context.swarmContracts = formatted;
            }
          } catch (err) {
            log.debug("CodeWorkspace", `contract enrichContext skipped: ${err.message}`);
          }
        }

        // Sub-plan — the decomposition beneath this level. Shows which
        // children are done/running/pending so the model at this level
        // knows what's in flight.
        if (data.subPlan?.branches?.length > 0) {
          const lines = ["Direct sub-branches under this level:"];
          for (const b of data.subPlan.branches.slice(0, 20)) {
            const icon =
              b.status === "done" ? "✓" :
              b.status === "failed" ? "✗" :
              b.status === "running" ? "▶" : "·";
            lines.push(`  ${icon} ${b.name}${b.summary ? " — " + String(b.summary).slice(0, 120) : ""}`);
          }
          context.swarmSubPlan = lines.join("\n");
        }
      } else if (data && data.role === "file") {
        context.code = {
          role: "file",
          filePath: data.filePath || null,
          language: data.language || null,
        };
      } else if (data && data.role === "directory") {
        context.code = {
          role: "directory",
          filePath: data.filePath || null,
        };
      }
    },
    "code-workspace",
  );

  // afterNote: when a file write lands inside a workspace branch, run the
  // perspective filter over the content, roll the delta up to ancestors,
  // and lateral-propagate contract-affecting signals to siblings. This
  // is the main driver of self-similar state maintenance.
  core.hooks.register(
    "afterNote",
    async ({ note, nodeId, contentType, action }) => {
      if (contentType !== "text") return;
      if (!nodeId) return;
      try {
        const found = await findBranchContext(nodeId);
        if (!found) return;
        const { branchNode, projectNode } = found;

        const { default: NodeModel } = await import("../../seed/models/node.js");
        const fileNode = await NodeModel.findById(nodeId).select("name metadata").lean();
        const fileMeta = fileNode?.metadata instanceof Map
          ? fileNode.metadata.get("code-workspace")
          : fileNode?.metadata?.["code-workspace"];
        const filePath = fileMeta?.filePath || fileNode?.name || String(nodeId);

        // Keep the flat event log on the project root for the dashboard
        // and the history view.
        const summary = summarizeWrite(note?.content || "");
        await recordSwarmEvent({
          projectNodeId: projectNode._id,
          event: {
            branchName: branchNode?.name || null,
            branchId: branchNode?._id ? String(branchNode._id) : null,
            filePath,
            kind: action === "edit" ? "edit" : "wrote",
            summary,
          },
          core,
        });

        // Roll the delta up the ancestor chain. Every branch and the
        // project root gets its aggregatedDetail merged.
        const classification = classifyWrite({
          filePath,
          content: note?.content || "",
        });
        await rollUpDetail({
          fromNodeId: nodeId,
          delta: {
            filesWrittenDelta: 1,
            newContracts: classification.signals,
            lastActivity: new Date().toISOString(),
          },
          core,
        });

        // Lateral propagation: if the write is contract-affecting AND the
        // file sits inside a branch, fan the signals to that branch's
        // siblings so their next session sees them in their inbox.
        let siblingCountForCascade = 0;
        if (classification.isContract && branchNode && classification.signals.length > 0) {
          const siblings = await findBranchSiblings(branchNode._id);
          siblingCountForCascade = siblings.length;
          if (siblings.length > 0) {
            for (const sib of siblings) {
              await appendSignalInbox({
                nodeId: sib._id,
                signal: {
                  from: branchNode.name,
                  kind: SIGNAL_KIND.CONTRACT,
                  filePath,
                  payload: classification.signals.slice(0, 8).join(" · "),
                },
                core,
              });
              // Mark the sibling's plan as potentially stale — their
              // checklist may reference the old shape of this contract.
              // The marker is cleared the next time the sibling touches
              // its plan (set/add/check), so drift doesn't linger after
              // an acknowledged replan.
              await markPlanDrift({
                nodeId: sib._id,
                reason: `${branchNode.name} updated ${filePath}`,
                core,
              });
              // Active cascade: wake any running session watching this
              // sibling (or its ancestors) so they see the new contract
              // signal in their NEXT turn's fresh banner.
              await notifySignal(sib._id, { reason: "contract cascade" });
            }
            log.info(
              "CodeWorkspace",
              `📡 Swarm cascade: ${branchNode.name} → ${siblings.length} sibling(s) (${classification.signals.length} contract signals from ${filePath})`,
            );
          }
        }

        // Fire a kernel-level cascade record so the Flow dashboard shows
        // code-workspace activity alongside every other extension's
        // events. The sibling fan-out above is a private per-node AI
        // inbox (code-workspace's signalInbox), but operators watching
        // the Flow dashboard want to see "backend wrote room.js, 3
        // contracts, fanned to 16 siblings" as a global event. One
        // checkCascade call at the project root per file write does
        // that. The project root is cascade-enabled by initProject, so
        // the kernel onCascade hook + .flow write path is ready.
        if (projectNode?._id) {
          try {
            const { checkCascade } = await import("../../seed/tree/cascade.js");
            await checkCascade(String(projectNode._id), {
              action: "code:write",
              source: "code-workspace",
              kind: classification.isContract ? "contract" : "write",
              filePath,
              branch: branchNode?.name || null,
              signals: classification.signals.slice(0, 8),
              siblingCount: siblingCountForCascade,
            });
          } catch (err) {
            log.debug("CodeWorkspace", `kernel checkCascade skipped: ${err.message}`);
          }
        }

        // Syntax validation. Run AFTER the perspective filter + rollup +
        // lateral propagation so we don't block cascade work on a
        // validator hiccup. Uses the raw note.content from memory — the
        // exact bytes the model just wrote, not a re-read from disk.
        //
        // Runs for ANY file write inside a project, whether or not the
        // file sits under a branch node. Previously this was gated on
        // `branchNode` which meant files written at the project root
        // (by a non-swarm plan-mode call, or by a swarm write whose
        // tree position was at the root) bypassed syntax validation
        // entirely — resulting in hard parse errors surviving to the
        // preview spawner. The signal is attached to the branch when
        // one exists (so the retry loop picks it up); otherwise it
        // attaches to the project root.
        //
        // On success: prune any prior syntax-error signals for this
        // file from wherever they live.
        const signalTargetId = branchNode?._id || projectNode?._id;
        if (signalTargetId && note?.content != null) {
          try {
            const validation = validateSyntax({
              filePath,
              content: note.content,
            });
            // Surface _skipped at INFO so a silent miss is visible
            // without running at debug level. _skipped means the
            // validator couldn't run (timeout, spawn error) and fell
            // open to "valid" — which is dangerous.
            if (validation._skipped) {
              log.warn(
                "CodeWorkspace",
                `⚠️  Syntax validator fell open on ${filePath}: ${validation._reason || "(unknown)"}`,
              );
            }
            if (!validation.ok && validation.error) {
              await appendSignalInbox({
                nodeId: signalTargetId,
                signal: {
                  from: branchNode?.name || projectNode?.name || "project",
                  kind: SIGNAL_KIND.SYNTAX_ERROR,
                  filePath,
                  payload: validation.error,
                },
                core,
              });
              await notifySignal(signalTargetId, { reason: "syntax error" });
              log.warn(
                "CodeWorkspace",
                `🔴 Syntax error in ${filePath} (line ${validation.error.line}): ${validation.error.message}`,
              );
            } else if (validation.ok && !validation._skipped) {
              // File parses cleanly — if any prior errors for this file
              // are in signalInbox, prune them. They're resolved.
              await pruneSignalInboxForFile({
                nodeId: signalTargetId,
                filePath,
                core,
              });
            }
          } catch (err) {
            log.warn("CodeWorkspace", `Validator threw on ${filePath}: ${err.message}`);
          }
        }

        // Dead-receiver detection (phase 4a). Runs only on JS files.
        // Only fires when the file PARSES — running on broken syntax
        // would just produce noise (the receiver patterns lean on
        // well-formed regions). Targets the same node as syntax
        // signals (branch if available, else project root).
        if (signalTargetId && note?.content && /\.[cm]?js$/.test(filePath)) {
          try {
            const drResult = detectDeadReceivers({
              filePath,
              content: note.content,
            });
            if (drResult.issues.length > 0) {
              for (const issue of drResult.issues) {
                await appendSignalInbox({
                  nodeId: signalTargetId,
                  signal: {
                    from: branchNode?.name || projectNode?.name || "project",
                    kind: SIGNAL_KIND.DEAD_RECEIVER,
                    filePath,
                    payload: issue,
                  },
                  core,
                });
              }
              await notifySignal(signalTargetId, { reason: "dead receiver" });
              log.warn(
                "CodeWorkspace",
                `👻 ${drResult.issues.length} dead-receiver(s) in ${filePath}: ${drResult.issues.map((i) => i.message.slice(0, 60)).join(" | ")}`,
              );
            }
          } catch (err) {
            log.debug("CodeWorkspace", `Dead-receiver scan skipped for ${filePath}: ${err.message}`);
          }
        }

        // Phase 2 contract extraction + diff.
        //
        // Two paths:
        //
        // 1. Backend path: the file looks like a route file. Extract
        //    contracts (endpoint, method, request body, response shape),
        //    replace any prior contracts from this same source file on
        //    the project root, emit CONTRACT signals to siblings.
        //
        // 2. Frontend path: the file has fetch() calls. Extract the
        //    expected request/response shapes, diff against existing
        //    contracts on the project root, emit CONTRACT_MISMATCH
        //    signals per field disagreement to this branch's own
        //    signalInbox (so the retry loop fixes the frontend).
        //
        // A file may legitimately be both (e.g. a Next.js page that
        // defines an API route and calls fetch elsewhere). We run both
        // extractors and merge.
        if (projectNode && note?.content) {
          try {
            const fileContent = note.content;

            // Path 1: backend contract extraction
            const backendResult = extractBackendContracts({
              filePath,
              content: fileContent,
              mountPrefix: null,
            });
            if (backendResult.contracts.length > 0) {
              const { added, removed, changed } = await replaceContractsFromFile({
                projectNodeId: projectNode._id,
                sourceFile: filePath,
                newContracts: backendResult.contracts,
                declaredBy: branchNode?.name || null,
                core,
              });
              if (added || removed || changed) {
                log.info(
                  "CodeWorkspace",
                  `📜 Contracts from ${filePath}: +${added} −${removed} Δ${changed}`,
                );
              }
              // Also cascade a CONTRACT signal to siblings so they know
              // something changed on this endpoint surface
              if (branchNode) {
                const siblings = await findBranchSiblings(branchNode._id);
                for (const sib of siblings) {
                  await appendSignalInbox({
                    nodeId: sib._id,
                    signal: {
                      from: branchNode.name,
                      kind: SIGNAL_KIND.CONTRACT,
                      filePath,
                      payload: `${backendResult.contracts.length} contract(s) declared on ${filePath}`,
                    },
                    core,
                  });
                  await notifySignal(sib._id, { reason: "backend contracts" });
                }
              }
            }

            // Path 2: frontend expectation diff
            const frontendResult = extractFrontendExpectations({
              filePath,
              content: fileContent,
            });
            if (frontendResult.expectations.length > 0 && branchNode) {
              const existingContracts = await readContracts(projectNode._id);
              if (existingContracts.length > 0) {
                // Clear any stale mismatches for this file before
                // re-diffing — a rewrite may have resolved them.
                const { pruneContractMismatchesForFile } = await import("./swarmEvents.js");
                await pruneContractMismatchesForFile({
                  nodeId: branchNode._id,
                  filePath,
                  core,
                });

                const allMismatches = [];
                for (const expectation of frontendResult.expectations) {
                  const mismatches = diffContracts({
                    contracts: existingContracts,
                    expectation,
                  });
                  for (const mm of mismatches) {
                    allMismatches.push(mm);
                  }
                }
                if (allMismatches.length > 0) {
                  for (const mm of allMismatches) {
                    // Flatten the payload: extract only scalar fields from the
                    // nested `contract` and `expectation` sub-objects so the
                    // signal stays at depth 4 within the metadata namespace.
                    // renderFieldMismatch in swarmEvents.js reads these flat keys.
                    const flatPayload = {
                      kind: mm.kind,
                      severity: mm.severity,
                      key: mm.key,
                      contractKeys: Array.isArray(mm.contractKeys) ? mm.contractKeys : [],
                      contractMethod: mm.contract?.method ?? null,
                      contractEndpoint: mm.contract?.endpoint ?? null,
                      contractSourceFile: mm.contract?.sourceFile ?? null,
                      contractSourceLine: mm.contract?.sourceLine ?? null,
                      expectationMethod: mm.expectation?.method ?? null,
                      expectationEndpoint: mm.expectation?.endpoint ?? null,
                      expectationSourceFile: mm.expectation?.sourceFile ?? null,
                      expectationSourceLine: mm.expectation?.sourceLine ?? null,
                    };
                    await appendSignalInbox({
                      nodeId: branchNode._id,
                      signal: {
                        from: branchNode.name,
                        kind: SIGNAL_KIND.CONTRACT_MISMATCH,
                        filePath,
                        payload: flatPayload,
                      },
                      core,
                    });
                  }
                  await notifySignal(branchNode._id, { reason: "contract mismatch" });
                  log.warn(
                    "CodeWorkspace",
                    `🔗 ${allMismatches.length} contract mismatch(es) in ${filePath} — will retry`,
                  );
                }
              }
            }
          } catch (err) {
            log.debug("CodeWorkspace", `Contract extraction skipped for ${filePath}: ${err.message}`);
          }
        }
      } catch (err) {
        log.debug("CodeWorkspace", `afterNote swarm record failed: ${err.message}`);
      }
    },
    "code-workspace",
  );

  // onCascade listener. The kernel fires this when cascade is enabled on
  // a node and content is written there. Extensions inspect the signal
  // and optionally react. For code-workspace, the afterNote path already
  // handles rollup and lateral fan-out for branch file writes — this
  // listener catches cascades that originate elsewhere (e.g., a direct
  // note write on a project root, a non-swarm write that still matters).
  //
  // v1 just logs and returns success. Full work happens in afterNote.
  // When we add the contradiction or codebook integrations, they'll
  // hook here too.
  // Active cascade: drop dead sessions from the watcher reverse index
  // when they end. Without this, long-running lands accumulate phantom
  // watchers that never wake and never unregister.
  core.hooks.register(
    "afterSessionEnd",
    async ({ sessionId }) => {
      try {
        unregisterWatcher(sessionId);
      } catch {}
    },
    "code-workspace",
  );

  core.hooks.register(
    "onCascade",
    async (payload) => {
      try {
        const { nodeId, action } = payload || {};
        if (!nodeId) return;
        // Return a result so the kernel records the cascade outcome.
        return {
          extension: "code-workspace",
          status: "succeeded",
          summary: `code-workspace observed cascade at ${nodeId} (${action || "unknown"})`,
        };
      } catch (err) {
        return {
          extension: "code-workspace",
          status: "failed",
          error: err.message,
        };
      }
    },
    "code-workspace",
  );

  // Auto-sync is handled inline by the write tools (see tools.js). We
  // can't use an afterNote hook here because writeFileContent calls
  // Note.create directly (bypassing the note CRUD hooks) so code file
  // content can exceed the user note size cap. The tools call
  // scheduleSync right after every write, which debounces per project.

  // Boot-time ingest of land/extensions/ and land/seed/ into the .source
  // self-tree. Runs AFTER the extension loader finishes and DB is ready,
  // via the afterBoot hook. First boot: full ingest. Subsequent boots:
  // mtime-based incremental refresh — only changed files are re-read.
  // Fire-and-forget so a slow ingest doesn't block boot-completion;
  // log progress through the normal CodeWorkspace log prefix.
  core.hooks.register(
    "afterBoot",
    async () => {
      try {
        const res = await ensureSourceTree(core);
        if (res?.created) {
          log.info("CodeWorkspace", `.source self-tree initialized: ${res.fileCount ?? 0} files, ${res.dirCount ?? 0} dirs. writeMode=disabled (read-only). Use 'source-mode free' to enable writes.`);
        } else if (res?.refreshed) {
          log.info("CodeWorkspace", `.source self-tree refreshed: ${res.updated ?? 0} updated, ${res.added ?? 0} added, ${res.removed ?? 0} removed, ${res.unchanged ?? 0} unchanged.`);
        }
      } catch (err) {
        log.error("CodeWorkspace", `.source boot ingest failed: ${err.message}`);
        log.error("CodeWorkspace", err.stack?.split("\n").slice(0, 5).join("\n"));
      }
    },
    "code-workspace",
  );

  // Serve subsystem: runs through the main land router. No second HTTP
  // server, no extra port. Preview requests arrive at /api/v1/preview/<slug>/*
  // and are either streamed from the workspace's static dir or proxied to
  // the spawned child process on 127.0.0.1:<allocated port>. Idle reaper
  // kills stale children; SIGINT/SIGTERM cleans up all children at exit.
  // previewPort is retained as a logical marker (used by the slot for log
  // lines) but no secondary listener is opened.
  const previewPort = Number(getLandConfigValue("codeServePreviewPort")) || DEFAULT_PREVIEW_PORT;

  try {
    const { getExtension } = await import("../loader.js");
    const treeos = getExtension("treeos-base");
    if (treeos?.exports?.registerSlot) {
      treeos.exports.registerSlot(
        "tree-owner-sections",
        "code-workspace",
        registerCodeServeSlot({ previewPort }),
        { priority: 5 },
      );
      log.info("CodeWorkspace", "serve: registered tree-owner-sections slot");
    } else {
      log.warn("CodeWorkspace", "serve: treeos-base.registerSlot unavailable — Run button disabled");
    }
  } catch (err) {
    log.warn("CodeWorkspace", `serve: slot registration skipped: ${err.message}`);
  }

  startIdleReaper();

  // Install the preview WebSocket upgrade proxy once the land's HTTP
  // server is up and listening. Extensions init BEFORE server.listen
  // runs, so `getHttpServer()` returns null here — we defer to the
  // `afterBoot` lifecycle hook, which the kernel fires "once after
  // all extensions loaded, config initialized, server listening". At
  // that point the raw http.Server is definitely available.
  core.hooks.register(
    "afterBoot",
    async () => {
      try {
        const httpServer = core?.websocket?.getHttpServer?.();
        if (!httpServer) {
          log.warn("CodeWorkspace", "afterBoot: no http.Server — WS upgrade proxy NOT installed");
          return;
        }
        installPreviewUpgradeProxy(httpServer);
      } catch (err) {
        log.warn("CodeWorkspace", `afterBoot WS proxy install failed: ${err.message}`);
      }
    },
    "code-workspace",
  );

  const serveShutdown = () => {
    log.info("CodeWorkspace", "serve: shutting down — stopping all previews");
    stopAllPreviews();
  };
  process.once("SIGINT", serveShutdown);
  process.once("SIGTERM", serveShutdown);
  process.once("beforeExit", serveShutdown);

  const workspaceTools = getWorkspaceTools(core);
  const serveTools = buildServeTools(previewPort);
  const tools = [...workspaceTools, ...serveTools];

  log.info("CodeWorkspace", `Loaded v0.6.0. 5 modes (code-plan/log/coach/ask/review). ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}. Live preview mounted at /api/v1/preview/<slug>/. Confined — run 'ext-allow code-workspace' at a tree root to activate.`);

  return {
    tools,
    router: createServeRouter(core),

    // No modeTools injection. code-workspace owns its own modes fully.
    // Other extensions (e.g. code-forge) reach workspace functions via
    // getExtension("code-workspace").exports.* rather than re-implementing
    // any tree↔note plumbing.
    exports: {
      // Active cascade primitives — called by the orchestrator between
      // turns and by the workspace-show-context tool. See sessionWatch.js
      // for the full contract.
      maybeApplyCascadeNudge,
      dumpContextForSession,

      async getProjectByName(rootId, name) {
        const { findProjectByName } = await import("./workspace.js");
        return findProjectByName(rootId, name);
      },
      async initProject(args) {
        const { initProject } = await import("./workspace.js");
        return initProject(args);
      },
      async addFile(args) {
        const { resolveOrCreateFile, writeFileContent } = await import("./workspace.js");
        const { fileNode, created } = await resolveOrCreateFile(args);
        await writeFileContent({ fileNodeId: fileNode._id, content: args.content, userId: args.userId });
        return { fileNode, created };
      },
      async readFile({ projectNodeId, relPath, userId, core: c }) {
        const { resolveOrCreateFile, readFileContent } = await import("./workspace.js");
        const { fileNode, created } = await resolveOrCreateFile({ projectNodeId, relPath, userId, core: c });
        if (created) return "";
        return readFileContent(fileNode._id);
      },
      async walkFiles(projectNodeId) {
        const { walkProjectFiles } = await import("./workspace.js");
        return walkProjectFiles(projectNodeId);
      },
      async syncUp(projectNodeId) {
        const { syncUp } = await import("./sync.js");
        return syncUp(projectNodeId);
      },
      async runInWorkspace(args) {
        const { runInWorkspace } = await import("./sandbox.js");
        return runInWorkspace(args);
      },
      readMeta,
      // Serve subsystem exports — let other extensions (code-forge, etc.)
      // drive previews programmatically.
      startPreview,
      stopPreview,
      getServeEntryByNodeId: getEntryByNodeId,
      allServeEntries: allEntries,
    },
  };
}
