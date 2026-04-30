import log from "../../seed/log.js";
import getWorkspaceTools, { writeFileInBranch, readFileInBranch } from "./tools.js";
import { readMeta, localNodeView, initProject, getWorkspacePath, resolveWorkspaceRoot } from "./workspace.js";
import { refreshChildSummary } from "./summaryRefresh.js";
import { ensureSourceTree } from "./source.js";
import { getLandConfigValue } from "../../seed/landConfig.js";
import {
  pruneSignalInboxForFile,
  pruneContractMismatchesForFile,
  formatAggregatedDetail,
  formatSignalInbox,
  formatSwarmContext,
  formatContracts,
  replaceContractsFromFile,
  summarizeWrite,
  summaryTier,
  SIGNAL_KIND,
  readNodePlanSteps,
  readNodeStepRollup,
  readPlanDrift,
  markPlanDrift,
  formatNodePlan,
  findBlockingSyntaxError,
} from "./swarmEvents.js";
import { classifyWrite } from "./perspectiveFilter.js";
import { validateSyntax } from "./validators/syntax.js";
import {
  extractBackendContracts,
  extractFrontendExpectations,
  diffContracts,
} from "./validators/contracts.js";
import { detectDeadReceivers } from "./validators/deadReceivers.js";
import { smokeBranch } from "./validators/smoke.js";
import { smokeIntegration } from "./validators/integration.js";
import { smokeWsSeam } from "./validators/wsSeam.js";
import { runBehavioralTests } from "./validators/behavioralTest.js";
import { checkContractConformance } from "./validators/contractConformance.js";
import { checkSymbolCoherence } from "./validators/symbolCoherence.js";
import { checkLoadGraph } from "./validators/loadGraph.js";
import { runScout } from "./validators/scout.js";
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
import summarizeMode from "./modes/summarize.js";

// Serve subsystem — live preview of workspace projects
import createServeRouter from "./serve/routes.js";
import { registerStrategy, buildStrategyContextBlock, listStrategies } from "./strategyRegistry.js";
import { branchSummary } from "./fileSurface.js";
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

async function swarm() {
  const { getExtension } = await import("../loader.js");
  return getExtension("swarm")?.exports;
}

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

  // Walk up collecting nodes. Each entry carries both namespaces:
  // swarm metadata (role, systemSpec, subPlan, aggregatedDetail,
  // inbox) and code-workspace metadata (filePath for file nodes).
  const chain = [];
  let cursor = String(nodeId);
  let guard = 0;
  while (cursor && guard < 8) {
    const n = await NodeModel.findById(cursor).select("_id name parent metadata").lean();
    if (!n) break;
    const cwMeta = n.metadata instanceof Map
      ? n.metadata.get("code-workspace")
      : n.metadata?.["code-workspace"];
    const swMeta = n.metadata instanceof Map
      ? n.metadata.get("swarm")
      : n.metadata?.["swarm"];
    chain.push({ node: n, cwMeta, swMeta });
    if (swMeta?.role === "project") break;
    if (!n.parent) break;
    cursor = String(n.parent);
    guard++;
  }
  if (chain.length === 0) return null;
  chain.reverse();

  const project = chain.find((c) => c.swMeta?.role === "project");
  if (!project) return null;

  const lines = ["## YOUR POSITION IN THE TREE"];
  lines.push("");

  for (let i = 0; i < chain.length; i++) {
    const { node, cwMeta, swMeta } = chain[i];
    const isCurrent = i === chain.length - 1;
    const indent = "  ".repeat(i);
    const arrow = i > 0 ? "└ " : "";
    const here = isCurrent ? "  ← YOU ARE HERE" : "";
    const role = swMeta?.role || cwMeta?.role;
    const roleLabel = role ? ` (${role})` : "";
    lines.push(`${indent}${arrow}${node.name}${roleLabel}${here}`);

    if (swMeta?.role === "project") {
      if (swMeta.systemSpec) lines.push(`${indent}  spec: ${truncate(swMeta.systemSpec, 200)}`);
      const counts = swMeta.aggregatedDetail?.statusCounts;
      const subBranches = swMeta.subPlan?.branches?.length || 0;
      if (subBranches > 0) {
        const done = counts?.done || 0;
        lines.push(`${indent}  status: ${done}/${subBranches} branches done`);
      }
      const verified = swMeta.aggregatedDetail?.verifiedEndpoints;
      if (verified && Object.keys(verified).length > 0) {
        lines.push(`${indent}  verified endpoints: ${Object.keys(verified).length}`);
      }
    } else if (swMeta?.role === "branch") {
      const spec = swMeta.systemSpec || swMeta.spec;
      if (spec) lines.push(`${indent}  spec: ${truncate(spec, 160)}`);
      if (swMeta.path) lines.push(`${indent}  path: ${swMeta.path}`);
      const filesWritten = swMeta.aggregatedDetail?.filesWritten || 0;
      if (filesWritten > 0) lines.push(`${indent}  files written so far: ${filesWritten}`);
      const sigCount = Array.isArray(swMeta.inbox) ? swMeta.inbox.length : 0;
      if (sigCount > 0) lines.push(`${indent}  pending signals: ${sigCount}`);
    } else if (cwMeta?.role === "file") {
      if (cwMeta.filePath) lines.push(`${indent}  file: ${cwMeta.filePath}`);
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

  // Sibling peers intentionally NOT rendered. The two callers of this
  // view (code-plan / code-coach / code-log via enrichContext) get the
  // useful sibling info from the dedicated "Sibling Branches" block,
  // which carries status, file list, exports, and surface line per
  // sibling — far more useful than a flat name list. The flat list
  // here was 30+ lines of unrelated peer projects + system nodes
  // (.config, .extensions, .source, etc.) on every prompt, with zero
  // build value. Keep the parent + self + children breakdown above;
  // peers come from the structured sibling-branches block when needed.
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
    const swMeta = n.metadata instanceof Map
      ? n.metadata.get("swarm")
      : n.metadata?.["swarm"];
    if (swMeta?.role === "project") {
      return { projectNode: n, projectMeta: swMeta, ancestorIds };
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
      ? parent.metadata.get("swarm")
      : parent.metadata?.["swarm"];
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

/**
 * Render a swarm project's subPlan + aggregatedDetail + contracts into a
 * human-readable plan.md written at the project root. The source of truth
 * is metadata.swarm on each node; plan.md is just a projection for disk
 * consumption + the git history.
 */
async function writeSwarmPlan({ projectNode, userRequest, userId, core }) {
  try {
    const { default: NodeModel } = await import("../../seed/models/node.js");

    async function renderNodeSection(nodeId, depth) {
      const n = await NodeModel.findById(nodeId).select("_id name metadata").lean();
      if (!n) return [];
      const meta = n.metadata instanceof Map
        ? n.metadata.get("swarm")
        : n.metadata?.["swarm"];
      if (!meta) return [];

      const lines = [];
      const headingLevel = Math.min(2 + depth, 6);
      const prefix = "#".repeat(headingLevel);
      const icon =
        meta.status === "done" ? "✅" :
        meta.status === "failed" ? "❌" :
        meta.status === "running" ? "🟡" : "⏳";
      const label = meta.role === "project"
        ? `${prefix} Project: ${n.name}`
        : `${prefix} ${icon} ${n.name}`;
      lines.push(label);
      lines.push("");

      if (meta.systemSpec || meta.spec) {
        lines.push(`**Spec:** ${meta.systemSpec || meta.spec}`);
      }
      if (meta.path) lines.push(`**Path:** \`${meta.path}\``);
      if (Array.isArray(meta.files) && meta.files.length) {
        lines.push(`**Files:** ${meta.files.map((f) => `\`${f}\``).join(", ")}`);
      }
      if (meta.slot) lines.push(`**LLM slot:** \`${meta.slot}\``);
      if (meta.summary) lines.push(`**Result:** ${truncate(meta.summary, 400)}`);
      if (meta.error) lines.push(`**Error:** ${meta.error}`);

      const agg = meta.aggregatedDetail;
      if (agg && (agg.filesWritten > 0 || (agg.contracts && agg.contracts.length > 0))) {
        lines.push("");
        lines.push(`**Aggregated under here:** ${agg.filesWritten || 0} files written`);
        if (agg.contracts?.length) {
          lines.push("**Established contracts:**");
          for (const c of agg.contracts.slice(-12)) {
            lines.push(`- \`${c}\``);
          }
        }
      }

      if (Array.isArray(meta.inbox) && meta.inbox.length > 0) {
        lines.push("");
        lines.push(`**Lateral signals received:** ${meta.inbox.length}`);
        for (const sig of meta.inbox.slice(-6)) {
          const payload = typeof sig.payload === "string" ? sig.payload : JSON.stringify(sig.payload);
          lines.push(`- from ${sig.from || "?"}: ${truncate(payload, 200)}`);
        }
      }

      lines.push("");

      // Walk children via the unified plan namespace (branch kind steps).
      try {
        const planExt = (await import("../loader.js")).getExtension("plan")?.exports;
        const planObj = planExt ? await planExt.readPlan(nodeId) : null;
        const branchSteps = (planObj?.steps || []).filter((s) => s.kind === "branch");
        if (branchSteps.length > 0 && depth < 6) {
          for (const child of branchSteps) {
            const childId = child.childNodeId;
            if (!childId) continue;
            const childLines = await renderNodeSection(childId, depth + 1);
            lines.push(...childLines);
          }
        }
      } catch {}

      return lines;
    }

    const lines = [
      `# Project Plan: ${projectNode.name || "project"}`,
      "",
      "## Request",
      "",
      userRequest || "(no request text)",
      "",
      "## Structure",
      "",
    ];

    const rootSection = await renderNodeSection(projectNode._id, 0);
    rootSection.shift();
    lines.push(...rootSection);

    try {
      const { getExtension } = await import("../loader.js");
      const sw = getExtension("swarm")?.exports;
      const contracts = sw?.readContracts ? await sw.readContracts(projectNode._id) : null;
      if (Array.isArray(contracts) && contracts.length > 0) {
        lines.push("");
        lines.push("## Declared API Contracts");
        lines.push("");
        lines.push("These are the field-level contracts each branch committed to.");
        lines.push("Siblings read them via enrichContext and the validator diffs new writes against them.");
        lines.push("");
        const sorted = [...contracts].sort((a, b) => {
          if (a.endpoint !== b.endpoint) return a.endpoint.localeCompare(b.endpoint);
          return a.method.localeCompare(b.method);
        });
        for (const c of sorted) {
          const by = c.declaredBy ? ` _[${c.declaredBy}]_` : "";
          const src = c.sourceFile ? ` \`${c.sourceFile}:${c.sourceLine || "?"}\`` : "";
          lines.push(`### \`${c.method} ${c.endpoint}\`${by}`);
          lines.push(`Source: ${src}`);
          const body = c.request?.body || [];
          if (body.length > 0) {
            lines.push(`- **request.body:** ${body.map((k) => `\`${k}\``).join(", ")}`);
          }
          const shape = c.response?.shape || [];
          if (shape.length > 0) {
            lines.push(`- **response:** ${shape.map((k) => `\`${k}\``).join(", ")}`);
          } else if (c.response?.inferred === "variable") {
            lines.push(`- **response:** _(dynamic — shape unknown at extraction time)_`);
          }
          lines.push("");
        }
      }
    } catch (err) {
      log.debug("CodeWorkspace", `plan.md contracts section skipped: ${err.message}`);
    }

    lines.push("---");
    lines.push("");
    lines.push(`_Generated ${new Date().toISOString()} by the TreeOS swarm runner._`);
    lines.push(`_Each node's subPlan and aggregatedDetail live at metadata.swarm — this file is just a projection._`);

    const content = lines.join("\n");

    const { resolveOrCreateFile, writeFileContent } = await import("./workspace.js");
    const { fileNode } = await resolveOrCreateFile({
      projectNodeId: projectNode._id,
      relPath: "plan.md",
      userId: userId || null,
      core,
    });
    await writeFileContent({ fileNodeId: fileNode._id, content, userId: userId || null });
    log.info("CodeWorkspace", `📄 Swarm: wrote plan.md at ${projectNode.name} (from distributed subPlan)`);
  } catch (err) {
    log.warn("CodeWorkspace", `writeSwarmPlan failed: ${err.message}`);
  }
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
  core.modes.registerMode("tree:code-summarize", summarizeMode, "code-workspace");

  try {
    core.llm?.registerModeAssignment?.("tree:code-plan", "code-plan");
    core.llm?.registerModeAssignment?.("tree:code-log", "code-log");
    core.llm?.registerModeAssignment?.("tree:code-coach", "code-coach");
    core.llm?.registerModeAssignment?.("tree:code-ask", "code-ask");
    core.llm?.registerModeAssignment?.("tree:code-review", "code-review");
    // The summarizer reuses code-log's slot (same small-model profile),
    // so it doesn't require its own slot config on every tree.
    core.llm?.registerModeAssignment?.("tree:code-summarize", "code-log");
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
    async ({ context, meta, nodeId, sessionId, dumpMode, rootId }) => {
      const cwData = meta?.["code-workspace"] || null;
      const swData = meta?.["swarm"] || null;
      // Note: we do NOT return when namespaces are missing. Freshly-created
      // tree roots have no code-workspace metadata until the first file
      // write auto-initializes them, but the AI's turn-1 system prompt
      // still needs localView + nodePlan injection so the
      // compoundBranches and nodePlan facets fire.

      // Active cascade watcher registration. When the AI's session
      // enriches context for a project or branch node, we treat that
      // as "session is working here" and register it as a watcher
      // so cross-session signals can find it.
      const role = swData?.role;
      if (sessionId && !dumpMode && (role === "project" || role === "branch")) {
        try {
          const projectId = role === "project"
            ? String(nodeId)
            : (swData?.parentProjectId || null);
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
          (async () => {
            const N = (await import("../../seed/models/node.js")).default;
            return N.findById(nodeId).select("name").lean();
          })(),
        ]);
        // Resolve the plan-type node so the rendered header names the
        // SCOPE the plan governs (e.g. "Plan governing dd") rather
        // than the worker's own name (which previously read as "Plan
        // for ui" while the steps were actually the project's plan).
        let planScopeName = nodeDoc?.name || null;
        try {
          const { getExtension } = await import("../loader.js");
          const planExt = getExtension("plan")?.exports;
          if (planExt?.findGoverningPlan) {
            const planNode = await planExt.findGoverningPlan(nodeId);
            if (planNode?.parent) {
              const N = (await import("../../seed/models/node.js")).default;
              const parentDoc = await N.findById(planNode.parent).select("name").lean();
              if (parentDoc?.name) planScopeName = parentDoc.name;
            }
          }
        } catch {}
        // The worker's own branchName so formatNodePlan can mark its
        // step with "← YOU".
        const currentBranchName = swData?.branchName || nodeDoc?.name || null;
        context.nodePlan = formatNodePlan({
          steps: localSteps || [],
          rollup,
          planScopeName,
          currentNodeId: nodeId,
          currentBranchName,
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
      // rejected at submit time.
      try {
        const sw = await swarm();
        const projectNode = role === "project"
          ? { _id: nodeId, name: cwData?.name || null }
          : (sw?.findProjectForNode ? await sw.findProjectForNode(nodeId) : null);
        if (projectNode?._id) {
          const blocker = await findBlockingSyntaxError({
            projectNodeId: projectNode._id,
            targetFilePath: null,
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

      // Declared contracts — SCOPED to this branch.
      //
      // Contracts live on plan-type nodes (each plan declares a
      // slice of shared vocabulary at its scope). For a branch
      // session, walk up the plan chain via swarm.readScopedContracts
      // which: (1) collects all contracts at every plan above this
      // node, (2) filters to the slice scoped to THIS branch
      // (global + shared:[me] + local:me). Each branch therefore
      // sees only the vocabulary it must comply with, not the whole
      // project's contract surface.
      //
      // Branch name comes from the swarm metadata's branchName
      // (preferred — set at dispatch time and stable) or falls back
      // to the node's own name.
      try {
        const sw = await swarm();
        if (sw?.readScopedContracts) {
          // Resolve THIS node's branch name. Look at swarm metadata
          // on the node first; fall back to walk-up via
          // findBranchContext to handle file-node descendants whose
          // own metadata isn't a branch.
          let branchName = swData?.branchName || null;
          if (!branchName && sw.findBranchContext) {
            try {
              const ctx = await sw.findBranchContext(nodeId);
              const bMeta = ctx?.branchNode
                ? (ctx.branchNode.metadata instanceof Map
                  ? ctx.branchNode.metadata.get("swarm")
                  : ctx.branchNode.metadata?.swarm)
                : null;
              branchName = bMeta?.branchName || ctx?.branchNode?.name || null;
            } catch {}
          }
          const contracts = await sw.readScopedContracts({
            nodeId,
            branchName,
          });
          if (Array.isArray(contracts) && contracts.length > 0) {
            context.declaredContracts = contracts;
            // Stash branch identity so the consumption-tracking
            // layer (childSummary) can record which contracts the
            // branch was scoped to see vs. which it actually used.
            context.declaredContractsBranchName = branchName || null;
          }
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

      if (role === "project" || role === "branch") {
        const levelName = role === "project" ? (cwData?.name || swData?.name || null) : null;
        if (role === "project") {
          context.workspace = {
            name: cwData?.name || null,
            workspacePath: cwData?.workspacePath || null,
            initialized: !!cwData?.initialized,
            task: swData?.systemSpec || null,
          };
        }

        if (role === "branch") {
          context.swarmBranch = {
            systemSpec: swData?.systemSpec || swData?.spec || null,
            path: swData?.path || null,
            files: swData?.files || [],
            status: swData?.status || "pending",
            parentBranch: swData?.parentBranch || null,
          };
        }

        // Aggregated detail — what's rolled up under this level. Read
        // from swarm's aggregatedDetail at the current node.
        const aggFormatted = formatAggregatedDetail(
          swData?.aggregatedDetail,
          levelName,
        );
        if (aggFormatted) context.swarmAggregated = aggFormatted;

        // Cascaded context — lateral signals this level received from
        // siblings. Active cascade: partition by session watermark so
        // signals that arrived AFTER the session's last render show up
        // as a prominent "🔔 NEW SIGNALS" banner.
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
        const inbox = Array.isArray(swData?.inbox) ? swData.inbox : [];
        const { fresh, seen } = partitionCascaded(inbox, sessionWatermark);
        const freshBanner = formatFreshBanner(fresh);
        if (freshBanner) context.swarmFreshSignals = freshBanner;
        const signalsFormatted = formatSignalInbox(seen);
        if (signalsFormatted) context.swarmLateralSignals = signalsFormatted;

        // Advance the watermark after rendering — but only outside dump mode.
        if (sessionId && !dumpMode && inbox.length > 0) {
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

        // Declared contracts — shared truth between branches. Rendered at
        // branch level so the model has no excuse to invent field names.
        if (role === "branch") {
          try {
            const sw = await swarm();
            const projectId = swData?.parentProjectId;
            if (projectId && sw?.readContracts) {
              const contracts = await sw.readContracts(projectId);
              const formatted = formatContracts(contracts);
              if (formatted) context.swarmContracts = formatted;
            }
          } catch (err) {
            log.debug("CodeWorkspace", `contract enrichContext skipped: ${err.message}`);
          }

          // Sibling branches — read-only visibility into what the other
          // parallel branches have actually written. Stops the class of
          // bugs where each branch invents interfaces its siblings don't
          // implement.
          try {
            const sw = await swarm();
            if (sw?.readSiblingBranches) {
              const siblings = await sw.readSiblingBranches(nodeId, {
                includeNotes: true,
                maxNoteLength: 1200,
                maxDescendants: 40,
              });
              if (Array.isArray(siblings) && siblings.length > 0) {
                context.siblingBranches = siblings;
              }
            }
          } catch (err) {
            log.debug("CodeWorkspace", `sibling enrichContext skipped: ${err.message}`);
          }
        }

        // Plan — the decomposition beneath this level. Read branch kind
        // steps from the unified plan namespace.
        const planMeta = meta?.plan;
        const planBranches = (planMeta?.steps || []).filter((s) => s.kind === "branch");
        if (planBranches.length > 0) {
          const lines = ["Direct sub-branches under this level:"];
          for (const b of planBranches.slice(0, 20)) {
            const icon =
              b.status === "done" ? "✓" :
              b.status === "failed" ? "✗" :
              b.status === "running" ? "▶" : "·";
            lines.push(`  ${icon} ${b.title}${b.summary ? " — " + String(b.summary).slice(0, 120) : ""}`);
          }
          context.planSummary = lines.join("\n");
        }
      } else if (cwData?.role === "file") {
        context.code = {
          role: "file",
          filePath: cwData.filePath || null,
          language: cwData.language || null,
        };
      } else if (cwData?.role === "directory") {
        context.code = {
          role: "directory",
          filePath: cwData.filePath || null,
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
    async ({ note, nodeId, contentType, action, chatId }) => {
      if (contentType !== "text") return;
      if (!nodeId) return;
      try {
        const sw = await swarm();
        if (!sw?.findBranchContext) return;
        const found = await sw.findBranchContext(nodeId);
        if (!found) return;
        const { branchNode, projectNode } = found;
        // Pulled from afterNote hookData; threaded into appendSignal below
        // so AI forensics can attribute the signal emission to the
        // capture that caused this note write. Silently null for
        // background note writes (no chat context), in which case the
        // forensics layer no-ops.
        const emitterChatId = chatId || null;

        const { default: NodeModel } = await import("../../seed/models/node.js");
        const fileNode = await NodeModel.findById(nodeId).select("name metadata").lean();
        const fileMeta = fileNode?.metadata instanceof Map
          ? fileNode.metadata.get("code-workspace")
          : fileNode?.metadata?.["code-workspace"];
        const filePath = fileMeta?.filePath || fileNode?.name || String(nodeId);

        // Flat event log on the project root for the dashboard / history.
        const summary = summarizeWrite(note?.content || "");
        await sw.recordEvent({
          projectNodeId: projectNode._id,
          event: {
            branchName: branchNode?.name || null,
            branchId: branchNode?._id ? String(branchNode._id) : null,
            filePath,
            kind: action === "edit" ? "edit" : "wrote",
            summary,
          },
          core,
          summaryTier,
        });

        // Roll the delta up the ancestor chain. Every branch and the
        // project root gets its aggregatedDetail merged.
        const classification = classifyWrite({
          filePath,
          content: note?.content || "",
        });
        await sw.rollUpDetail({
          fromNodeId: nodeId,
          delta: {
            filesWrittenDelta: 1,
            newContracts: classification.signals,
            lastActivity: new Date().toISOString(),
          },
          core,
        });

        // Path-"." attribution. When a file lands at the project root
        // (no branch ancestor in the structural walk), the rollUpDetail
        // call above bypasses every branch — but a path-"." integration
        // branch (e.g. "shell") legitimately OWNS root-level files
        // under the recursive plan model. Without explicit attribution,
        // the shell branch's aggregatedDetail.filesWritten stays 0
        // forever and its rollup says "0 work units" even though it
        // produced index.html / main.js / etc.
        //
        // If branchNode is null AND the file's parent is the project
        // root, look up the governing plan for a path-"." branch whose
        // declared files include this filename. If found, bump that
        // branch's aggregatedDetail directly. Same delta, just attributed
        // to the right node.
        if (!branchNode && fileNode && projectNode) {
          try {
            const fileParent = await NodeModel.findById(nodeId).select("parent").lean();
            if (String(fileParent?.parent) === String(projectNode._id)) {
              const planExt = (await import("../loader.js")).getExtension("plan")?.exports;
              if (planExt?.readPlan) {
                const projectPlan = await planExt.readPlan(projectNode._id);
                const baseName = (filePath.split("/").filter(Boolean).pop() || filePath);
                const owner = (projectPlan?.steps || []).find((s) =>
                  s.kind === "branch"
                  && s.path === "."
                  && Array.isArray(s.files)
                  && s.files.some((f) => f === baseName || f === filePath)
                  && s.childNodeId,
                );
                if (owner?.childNodeId) {
                  await sw.rollUpDetail({
                    fromNodeId: owner.childNodeId,
                    delta: {
                      filesWrittenDelta: 1,
                      lastActivity: new Date().toISOString(),
                    },
                    core,
                    stopAtProject: false,
                  });
                  log.debug(
                    "CodeWorkspace",
                    `path-"." attribution: ${filePath} → ${owner.title} (${String(owner.childNodeId).slice(0, 8)})`,
                  );
                }
              }
            }
          } catch (attrErr) {
            log.debug("CodeWorkspace", `path-"." attribution skipped: ${attrErr.message}`);
          }
        }

        // Lateral propagation: if the write is contract-affecting and the
        // file sits inside a branch, fan the signals to that branch's
        // siblings so their next session sees them in their inbox.
        let siblingCountForCascade = 0;
        if (classification.isContract && branchNode && classification.signals.length > 0) {
          const siblings = await sw.findBranchSiblings(branchNode._id);
          siblingCountForCascade = siblings.length;
          if (siblings.length > 0) {
            for (const sib of siblings) {
              await sw.appendSignal({
                nodeId: sib._id,
                signal: {
                  from: branchNode.name,
                  kind: SIGNAL_KIND.CONTRACT,
                  filePath,
                  payload: classification.signals.slice(0, 8).join(" · "),
                },
                core,
                emitterChatId,
              });
              await markPlanDrift({
                nodeId: sib._id,
                reason: `${branchNode.name} updated ${filePath}`,
                core,
              });
              await notifySignal(sib._id, { reason: "contract cascade" });
            }
            log.info(
              "CodeWorkspace",
              `📡 Swarm cascade: ${branchNode.name} → ${siblings.length} sibling(s) (${classification.signals.length} contract signals from ${filePath})`,
            );
          }
        }

        // Fire a kernel-level cascade record so the Flow dashboard shows
        // code-workspace activity alongside every other extension's events.
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

        // Syntax validation. Runs for ANY file write inside a project.
        // Signal attaches to the branch when one exists (retry loop picks
        // it up); otherwise attaches to the project root. On success,
        // prunes any prior syntax-error signals for this file.
        const signalTargetId = branchNode?._id || projectNode?._id;
        if (signalTargetId && note?.content != null) {
          try {
            const validation = validateSyntax({
              filePath,
              content: note.content,
            });
            if (validation._skipped) {
              log.warn(
                "CodeWorkspace",
                `⚠️  Syntax validator fell open on ${filePath}: ${validation._reason || "(unknown)"}`,
              );
            }
            if (!validation.ok && validation.error) {
              await sw.appendSignal({
                nodeId: signalTargetId,
                signal: {
                  from: branchNode?.name || projectNode?.name || "project",
                  kind: SIGNAL_KIND.SYNTAX_ERROR,
                  filePath,
                  payload: validation.error,
                },
                core,
                emitterChatId,
              });
              await notifySignal(signalTargetId, { reason: "syntax error" });
              log.warn(
                "CodeWorkspace",
                `🔴 Syntax error in ${filePath} (line ${validation.error.line}): ${validation.error.message}`,
              );
            } else if (validation.ok && !validation._skipped) {
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

        // Dead-receiver detection (phase 4a). Only fires when the file
        // PARSES — running on broken syntax would just produce noise.
        if (signalTargetId && note?.content && /\.[cm]?js$/.test(filePath)) {
          try {
            const drResult = detectDeadReceivers({
              filePath,
              content: note.content,
            });
            if (drResult.issues.length > 0) {
              for (const issue of drResult.issues) {
                await sw.appendSignal({
                  nodeId: signalTargetId,
                  signal: {
                    from: branchNode?.name || projectNode?.name || "project",
                    kind: SIGNAL_KIND.DEAD_RECEIVER,
                    filePath,
                    payload: issue,
                  },
                  core,
                  emitterChatId,
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

        // Phase 2 contract extraction + diff. Backend writes declare
        // contracts on the project root; frontend writes diff their fetch
        // expectations against declared contracts and emit mismatches.
        if (projectNode && note?.content) {
          try {
            const fileContent = note.content;

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
              if (branchNode) {
                const siblings = await sw.findBranchSiblings(branchNode._id);
                for (const sib of siblings) {
                  await sw.appendSignal({
                    nodeId: sib._id,
                    signal: {
                      from: branchNode.name,
                      kind: SIGNAL_KIND.CONTRACT,
                      filePath,
                      payload: `${backendResult.contracts.length} contract(s) declared on ${filePath}`,
                    },
                    core,
                    emitterChatId,
                  });
                  await notifySignal(sib._id, { reason: "backend contracts" });
                }
              }
            }

            const frontendResult = extractFrontendExpectations({
              filePath,
              content: fileContent,
            });
            if (frontendResult.expectations.length > 0 && branchNode) {
              const existingContracts = await sw.readContracts(projectNode._id);
              if (Array.isArray(existingContracts) && existingContracts.length > 0) {
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
                    await sw.appendSignal({
                      nodeId: branchNode._id,
                      signal: {
                        from: branchNode.name,
                        kind: SIGNAL_KIND.CONTRACT_MISMATCH,
                        filePath,
                        payload: flatPayload,
                      },
                      core,
                      emitterChatId,
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

        // Material-change summary refresh. Any file write in a
        // branch's subtree updates the parent's view of the child.
        // Summaries feed Pass 2 courts + Pass 3 reputation; stale
        // summaries silently corrupt downstream decisions.
        if (branchNode?._id) {
          try {
            await refreshChildSummary({
              branchNode,
              reason: "afterNote",
              core,
            });
          } catch (refreshErr) {
            log.debug("CodeWorkspace", `Child summary refresh skipped: ${refreshErr.message}`);
          }
        }
      } catch (err) {
        log.debug("CodeWorkspace", `afterNote swarm record failed: ${err.message}`);
      }
    },
    "code-workspace",
  );

  // Material-change: signal arrivals and contract updates on a branch
  // node also mutate the child's summary. Hook into afterMetadataWrite
  // and refresh when the write hits a branch-role node's swarm
  // namespace. The summary itself is also a write to metadata.swarm
  // — guard against infinite recursion by checking the data shape:
  // if the only change is the `summary` field we just wrote, skip.
  //
  // TEMPORARILY DISABLED while diagnosing an OOM that fires on LLM
  // message routing. This hook fires on every swarm-namespace metadata
  // write and triggers refreshChildSummary which walks the branch
  // subtree reading every file's full content. Under bursts (a swarm
  // pass writing status updates across many branches in quick succession)
  // it can spike memory enough to OOM a 4GB heap. Other refresh triggers
  // (afterNote, swarm:afterBranchComplete) still fire, so summaries
  // stay reasonably fresh; this hook only added the metadata-write
  // trigger. Re-enable after addressing the burst-walk pattern (e.g.,
  // narrowing the trigger to specific field changes, replacing the
  // subtree walk with an incremental update).
  // core.hooks.register(
  //   "afterMetadataWrite",
  //   async ({ nodeId, extName, data }) => {
  //     if (extName !== "swarm") return;
  //     if (!nodeId || !data) return;
  //     if (data._summaryRefresh) return;
  //     try {
  //       const { default: NodeModel } = await import("../../seed/models/node.js");
  //       const branchNode = await NodeModel.findById(nodeId).select("_id name metadata").lean();
  //       if (!branchNode) return;
  //       const meta = branchNode.metadata instanceof Map
  //         ? branchNode.metadata.get("swarm")
  //         : branchNode.metadata?.swarm;
  //       if (meta?.role !== "branch") return;
  //       await refreshChildSummary({
  //         branchNode,
  //         reason: "swarm-metadata-change",
  //         core,
  //       });
  //     } catch (refreshErr) {
  //       log.debug("CodeWorkspace", `afterMetadataWrite summary refresh skipped: ${refreshErr.message}`);
  //     }
  //   },
  //   "code-workspace",
  // );

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

  // ── Swarm hook handlers ──────────────────────────────────────────
  //
  // When swarm spins up a project or finishes branch work, code-workspace
  // runs its own domain-specific concerns: filesystem workspace init,
  // per-branch smoke, cross-branch integration/conformance/ws-seam checks,
  // behavioral tests, and the plan.md projection. All of it reacts to
  // swarm's mechanism via these three hooks.

  // swarm:afterProjectInit — code-workspace claims this project and
  // creates the filesystem workspace directory. Swarm stamps role=project
  // in its own namespace before firing; we layer our workspace data on top.
  core.hooks.register(
    "swarm:afterProjectInit",
    async ({ projectNode, owner }) => {
      if (!projectNode?._id) return;
      try {
        await initProject({
          projectNodeId: projectNode._id,
          name: projectNode.name || null,
          userId: owner?.userId || null,
          core,
        });
      } catch (err) {
        log.warn("CodeWorkspace", `swarm:afterProjectInit initProject failed: ${err.message}`);
      }
    },
    "code-workspace",
  );

  // swarm:afterBranchComplete — after each branch lands cleanly, run the
  // runtime smoke test on its path. Failure flips the result to failed
  // so swarm re-runs retry with the fresh RUNTIME_ERROR signals in the
  // branch's inbox.
  //
  // Also writes a surface summary ("WS handles: join/flap/gameState; HTTP:
  // GET /health") onto the branch's subPlan entry. Siblings see this in
  // their enrichContext instead of the raw "[[DONE]]" the architect emits.
  core.hooks.register(
    "swarm:afterBranchComplete",
    async ({ branchNode, rootProjectNode, workspaceAnchorNode, branch, result }) => {
      if (!rootProjectNode?._id || !branch?.path) return;
      if (result?.status !== "done") return;

      // GATE 1: syntax-blocks-done. Any lingering SYNTAX_ERROR signal on
      // this branch's inbox means a file in the branch still won't parse.
      // The afterNote validator prunes the signal when the file later
      // writes cleanly, so a live signal here = live broken file. Flip to
      // failed before smoke runs (smoke on unparseable code is noise).
      if (branchNode?._id) {
        try {
          const sw = await swarm();
          if (sw?.readSignals) {
            const signals = await sw.readSignals(branchNode._id);
            const syntaxErrors = (signals || []).filter((s) => s?.kind === SIGNAL_KIND.SYNTAX_ERROR);
            if (syntaxErrors.length > 0) {
              const first = syntaxErrors[0];
              const file = first.filePath || first.payload?.file || "(unknown)";
              const line = first.payload?.line || "?";
              const msg = (first.payload?.message || "syntax error").slice(0, 120);
              result.status = "failed";
              result.error = `syntax: ${file}:${line} ${msg}`;
              log.warn(
                "CodeWorkspace",
                `🔴 Branch "${branch.name}" blocked on syntax: ${syntaxErrors.length} unparseable file(s); first=${file}:${line}`,
              );
              return;
            }
          }
        } catch (err) {
          log.debug("CodeWorkspace", `syntax gate check skipped: ${err.message}`);
        }
      }

      // Child summary refresh on branch completion. This is the
      // completion-event trigger; the other two triggers (file writes
      // and metadata changes) are wired via the afterNote and
      // afterMetadataWrite hooks above. Summary persists on the
      // branch node's swarm metadata for Pass 2 courts and Pass 3
      // reputation to read.
      try {
        await refreshChildSummary({
          branchNode,
          planStep: { status: "done" },
          reason: "afterBranchComplete",
          core,
        });
      } catch (sumErr) {
        log.debug("CodeWorkspace", `branch summary skipped: ${sumErr.message}`);
      }

      try {
        // Workspace resolution: if the dispatcher explicitly passed
        // a workspaceAnchorNode, use it. Otherwise walk up from the
        // plan anchor to find the nearest ancestor that owns a
        // workspace. The two are separate concerns — the plan anchor
        // is where plan/signal state lives; the workspace anchor is
        // where files physically live on disk. They converge at
        // top-level dispatch but diverge for sub-plans and (Pass 4+)
        // cross-cutting plans.
        const anchorId = workspaceAnchorNode?._id || rootProjectNode._id;
        const workspaceRoot = await resolveWorkspaceRoot(anchorId);
        if (!workspaceRoot) return;
        const smoke = await smokeBranch({
          workspaceRoot,
          branchPath: branch.path,
          branchName: result?.name || branch.name,
        });
        if (smoke.skipped) {
          log.debug("CodeWorkspace", `Smoke skipped for ${branch.name}: ${smoke.reason}`);
          return;
        }
        if (smoke.ok) return;
        log.warn("CodeWorkspace",
          `💥 Branch "${branch.name}" passed syntax but failed smoke: ${smoke.errors[0]?.message || "(unknown)"}`,
        );
        const sw = await swarm();
        if (sw?.appendSignal && branchNode?._id) {
          for (const err of smoke.errors) {
            await sw.appendSignal({
              nodeId: branchNode._id,
              signal: {
                from: branch.name,
                kind: SIGNAL_KIND.RUNTIME_ERROR,
                filePath: err.file,
                payload: err,
              },
              core,
            });
          }
        }
        const errSummary = smoke.errors
          .slice(0, 3)
          .map((e) => `${e.file}:${e.line} ${e.message}`)
          .join("; ");
        result.status = "failed";
        result.error = `smoke: ${errSummary}`;
      } catch (err) {
        log.warn("CodeWorkspace", `swarm:afterBranchComplete smoke crashed: ${err.message}`);
      }
    },
    "code-workspace",
  );

  // swarm:afterAllBranchesComplete — cross-branch validations run once
  // after all branch sessions terminate. Integration smoke probes the
  // HTTP seams, contract conformance flags branches that violate declared
  // contracts, WS seam statically checks the websocket protocol, and
  // behavioral tests exercise tests/spec.test.js. Flipping a result's
  // status to "failed" triggers swarm's retry pass.
  core.hooks.register(
    "swarm:afterAllBranchesComplete",
    async ({ rootProjectNode, workspaceAnchorNode, results, branches, signal }) => {
      if (!rootProjectNode?._id) return;
      if (signal?.aborted) return;

      const sw = await swarm();
      // Two separate anchor concepts:
      //   rootProjectNode    — PLAN anchor (where metadata.plan,
      //                        signal inbox, contracts live).
      //   workspaceAnchorNode — WORKSPACE anchor (where files live
      //                        on disk). Falls back to walk-up from
      //                        rootProjectNode when not provided.
      // `projectDoc` is what behavioral-test + plan.md writer need —
      // the workspace-owning project node, which may be the plan
      // anchor (top-level runs) or an outer ancestor (sub-plan runs).
      const NodeModel = (await import("../../seed/models/node.js")).default;
      const anchorId = workspaceAnchorNode?._id || rootProjectNode._id;
      const projectDoc = workspaceAnchorNode
        || (sw?.findProjectForNode
          ? (await sw.findProjectForNode(anchorId))
            || (await NodeModel.findById(anchorId))
          : await NodeModel.findById(anchorId));
      if (!projectDoc) return;
      const workspaceRoot = await resolveWorkspaceRoot(anchorId);
      if (!workspaceRoot) return;

      const branchNodeByName = new Map();
      try {
        const planExt = (await import("../loader.js")).getExtension("plan")?.exports;
        if (planExt?.readPlan) {
          const rootPlan = await planExt.readPlan(rootProjectNode._id);
          for (const s of rootPlan?.steps || []) {
            if (s.kind === "branch" && s.title && s.childNodeId) {
              branchNodeByName.set(s.title, s.childNodeId);
            }
          }
        }
      } catch {}

      const allDone = results.every((r) => r.status === "done");

      // Integration smoke — HTTP seam verification
      if (allDone && results.length >= 2) {
        try {
          const integration = await smokeIntegration({
            workspaceRoot,
            branches: results.map((r) => {
              const original = branches.find((b) => b.name === r.rawName);
              return { name: r.name, path: original?.path || null, status: r.status };
            }),
          });
          if (integration.skipped) {
            log.info("CodeWorkspace", `Integration smoke skipped: ${integration.reason}`);
          } else if (!integration.ok) {
            log.warn("CodeWorkspace",
              `🔗 Integration smoke found ${integration.mismatches.length} mismatch(es) — surfacing to operator`);
            if (sw?.appendSignal) {
              for (const mm of integration.mismatches) {
                await sw.appendSignal({
                  nodeId: rootProjectNode._id,
                  signal: {
                    from: mm.from || "integration",
                    kind: SIGNAL_KIND.CONTRACT_MISMATCH,
                    filePath: null,
                    payload: mm,
                  },
                  core,
                });
              }
            }
          } else {
            log.info("CodeWorkspace",
              `✅ Integration smoke passed: ${integration.probed || 0} endpoint(s) verified`);
          }
        } catch (err) {
          log.warn("CodeWorkspace", `Integration smoke crashed (non-blocking): ${err.message}`);
        }
      }

      // Contract conformance — branches must match declared contracts
      if (allDone && results.length >= 2) {
        try {
          const declared = sw?.readContracts ? await sw.readContracts(rootProjectNode._id) : null;
          if (declared && declared.length > 0) {
            const conform = await checkContractConformance({
              workspaceRoot,
              branches: results.map((r) => {
                const original = branches.find((b) => b.name === r.rawName);
                return { name: r.name, path: original?.path || null, status: r.status };
              }),
              contracts: declared,
            });
            if (conform.skipped) {
              log.info("CodeWorkspace", `Contract conformance skipped: ${conform.reason}`);
            } else if (!conform.ok) {
              log.warn("CodeWorkspace",
                `📜 Contract conformance: ${conform.violations.length} violation(s) — flipping branches for retry`);
              const failedNames = new Set();
              for (const v of conform.violations) {
                const target = branchNodeByName.get(v.branch);
                const targets = new Set([target, String(rootProjectNode._id)].filter(Boolean));
                if (sw?.appendSignal) {
                  for (const nodeId of targets) {
                    await sw.appendSignal({
                      nodeId,
                      signal: {
                        from: "contract-conformance",
                        kind: SIGNAL_KIND.CONTRACT_MISMATCH,
                        filePath: v.file || null,
                        payload: {
                          kind: v.kind,
                          branch: v.branch,
                          type: v.type,
                          field: v.field || null,
                          declaredTypes: v.declaredTypes ? v.declaredTypes.join(",") : null,
                          declaredFields: v.declaredFields ? v.declaredFields.join(",") : null,
                          message: v.message,
                        },
                      },
                      core,
                    });
                  }
                }
                failedNames.add(v.branch);
              }
              for (const name of failedNames) {
                const r = results.find((x) => x.rawName === name);
                if (r) {
                  r.status = "failed";
                  r.error = "Contract violation (see signalInbox)";
                }
              }
            } else {
              log.info("CodeWorkspace",
                `✅ Contract conformance passed: all ${declared.length} declared contract(s) satisfied across branches`);
            }
          }
        } catch (err) {
          log.warn("CodeWorkspace", `Contract conformance crashed (non-blocking): ${err.message}`);
        }
      }

      // WS seam — static analysis of the WebSocket protocol between
      // server and client branches
      if (allDone && results.length >= 2) {
        try {
          const wsSeam = await smokeWsSeam({
            workspaceRoot,
            branches: results.map((r) => {
              const original = branches.find((b) => b.name === r.rawName);
              return { name: r.name, path: original?.path || null, status: r.status };
            }),
          });
          if (wsSeam.skipped) {
            log.info("CodeWorkspace", `WS seam check skipped: ${wsSeam.reason}`);
          } else if (!wsSeam.ok) {
            log.warn("CodeWorkspace",
              `🔗 WS seam: ${wsSeam.mismatches.length} mismatch(es) — propagating signals to involved branches`);
            for (const mm of wsSeam.mismatches) {
              const producerId = branchNodeByName.get(mm.fromBranch);
              const consumerId = branchNodeByName.get(mm.toBranch);
              const targets = new Set([producerId, consumerId].filter(Boolean));
              targets.add(String(rootProjectNode._id));
              if (sw?.appendSignal) {
                for (const targetNodeId of targets) {
                  await sw.appendSignal({
                    nodeId: targetNodeId,
                    signal: {
                      from: "ws-seam",
                      kind: SIGNAL_KIND.CONTRACT_MISMATCH,
                      filePath: mm.evidence?.clientFile || mm.evidence?.serverFile || null,
                      payload: {
                        kind: mm.kind,
                        direction: mm.direction,
                        type: mm.type,
                        field: mm.field || null,
                        fromBranch: mm.fromBranch,
                        toBranch: mm.toBranch,
                        message: mm.message,
                      },
                    },
                    core,
                  });
                }
              }
            }
            const failedNames = new Set();
            for (const mm of wsSeam.mismatches) {
              failedNames.add(mm.fromBranch);
              failedNames.add(mm.toBranch);
            }
            for (const name of failedNames) {
              const r = results.find((x) => x.rawName === name);
              if (r) {
                r.status = "failed";
                r.error = "WS seam mismatch (see signalInbox)";
              }
            }
          } else {
            log.info("CodeWorkspace",
              `✅ WS seam passed: ${wsSeam.stats?.clientSends || 0} client sends, ` +
              `${wsSeam.stats?.serverBroadcasts || 0} server broadcasts, ` +
              `${wsSeam.stats?.fieldReads || 0} field reads all matched`);
          }
        } catch (err) {
          log.warn("CodeWorkspace", `WS seam check crashed (non-blocking): ${err.message}`);
        }
      }

      // GATE 3: load-graph — orphan-module detection. If a branch wrote a
      // .js file and NO index.html references it, the module is unreachable
      // at runtime. Blame lands on the SHELL branch (the consumer that
      // forgot to include it) because flipping the orphan branch would
      // just re-emit the same file — the fix belongs on whoever holds the
      // entry point. We signal the shell, flip it to failed, and the
      // retry re-runs shell with a signal listing the missing includes.
      if (results.length >= 2) {
        try {
          const lg = await checkLoadGraph({
            workspaceRoot,
            branches: branches.map((b) => ({ name: b.name, path: b.path || null })),
            results,
          });
          if (lg.skipped) {
            log.debug("CodeWorkspace", `Load-graph skipped: ${lg.reason}`);
          } else if (!lg.ok) {
            log.warn("CodeWorkspace",
              `👻 Load-graph: ${lg.orphans.length} orphan module(s) — shell missing <script src> for ${lg.orphans.map((o) => o.branch).join(", ")}`);

            // Identify the shell branch: the one whose path contains
            // (or IS) one of the checked entry files. Falls back to any
            // branch with path "." or the first done branch if no
            // match — better to flip something than stay silent.
            const entryDirs = new Set(
              (lg.entriesChecked || []).map((p) => {
                const dir = p.split("/").slice(0, -1).join("/");
                return dir || ".";
              }),
            );
            let shellBranchName = null;
            for (const b of branches) {
              const bp = (b.path || "").replace(/^\.\/?/, "").replace(/\/+$/, "") || ".";
              if (entryDirs.has(bp)) { shellBranchName = b.name; break; }
            }
            const shellNodeId = shellBranchName ? branchNodeByName.get(shellBranchName) : null;

            if (sw?.appendSignal) {
              for (const orphan of lg.orphans) {
                const targets = new Set(
                  [shellNodeId, String(rootProjectNode._id)].filter(Boolean),
                );
                for (const targetNodeId of targets) {
                  await sw.appendSignal({
                    nodeId: targetNodeId,
                    signal: {
                      from: "load-graph",
                      kind: SIGNAL_KIND.COHERENCE_GAP,
                      filePath: orphan.files?.[0] || null,
                      payload: {
                        kind: "orphan-module",
                        message: `No <script src> references ${orphan.branch}'s output. ` +
                          `Add a script tag for ${orphan.files?.[0] || orphan.branch} to the shell's index.html, ` +
                          `or remove the orphaned module if it's no longer needed.`,
                        branch: shellBranchName || "shell",
                        orphanBranch: orphan.branch,
                        orphanFiles: orphan.files,
                      },
                    },
                    core,
                  });
                }
              }
              await notifySignal(shellNodeId || rootProjectNode._id, { reason: "orphan module" });
            }

            if (shellBranchName) {
              const r = results.find((x) => x.rawName === shellBranchName);
              if (r && r.status === "done") {
                r.status = "failed";
                r.error = `load-graph: ${lg.orphans.length} orphan module(s) not wired into index.html`;
              }
            }
          } else {
            log.info("CodeWorkspace",
              `✅ Load-graph passed: every branch reachable from ${lg.entriesChecked?.length || 0} entry point(s)`);
          }
        } catch (err) {
          log.warn("CodeWorkspace", `Load-graph check crashed (non-blocking): ${err.message}`);
        }
      }

      // Symbol coherence scout — pure static analysis looking for
      // cross-file import/export mismatches the wire-protocol validators
      // don't catch. The PolyPong-class bug: sibling exports fetchUser,
      // another branch imports getUser. No syntax error, no test failure,
      // just an undefined reference waiting to surface at runtime.
      // Runs whenever we have at least two branches (single-branch
      // projects don't have cross-branch gaps worth hunting).
      if (results.length >= 2) {
        try {
          const scout = await checkSymbolCoherence({
            workspaceRoot,
            branches: results.map((r) => {
              const original = branches.find((b) => b.name === r.rawName);
              return { name: r.name, path: original?.path || null };
            }),
          });
          if (scout.skipped) {
            log.info("CodeWorkspace", `Symbol coherence scout skipped: ${scout.reason}`);
          } else if (!scout.ok) {
            log.warn("CodeWorkspace",
              `🔍 Symbol coherence: ${scout.gaps.length} gap(s) across ${scout.scanned} files`);
            if (sw?.appendSignal) {
              // Route each gap to the importing branch so the worker at
              // THAT branch sees the mismatch on its next turn.
              const branchNodeByName = new Map();
              for (const b of results) {
                const orig = branches.find((bb) => bb.name === b.rawName);
                if (orig?.nodeId) branchNodeByName.set(b.rawName, orig.nodeId);
              }
              const planExt = (await import("../loader.js")).getExtension("plan")?.exports;
              const planObj = planExt ? await planExt.readPlan(rootProjectNode._id) : null;
              for (const s of planObj?.steps || []) {
                if (s.kind === "branch" && s.title && s.childNodeId) {
                  branchNodeByName.set(s.title, s.childNodeId);
                }
              }
              for (const gap of scout.gaps) {
                const target = branchNodeByName.get(gap.branch) || String(rootProjectNode._id);
                await sw.appendSignal({
                  nodeId: target,
                  signal: {
                    from: "symbol-coherence",
                    kind: SIGNAL_KIND.COHERENCE_GAP,
                    filePath: gap.file,
                    payload: gap,
                  },
                  core,
                });
              }
            }
          } else {
            log.info("CodeWorkspace",
              `✅ Symbol coherence passed: ${scout.scanned} files, zero cross-file gaps`);
          }
        } catch (err) {
          log.warn("CodeWorkspace", `Symbol coherence scout crashed (non-blocking): ${err.message}`);
        }
      }

      // Behavioral test gate — run tests/spec.test.js if present
      if (allDone && results.length >= 1) {
        try {
          const testRun = await runBehavioralTests({
            workspaceRoot,
            projectNode: projectDoc,
            core,
          });
          if (testRun.skipped) {
            log.info("CodeWorkspace", `Behavioral test gate skipped: ${testRun.reason}`);
          } else if (!testRun.ok) {
            log.warn("CodeWorkspace",
              `🧪 Behavioral tests failed: ${testRun.failures.length} failure(s) — surfacing to retry loop`);
            if (sw?.appendSignal) {
              for (const failure of testRun.failures) {
                await sw.appendSignal({
                  nodeId: rootProjectNode._id,
                  signal: {
                    from: "behavioral-test",
                    kind: SIGNAL_KIND.TEST_FAILURE,
                    filePath: failure.file || "tests/spec.test.js",
                    payload: failure,
                  },
                  core,
                });
              }
            }
          } else {
            log.info("CodeWorkspace",
              `✅ Behavioral tests passed: ${testRun.ran || 0} test file(s)`);
          }
        } catch (err) {
          log.warn("CodeWorkspace", `Behavioral test runner crashed (non-blocking): ${err.message}`);
        }
      }

      // Plan.md projection at the project root. Reads the distributed
      // subPlan off metadata.swarm and renders a readable tree.
      try {
        const userRequest = (() => {
          const meta = projectDoc.metadata instanceof Map
            ? projectDoc.metadata.get("swarm")
            : projectDoc.metadata?.["swarm"];
          return meta?.systemSpec || null;
        })();
        await writeSwarmPlan({
          projectNode: projectDoc,
          userRequest,
          userId: null,
          core,
        });
      } catch (err) {
        log.warn("CodeWorkspace", `swarm plan.md write crashed: ${err.message}`);
      }
    },
    "code-workspace",
  );

  // swarm:runScouts — LLM scout phase. Fires after the static
  // validators above have had their pass. The scout reads contracts +
  // every branch's shipped files and reports SEMANTIC seam mismatches
  // that the regex-based validators don't catch (function name drift,
  // field-shape drift the model can see by reading the code). Each
  // finding lands as a signal on the offending branch's inbox and
  // flips its result to "failed" so swarm's scout loop redeploys it.
  //
  // Runs up to 3 cycles; swarm owns the adaptive cycling policy. The
  // handler itself runs ONE integration scout per cycle — batched
  // context, one LLM call, emits one SCOUT_REPORT event per finding.
  core.hooks.register(
    "swarm:runScouts",
    async (payload) => {
      const { cycle, rootProjectNode, workspaceAnchorNode, results, branches, socket, issueSummary, signal } = payload;
      if (!rootProjectNode?._id || signal?.aborted) return;

      // Prefer explicit workspaceAnchorNode when the dispatcher
      // provided it; otherwise walk up from the plan anchor. The two
      // are independent concerns — plan scope vs. filesystem location.
      const anchorId = workspaceAnchorNode?._id || rootProjectNode._id;
      const workspaceRoot = await resolveWorkspaceRoot(anchorId);
      if (!workspaceRoot) return;

      const sw = await swarm();
      const contracts = sw?.readContracts ? await sw.readContracts(rootProjectNode._id) : [];

      const branchNodeByName = new Map();
      try {
        const planExt = (await import("../loader.js")).getExtension("plan")?.exports;
        if (planExt?.readPlan) {
          const planObj = await planExt.readPlan(rootProjectNode._id);
          for (const s of planObj?.steps || []) {
            if (s.kind === "branch" && s.title && s.childNodeId) {
              branchNodeByName.set(s.title, s.childNodeId);
            }
          }
        }
      } catch {}

      try {
        const outcome = await runScout({
          cycle,
          rootProjectNode,
          results,
          branches,
          workspaceRoot,
          contracts: contracts || [],
          socket,
          core: payload.core || undefined,
          issueSummary,
          branchNodeByName,
        });
        if (outcome.skipped) {
          log.debug("CodeWorkspace", `Scout cycle ${cycle} skipped: ${outcome.reason}`);
        } else if (outcome.clean) {
          log.info("CodeWorkspace", `🔍 Scout cycle ${cycle}: clean — no seam mismatches`);
        }
      } catch (err) {
        log.warn("CodeWorkspace", `Scout cycle ${cycle} crashed: ${err.message}`);
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
        { priority: 5, requiresScaffolding: true },
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

      // Flat-build scout. Called by the orchestrator when a
      // tree:code-* chain ends without dispatching any branches —
      // i.e. a single-dir build that swarm:afterAllBranchesComplete
      // never fires for. Walks every file in the project and runs
      // validateSyntax on whatever the validator recognizes (.js,
      // .mjs, .cjs, .json, .html). Returns a compact summary the
      // summarizer can fold into its recap so the user learns about
      // broken files before they try to run the app.
      //
      // Keeps going on per-file exceptions; a single bad read never
      // silences the whole scan.
      async runFlatBuildScout({ rootId }) {
        try {
          const { findProject, walkProjectFiles } = await import("./workspace.js");
          const project = await findProject(rootId);
          if (!project) return { ok: true, filesScanned: 0, errors: [], reason: "no project" };
          const files = await walkProjectFiles(project._id);
          const errors = [];
          let scanned = 0;
          for (const f of files) {
            try {
              const res = validateSyntax({ filePath: f.filePath, content: f.content || "" });
              scanned++;
              if (!res.ok && res.error) {
                errors.push({
                  file: f.filePath,
                  line: res.error.line || null,
                  column: res.error.column || null,
                  message: res.error.message || "parse error",
                });
              }
            } catch (err) {
              // Per-file crash is non-fatal — keep scanning the rest.
              log.debug("CodeWorkspace", `flat-build-scout skip ${f.filePath}: ${err.message}`);
            }
          }
          return { ok: errors.length === 0, filesScanned: scanned, errors };
        } catch (err) {
          log.warn("CodeWorkspace", `runFlatBuildScout crashed: ${err.message}`);
          return { ok: true, filesScanned: 0, errors: [], reason: err.message };
        }
      },

      readMeta,
      // Serve subsystem exports — let other extensions (code-forge, etc.)
      // drive previews programmatically.
      startPreview,
      stopPreview,
      getServeEntryByNodeId: getEntryByNodeId,
      allServeEntries: allEntries,

      // Strategy registry. Domain packages (code-strategy-http,
      // code-strategy-websocket, ...) call registerStrategy from their own
      // init() to add a short context block that plan-mode inlines when
      // the predicate matches. Tools are declared in the strategy's own
      // manifest and injected into tree:code-plan via modeTools.
      registerStrategy,
      buildStrategyContextBlock,
      listStrategies,
      // Branch-aware single-file write. Strategy wrappers (ws-create-server,
      // http-create-server, ...) call this so they don't re-implement the
      // path-root validation or project detection the base tools already do.
      writeFileInBranch,
      // Branch-aware single-file read — companion to writeFileInBranch.
      // Strategy wrappers use this to read a file they plan to patch.
      readFileInBranch,
    },
  };
}
