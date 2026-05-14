// governing extension entry point.
//
// Registers the four coordination modes (Planner, Contractor, Worker,
// Foreman) and exposes the role lifecycle API for callers that need
// to promote a node to Ruler at any depth. Workspaces (code-workspace,
// book-workspace, etc.) consume governing for coordination and may
// specialize the Worker base mode by registering their own
// domain-specific Worker variant.
//
// The trio is now a quartet at every Ruler scope: plan-node
// (Planner's emission surface), contracts-node (Contractor's surface),
// execution-node (Foreman's surface), all under the Ruler. The
// Foreman role's reasoning surface is structurally registered in
// Pass 1; the LLM-driven retry-vs-escalate / court-convening logic
// lands in Pass 2.

import log from "../../seed/log.js";
import plannerMode from "./modes/planner.js";
import contractorMode from "./modes/contractor.js";
import workerMode from "./modes/worker.js";
import workerBuildMode from "./modes/workerBuild.js";
import workerRefineMode from "./modes/workerRefine.js";
import workerReviewMode from "./modes/workerReview.js";
import workerIntegrateMode from "./modes/workerIntegrate.js";
import foremanMode from "./modes/foreman.js";
import rulerMode from "./modes/ruler.js";
import {
  WORKER_TYPES,
  DEFAULT_WORKER_TYPE,
  WORKER_TYPE_MODE_KEYS,
  isValidWorkerType,
  coerceWorkerType,
} from "./modes/workerBase.js";
import {
  registerWorkspaceWorkerTypes,
  unregisterWorkspaceWorkerTypes,
  lookupWorkerMode,
  listWorkerTypeRegistrations,
  shouldGovernAtScope,
  findActiveWorkspaceAtScope,
} from "./state/workerTypeRegistry.js";
import {
  FLAG_KINDS,
  isValidFlagKind,
  appendFlag,
  readPendingIssues,
  markFlagResolved,
  summarizeFlags,
  formatFlagSummary,
} from "./state/flagQueue.js";
import {
  buildRulerSnapshot,
  formatRulerSnapshot,
  renderRulerSnapshot,
} from "./state/rulerSnapshot.js";
import {
  buildExecutionStackSnapshot,
  formatExecutionStack,
  renderExecutionStack,
  buildArtifactEvidence,
  formatArtifactEvidence,
  renderArtifactEvidence,
} from "./state/executionStack.js";
import { classifyWorkerOutcome } from "./state/workerOutcome.js";
import {
  setRulerDecision,
  getRulerDecision,
  clearRulerDecision,
} from "./state/rulerDecisions.js";
import {
  setForemanDecision,
  getForemanDecision,
  clearForemanDecision,
} from "./state/foremanDecisions.js";
import { promoteToRuler, readRole, isRuler, findRulerScope, walkRulers, PROMOTED_FROM, NS } from "./state/role.js";
import { buildDashboardData, isTreeGoverned } from "./state/dashboardData.js";
import { findLCA, ancestorChain, isAncestorOrSelf, validateScopeAuthority } from "./state/lca.js";
import { setContracts, readContracts, readScopedContracts, readApprovalsAtRuler, readActiveContractsEmission } from "./state/contracts.js";
import { ensureContractsNode } from "./state/contractsNode.js";
import {
  ensurePlanAtScope,
  createPlanNode,
  readPlan,
  initPlan,
  appendLedger,
  findGoverningPlan,
  findGoverningPlanChain,
  DEFAULT_BUDGET,
  NS as PLAN_NS,
} from "./state/planNode.js";
import {
  appendPlanApproval,
  readPlanApprovalsAtRuler,
  readPlanApprovalLedger,
  readActivePlanApproval,
  readActivePlanEmission,
  buildPlanRef,
  parsePlanRef,
} from "./state/planApprovals.js";
import {
  writeLineage,
  readLineage,
  inferLineageFromParent,
} from "./state/lineage.js";
import {
  ensureExecutionNode,
  findExecutionNode,
} from "./state/executionNode.js";
import {
  appendExecutionRecord,
  appendExecutionApproval,
  readExecutionApprovalsAtRuler,
  readActiveExecutionApproval,
  readActiveExecutionRecord,
  updateStepStatus,
  updateStepStatusByBranchName,
  freezeExecutionRecord,
  buildExecutionRef,
  parseExecutionRef,
} from "./state/foreman.js";
import {
  registerValidator,
  unregisterValidatorsForExt,
  runValidators,
  listValidators,
} from "./state/validators.js";

// Format ancestor-Ruler contracts as a prompt-ready block. Surfaces
// every contract reachable upward through readContracts (which walks
// ruler-role nodes); the AI sees the SHARED VOCABULARY it is bound
// to, with kind/name/scope/details/rationale per entry. Sub-Rulers
// reuse these names verbatim instead of inventing parallel terms.
function formatGoverningContracts(contracts) {
  if (!Array.isArray(contracts) || contracts.length === 0) return null;
  const lines = [
    "## CONTRACTS IN FORCE AT THIS SCOPE",
    "These are the canonical names and shapes ancestor Rulers ratified.",
    "When you write code, plans, or sub-decompositions, use these EXACT names.",
    "Do not invent parallel terms; do not rename existing ones.",
    "",
  ];
  for (const c of contracts) {
    const kind = c.kind || "contract";
    const name = c.name || "(unnamed)";
    let scopeStr = "global";
    if (c.scope === "global") scopeStr = "global";
    else if (c.scope && typeof c.scope === "object") {
      if (Array.isArray(c.scope.shared)) scopeStr = `shared:[${c.scope.shared.join(",")}]`;
      else if (c.scope.local) {
        const locals = Array.isArray(c.scope.local) ? c.scope.local : [c.scope.local];
        scopeStr = `local:${locals.join(",")}`;
      }
    }
    lines.push(`• [${kind}] ${name}  (scope: ${scopeStr})`);
    if (c.details) {
      const detail = String(c.details).split("\n").map((l) => `    ${l}`).join("\n");
      lines.push(detail);
    }
    if (c.rationale) lines.push(`    why: ${c.rationale}`);
    lines.push("");
  }
  return lines.join("\n");
}

// Format the parent Ruler's active plan emission so a sub-Ruler can
// see WHERE it sits in the upstream decomposition. Highlights the
// specific branch step this sub-Ruler is expanding (if known via
// lineage), and lists every other step in the parent plan so the
// sub-Ruler doesn't redo work owned elsewhere.
function formatParentPlanEmission(emission, lineage) {
  if (!emission?.steps) return null;
  const lines = [
    "## PARENT RULER'S APPROVED PLAN",
    "Your parent Ruler decomposed its scope into the steps below.",
    "Your sub-Ruler scope is one of these branches; build on this plan, do not duplicate sibling work.",
    "",
  ];
  if (emission.reasoning) {
    lines.push("### Parent reasoning");
    lines.push(emission.reasoning);
    lines.push("");
  }
  lines.push("### Parent steps");
  emission.steps.forEach((step, i) => {
    const idx = i + 1;
    const isYou = lineage?.parentStepIndex === idx;
    const marker = isYou ? "  ← YOU" : "";
    if (step.type === "leaf") {
      lines.push(`${idx}. [leaf] ${step.spec || ""}${marker}`);
    } else if (step.type === "branch") {
      lines.push(`${idx}. [branch] ${step.rationale || ""}${marker}`);
      const subs = Array.isArray(step.branches) ? step.branches : [];
      subs.forEach((b) => {
        const bMark = isYou && lineage?.parentBranchEntryName
          && String(b.name).toLowerCase() === String(lineage.parentBranchEntryName).toLowerCase()
          ? "  ← YOU"
          : "";
        lines.push(`     - ${b.name}: ${b.spec || ""}${bMark}`);
      });
    }
  });
  return lines.join("\n");
}

export {
  promoteToRuler,
  readRole,
  isRuler,
  PROMOTED_FROM,
  NS,
  findLCA,
  ancestorChain,
  isAncestorOrSelf,
  validateScopeAuthority,
  setContracts,
  readContracts,
  readScopedContracts,
  registerValidator,
  unregisterValidatorsForExt,
  runValidators,
  listValidators,
};

export async function init(core) {
  // Register the three coordination modes. The kernel's mode registry
  // wants direct registerMode calls with the mode OBJECT (not a path);
  // manifest.provides.modes is informational/declarative and does not
  // self-register. Pattern matches code-workspace's init().
  if (core?.modes?.registerMode) {
    core.modes.registerMode("tree:governing-ruler", rulerMode, "governing");
    core.modes.registerMode("tree:governing-planner", plannerMode, "governing");
    core.modes.registerMode("tree:governing-contractor", contractorMode, "governing");
    // Generic Worker for legacy plans without workerType.
    core.modes.registerMode("tree:governing-worker", workerMode, "governing");
    // Typed Workers — Build, Refine, Review, Integrate. The Planner
    // picks the type per leaf step; dispatch routes to the matching
    // mode key.
    core.modes.registerMode("tree:governing-worker-build", workerBuildMode, "governing");
    core.modes.registerMode("tree:governing-worker-refine", workerRefineMode, "governing");
    core.modes.registerMode("tree:governing-worker-review", workerReviewMode, "governing");
    core.modes.registerMode("tree:governing-worker-integrate", workerIntegrateMode, "governing");
    core.modes.registerMode("tree:governing-foreman", foremanMode, "governing");
    log.verbose("Governing", "Registered modes: tree:governing-{ruler, planner, contractor, worker, worker-build, worker-refine, worker-review, worker-integrate, foreman}");
  } else {
    log.warn("Governing", "core.modes.registerMode not available; modes NOT registered");
  }

  // Tools: emission tools (governing-emit-plan, governing-emit-contracts),
  // Ruler decision tools (hire-planner, route-to-foreman, respond-
  // directly, revise-plan, archive-plan, pause-execution, resume-
  // execution, read-plan-detail, convene-court), Foreman decision
  // tools (retry-branch, mark-failed, freeze-record, pause-record,
  // resume-record, escalate-to-ruler, respond-directly, read-branch-detail),
  // and Worker flag tools (governing-flag-issue,
  // governing-read-pending-issues) — Workers surface contract issues
  // during their work; Rulers read the accumulated queue.
  const { default: getGoverningTools } = await import("./tools.js");
  const { default: getRulerTools } = await import("./rulerTools.js");
  const { default: getForemanTools } = await import("./foremanTools.js");
  const { default: getFlagTools } = await import("./flagTools.js");
  const tools = [
    ...getGoverningTools(core),
    ...getRulerTools(core),
    ...getForemanTools(core),
    ...getFlagTools(core),
  ];

  // Tree quick-link slot. Adds a "Governance" link to every tree
  // root's overview page. Clicking navigates the dashboard's right
  // iframe to /api/v1/root/:rootId/governance which renders the
  // full rulership tree (plans, contracts, runs, workers, flags) on
  // one observational surface.
  try {
    const { getExtension } = await import("../loader.js");
    const treeos = getExtension("treeos-base");
    if (treeos?.exports?.registerSlot) {
      treeos.exports.registerSlot(
        "tree-quick-links",
        "governing",
        ({ rootId, queryString }) => {
          if (!rootId) return "";
          const qs = queryString || "";
          const href = `/api/v1/root/${rootId}/governance${qs ? `?${qs}&inApp=1` : "?inApp=1"}`;
          return `<a class="quick-link" href="${href}" data-ext="governing">⚖ Governance</a>`;
        },
        { priority: 35 },
      );
    }
  } catch (err) {
    log.debug("Governing", `tree-quick-links slot registration skipped: ${err.message}`);
  }

  // Plan panel slot. Registers a placeholder div on plan-type nodes
  // that fetches the rendered HTML fragment from the panel route.
  // Phase F absorbed this from the deleted plan extension.
  try {
    const { getExtension } = await import("../loader.js");
    const treeos = getExtension("treeos-base");
    if (treeos?.exports?.registerSlot) {
      treeos.exports.registerSlot(
        "node-detail-sections",
        "governing-plan",
        ({ node, nodeId, qs }) => {
          if (node?.type !== "plan") return "";
          const id = `plan-panel-${String(nodeId).slice(0, 8)}`;
          return `
            <div id="${id}" data-slot="node-detail-sections" data-ext="governing">
              <div style="padding:12px;color:rgba(255,255,255,0.4);font-size:11px;">Loading plan…</div>
            </div>
            <script>
              (async function() {
                try {
                  var res = await fetch("/api/v1/governing/plan/${nodeId}/panel.html${qs || ""}", { credentials: "include" });
                  if (res.ok) {
                    var html = await res.text();
                    var el = document.getElementById("${id}");
                    if (el) el.outerHTML = html;
                  }
                } catch (e) {}
              })();
            </script>`;
        },
        { priority: 40 },
      );
    }
  } catch (err) {
    log.debug("Governing", `plan panel slot registration skipped: ${err.message}`);
  }

  // enrichContext: surface ancestor-Ruler contracts, parent plan
  // emission, and lineage on every conversation turn at any scope under
  // a Ruler. Without this hook a sub-Ruler's Planner / Contractor /
  // Worker has no visibility into the parent Ruler's vocabulary —
  // sub-domain decompositions diverge and contract names get
  // re-invented per branch instead of building off the parent's.
  // readContracts already walks the ancestor chain via ruler-role
  // markers; we just format and inject.
  if (core?.hooks?.register) {
    core.hooks.register(
      "enrichContext",
      async ({ context, nodeId }) => {
        if (!context || !nodeId) return;
        try {
          const all = await readContracts(nodeId);
          if (Array.isArray(all) && all.length > 0) {
            context.governingContracts = formatGoverningContracts(all);
          }
        } catch (err) {
          log.debug("Governing", `enrichContext contracts skipped: ${err.message}`);
        }
        try {
          const lineage = await readLineage(nodeId);
          if (lineage?.parentRulerId) {
            const parts = [
              "## SUB-RULER LINEAGE",
              `You are a sub-Ruler dispatched by an ancestor Ruler.`,
              lineage.parentBranchEntryName
                ? `You are expanding the branch entry "${lineage.parentBranchEntryName}"` +
                  (typeof lineage.parentStepIndex === "number"
                    ? ` (step ${lineage.parentStepIndex})`
                    : "") +
                  ` from your parent Ruler's active plan.`
                : `You inherit your scope from your parent Ruler.`,
              lineage.expandingFromSpec
                ? `Parent's spec for you: "${lineage.expandingFromSpec}"`
                : null,
              `Your decomposition must build on the parent's plan, not contradict it. ` +
              `If your parent's contracts (above) name shared vocabulary, your sub-domains must reuse those names verbatim — do not invent parallel terms.`,
            ].filter(Boolean);
            context.governingLineage = parts.join("\n");
          }
        } catch (err) {
          log.debug("Governing", `enrichContext lineage skipped: ${err.message}`);
        }
        try {
          const lineage = await readLineage(nodeId);
          if (lineage?.parentRulerId && lineage?.parentPlanEmissionId) {
            const NodeModel = (await import("../../seed/models/node.js")).default;
            const emissionNode = await NodeModel.findById(lineage.parentPlanEmissionId)
              .select("_id metadata").lean();
            const meta = emissionNode?.metadata instanceof Map
              ? emissionNode.metadata.get("governing")
              : emissionNode?.metadata?.governing;
            const emission = meta?.emission;
            if (emission) {
              context.governingParentPlan = formatParentPlanEmission(emission, lineage);
            }
          }
        } catch (err) {
          log.debug("Governing", `enrichContext parent plan skipped: ${err.message}`);
        }

        // Active-workspace surface. The Planner at this scope picks
        // leaf types / artifact shapes based on what kind of project
        // this is — code (files in a directory tree) vs book (prose
        // notes on tree nodes) vs other workspaces. Without this
        // surface the Planner has no signal which workspace is
        // active and tends to default to whichever shape its training
        // saw most (usually code). Surfacing the workspace identity
        // + its node-types + its typed Workers' tool sets lets the
        // Planner choose artifact shapes the active workspace's
        // Workers can actually produce.
        try {
          const ws = await findActiveWorkspaceAtScope(nodeId);
          if (ws) {
            const registrations = (typeof listWorkerTypeRegistrations === "function"
              ? listWorkerTypeRegistrations()
              : []) || [];
            const typedWorkers = registrations
              .filter((r) => r.workspace === ws)
              .map((r) => `${r.workerType} → ${r.modeKey}`)
              .join(", ");
            // Workspace-specific hints. These name the SHAPE the
            // workspace produces so the Planner doesn't generalize
            // wrong. Adding a new workspace adds an entry here.
            const WORKSPACE_HINTS = {
              "book-workspace":
                "Prose artifacts. Workers write text as NOTES on tree nodes (create-node-note), " +
                "not as files. The 'book' compiler walks the tree and assembles the final document. " +
                "Plan leaves should produce prose at scopes: chapters as branch steps (sub-Rulers), " +
                "sections as either branch sub-Rulers (if substantial) or leaf prose. NO 'package.json,' " +
                "NO 'index.html,' NO source files. Artifacts are NODES with NOTES (research-notes, " +
                "chapter-outline, final-prose, references). Branch names are chapter/section identifiers " +
                "(chapter-01-origins, section-introduction), NOT directory names. Use the contracted " +
                "vocabulary from parent contracts verbatim.",
              "code-workspace":
                "Code artifacts. Workers create + edit FILES via workspace-add-file / workspace-edit-file. " +
                "Plan leaves should name concrete file paths (package.json, server/index.js, etc.). " +
                "Branch steps are directories (each becomes a sub-Ruler with its own scope). " +
                "DO NOT plan prose notes here — code-workspace's Workers don't write notes.",
            };
            const hint = WORKSPACE_HINTS[ws] || `Workspace "${ws}" is active.`;
            context.governingActiveWorkspace =
              "## ACTIVE WORKSPACE AT THIS SCOPE\n\n" +
              `Workspace: **${ws}**\n` +
              (typedWorkers ? `Typed Workers available: ${typedWorkers}\n\n` : "\n") +
              hint;
          }
        } catch (err) {
          log.debug("Governing", `enrichContext active-workspace skipped: ${err.message}`);
        }
      },
    );
  }

  // Governance dashboard SSE broadcasts. Subscribe to every governing
  // lifecycle event; on each, resolve the affected node's tree root
  // and broadcast a `update` SSE frame to every dashboard subscriber
  // for that root. The dashboard's client-side bootstrap refetches
  // the page fragment in response.
  //
  // Resolve-rootId helper: walk up from a nodeId to the tree root by
  // following `.parent` chains. Returns null on degenerate trees.
  // Cached per turn would be a future optimization; for now the
  // ~5-step walk per event is cheap enough.
  async function resolveRootForNode(nodeId) {
    if (!nodeId) return null;
    try {
      const NodeModel = (await import("../../seed/models/node.js")).default;
      let cursor = String(nodeId);
      const visited = new Set();
      for (let i = 0; i < 64; i++) {
        if (visited.has(cursor)) return null;
        visited.add(cursor);
        const n = await NodeModel.findById(cursor).select("_id parent").lean();
        if (!n) return null;
        if (!n.parent) return String(n._id);
        cursor = String(n.parent);
      }
    } catch {}
    return null;
  }

  if (core?.hooks?.register) {
    const { broadcastGovernanceUpdate } = await import("./routes.js");
    const dashboardEvents = [
      "governing:rulerPromoted",
      "governing:planRatified",
      "governing:contractRatified",
      "governing:executionRatified",
      "governing:executionCompleted",
      "governing:executionFailed",
      "governing:executionCancelled",
      "governing:executionPaused",
      "governing:executionSuperseded",
      "governing:flagAppended",
      // Spawn-completion hooks. Same dashboard broadcast shape; the
      // dashboard SSE consumers re-fetch the governance fragment when
      // any of these fire.
      "governing:plannerCompleted",
      "governing:contractorCompleted",
      "governing:planRevised",
      "governing:swarmDispatched",
      "governing:foremanRouted",
      "governing:branchRetried",
    ];
    for (const eventName of dashboardEvents) {
      core.hooks.register(eventName, async (payload) => {
        try {
          // Payload field varies per hook; try the common ones.
          const candidateNodeId =
            payload?.nodeId ||
            payload?.rulerNodeId ||
            payload?.recordNodeId ||
            payload?.scopeNodeId ||
            null;
          if (!candidateNodeId) return;
          const rootId = await resolveRootForNode(candidateNodeId);
          if (!rootId) return;
          const delivered = broadcastGovernanceUpdate(rootId, eventName);
          if (delivered > 0) {
            log.debug("Governing/Dashboard",
              `📡 broadcast ${eventName} → ${delivered} subscriber(s) at root ${rootId.slice(0, 8)}`);
          }
        } catch (err) {
          log.debug("Governing/Dashboard", `${eventName} broadcast skipped: ${err.message}`);
        }
      });
    }
    log.verbose("Governing", `Dashboard SSE: subscribed to ${dashboardEvents.length} lifecycle events`);

    // ─────────────────────────────────────────────────────────────────
    // Spawn-completion Ruler wakeups.
    //
    // Each of the six fire-and-forget tools fires a corresponding
    // completion hook when its background chainstep settles. The
    // subscriber below wakes the Ruler at the spawn's scope with a
    // synthetic empty user message and a wakeup payload carrying
    // source="hook-wakeup" + the spawn's kind/result/error.
    //
    // The Ruler's prompt reads source="hook-wakeup" and adapts its
    // synthesis behavior: continuation-of-in-progress-work, NOT
    // response-to-user-question. The lifecycle decision matrix is
    // unchanged — the Ruler reads its snapshot (which now reflects
    // the spawn's outcome) and chooses the next move.
    // ─────────────────────────────────────────────────────────────────
    const SPAWN_COMPLETION_EVENTS = {
      "governing:plannerCompleted":    "planner-completed",
      "governing:contractorCompleted": "contractor-completed",
      "governing:planRevised":         "plan-revised",
      "governing:swarmDispatched":     "swarm-dispatched",
      "governing:foremanRouted":       "foreman-routed",
      "governing:branchRetried":       "branch-retried",
    };
    // Events where a plan emission lands at the Ruler scope. At
    // entry-scope (no parent Ruler), these need a user ratification
    // gate — the plan card — and MUST NOT auto-advance. At sub-scope,
    // the parent cycle implicitly ratifies and we wake the Ruler so
    // it chains forward.
    const PLAN_EMITTING_EVENTS = new Set([
      "governing:plannerCompleted",
      "governing:planRevised",
    ]);
    for (const [eventName, wakeReason] of Object.entries(SPAWN_COMPLETION_EVENTS)) {
      core.hooks.register(eventName, async (payload) => {
        try {
          if (!payload?.rulerNodeId || !payload?.userId) return;
          // Don't synchronously block the hook fanout chain. Wake the
          // Ruler in a microtask so failures inside runRulerTurn don't
          // back-propagate into the hook caller's settle path.
          queueMicrotask(async () => {
            try {
              // Entry-scope vs sub-Ruler gate. The hire-planner /
              // revise-plan path used to call emitPlanCard inline
              // after the Planner finished; the fire-and-forget
              // refactor moved that responsibility here, where the
              // settle happens. For entry-scope plan emissions we
              // emit the card and STOP — wait for the user's "yes"
              // / "cancel" / revise instruction to advance. For sub-
              // scope, we wake the Ruler so it chains forward (the
              // parent cycle is the implicit ratification).
              if (PLAN_EMITTING_EVENTS.has(eventName) && !payload.error) {
                try {
                  const { readLineage } = await import("./state/lineage.js");
                  const lineage = await readLineage(payload.rulerNodeId);
                  const isEntryScope = !lineage?.parentRulerId;
                  if (isEntryScope) {
                    // Emit the plan card. Read the active emission
                    // and the Ruler node for the card payload.
                    const NodeModel = (await import("../../seed/models/node.js")).default;
                    const ruler = await NodeModel.findById(payload.rulerNodeId)
                      .select("_id name").lean();
                    const { readActivePlanEmission } = await import("./state/planApprovals.js");
                    const emission = await readActivePlanEmission(payload.rulerNodeId);
                    if (ruler && emission) {
                      // Build the same payload emitPlanCard built; do
                      // it inline here because we don't have visitorId
                      // through getActiveRequest (the user's request
                      // chain has already returned). Use the socket
                      // attached to the hook payload directly.
                      const branches = [];
                      for (const step of (emission.steps || [])) {
                        if (step?.type !== "branch" || !Array.isArray(step.branches)) continue;
                        for (const b of step.branches) {
                          if (!b?.name) continue;
                          branches.push({
                            name: b.name,
                            spec: b.spec || "",
                            path: null, files: [], slot: null, mode: null, parentBranch: null,
                          });
                        }
                      }
                      const { GOVERNING_WS_EVENTS } = await import("./wsEvents.js");
                      const isRevision = eventName === "governing:planRevised";
                      const cardEvent = isRevision
                        ? GOVERNING_WS_EVENTS.PLAN_UPDATED
                        : GOVERNING_WS_EVENTS.PLAN_PROPOSED;
                      const cardPayload = {
                        version: emission.ordinal || 1,
                        projectNodeId: String(ruler._id),
                        projectName: ruler.name || null,
                        branches,
                        contracts: [],
                        emission,
                        ...(isRevision ? { trigger: "revision" } : {}),
                      };
                      if (payload.socket?.emit) {
                        payload.socket.emit(cardEvent, cardPayload);
                        log.info("Governing",
                          `🎴 ${isRevision ? "PLAN_UPDATED" : "PLAN_PROPOSED"} (hook-driven) ` +
                          `emitted at entry-scope ${String(ruler._id).slice(0, 8)} ` +
                          `(emission-${emission.ordinal}, ${branches.length} branches, ${emission.steps?.length || 0} steps)`);
                      }
                      // Entry-scope ratification gate: STOP here. Do
                      // not wake the Ruler. The user reads the plan
                      // card and replies "yes" / "cancel" / revise.
                      // That user message becomes the next Ruler turn.
                      return;
                    }
                  }
                  // Sub-scope: fall through to wake the Ruler.
                } catch (gateErr) {
                  log.debug("Governing",
                    `entry-scope plan-card gate skipped for ${eventName}: ${gateErr.message}`);
                  // Fall through to wake (over-show on transient errors).
                }
              }

              const { runRulerTurn } = await import("../tree-orchestrator/ruling.js");
              await runRulerTurn({
                visitorId: payload.userId,  // visitorId reuses userId for hook-driven wakeups
                userId: payload.userId,
                username: payload.username || null,
                rootId: payload.rootId || null,
                currentNodeId: payload.rulerNodeId,
                message: "",  // synthetic empty user message
                signal: payload.signal || null,
                socket: payload.socket || null,
                sessionId: payload.parentSessionId || null,
                rootChatId: payload.parentChatId || null,
                wakeup: {
                  source: "hook-wakeup",
                  reason: wakeReason,
                  spawnId: payload.spawnId || null,
                  kind: payload.kind || null,
                  exitText: payload.exitText || null,
                  error: payload.error || null,
                  durationMs: payload.durationMs || null,
                  // Per-hook extras (e.g., dispatch's branch count,
                  // retry-branch's branchName) flow through.
                  ...payload,
                },
              });
            } catch (err) {
              log.warn("Governing",
                `Hook-wakeup Ruler turn failed for ${eventName} at ${String(payload.rulerNodeId).slice(0, 8)}: ${err.message}`);
            }
          });
        } catch (err) {
          log.debug("Governing", `${eventName} subscriber skipped: ${err.message}`);
        }
      });
    }
    log.verbose("Governing",
      `Spawn-completion subscribers: ${Object.keys(SPAWN_COMPLETION_EVENTS).length} hooks wake the Ruler on settle`);
  }

  // Mount the plan panel route + plan read endpoint at /api/v1/governing/*.
  const { default: router } = await import("./routes.js");

  // Resolve html-rendering's urlAuth so the dashboard page accepts
  // the iframe's token query param. Best-effort: if html-rendering
  // isn't installed, the route falls back to Bearer authenticate.
  try {
    const { resolveHtmlAuth } = await import("./routes.js");
    resolveHtmlAuth();
  } catch (err) {
    log.debug("Governing", `htmlAuth resolution skipped: ${err.message}`);
  }

  return {
    router,
    // Mode handlers (also exposed for cross-extension reuse, e.g.
    // workspaces extending the Worker base prompt).
    modes: [
      plannerMode,
      contractorMode,
      workerMode,
      workerBuildMode,
      workerRefineMode,
      workerReviewMode,
      workerIntegrateMode,
      foremanMode,
    ],
    tools,

    // The .exports object is what callers see at getExtension("governing")
    // .exports. Module-level named exports do NOT flow through; only the
    // returned `exports` field does. Callers (swarm.ensureBranchNode,
    // dispatch.runRulerCycle, future Pass 2 court hooks) reach for these.
    exports: {
      // Role lifecycle
      promoteToRuler, readRole, isRuler, findRulerScope, walkRulers, PROMOTED_FROM, NS,
      // Dashboard data orchestrator + tree-governance predicate.
      // The governance page calls buildDashboardData; isTreeGoverned
      // is a cheap probe other extensions can use.
      buildDashboardData, isTreeGoverned,
      // LCA / scope authority
      findLCA, ancestorChain, isAncestorOrSelf, validateScopeAuthority,
      // Contracts (trio: contracts-type node holds emissions, Ruler holds
      // approval ledger). See project_contracts_node_architecture.
      setContracts, readContracts, readScopedContracts, readApprovalsAtRuler,
      readActiveContractsEmission,
      ensureContractsNode,
      // Plan trio member primitive (Phase F absorbed from the plan
      // extension). governing now owns plan-type node creation +
      // role/mode stamping directly, parallel to contracts-type and
      // execution-type. Plan-emission ring records (immutable per
      // Planner invocation) live as children; the Ruler's planApprovals
      // ledger tracks the active emission.
      createPlanNode,
      ensurePlanAtScope,
      readPlan,
      initPlan,
      appendLedger,
      findGoverningPlan,
      findGoverningPlanChain,
      DEFAULT_BUDGET,
      PLAN_NS,
      // Plan approval ledger, parallel to contractApprovals. The Ruler
      // appends a planApproval entry when it accepts the Planner's
      // emission, before invoking the Contractor.
      appendPlanApproval,
      readPlanApprovalsAtRuler,
      readPlanApprovalLedger,
      readActivePlanApproval,
      readActivePlanEmission,
      buildPlanRef, parsePlanRef,
      // Sub-Ruler lineage. writeLineage is called at dispatch time
      // (sub-Ruler promotion); readLineage walks the upstream chain.
      // inferLineageFromParent reconstructs lineage details from the
      // parent's active plan emission when explicit dispatch params
      // weren't threaded (current branch-swarm path).
      writeLineage, readLineage, inferLineageFromParent,
      // Foreman quartet member. ensureExecutionNode materializes the
      // execution-node child of a Ruler; appendExecutionRecord creates
      // a new execution-record tied to a plan emission (with optional
      // contracts emission ref) and writes the executionApproval
      // ledger entry. updateStepStatus / freezeExecutionRecord are
      // called by swarm (Phase B+) as branches transition through
      // pending → running → done / failed. The Foreman LLM reasoning
      // surface lands in Pass 2; Pass 1 establishes the data home.
      ensureExecutionNode, findExecutionNode,
      appendExecutionRecord, appendExecutionApproval,
      readExecutionApprovalsAtRuler, readActiveExecutionApproval,
      readActiveExecutionRecord,
      updateStepStatus, updateStepStatusByBranchName,
      freezeExecutionRecord,
      buildExecutionRef, parseExecutionRef,
      // Validator registry
      registerValidator, unregisterValidatorsForExt, runValidators, listValidators,
      // Worker-type taxonomy. Planner validates against WORKER_TYPES;
      // dispatch resolves leaf-step type → mode key via
      // WORKER_TYPE_MODE_KEYS, falling back to coerceWorkerType for
      // missing or malformed entries. Workspaces may override per
      // type via manifest.provides.workerTypes; the dispatcher
      // consults workspace registrations before falling back to the
      // governing base modes here.
      WORKER_TYPES,
      DEFAULT_WORKER_TYPE,
      WORKER_TYPE_MODE_KEYS,
      isValidWorkerType,
      coerceWorkerType,
      // Workspace worker-type registry — workspaces call
      // registerWorkspaceWorkerTypes() from their init() after their
      // typed modes are registered. dispatch reads the registry via
      // lookupWorkerMode(); the listWorkerTypeRegistrations() helper
      // is for diagnostics and the dashboard.
      registerWorkspaceWorkerTypes,
      unregisterWorkspaceWorkerTypes,
      lookupWorkerMode,
      listWorkerTypeRegistrations,
      // shouldGovernAtScope tells dispatch whether to route a tree-
      // zone message through the Ruler instead of running the
      // classifier's mode pick directly. Returns true at any scope
      // where a workspace is ext-allow'd (workspaces bundle governing
      // as a dep) OR when no workspaces are installed at all
      // (governing-alone land). Replaces the legacy
      // isWorkspacePlanMode mode-key check.
      shouldGovernAtScope,
      // findActiveWorkspaceAtScope returns the workspace name
      // currently ext-allow'd at a scope (code-workspace,
      // book-workspace, etc.). Dispatch passes it to lookupWorkerMode
      // as preferWorkspace so code projects get code Workers and
      // book projects get book Workers — without it the registry's
      // insertion-order first-match picks whichever workspace loaded
      // first, regardless of where dispatch is happening.
      findActiveWorkspaceAtScope,
      // Worker flag queue. Workers call appendFlag (via the
      // governing-flag-issue tool) when they encounter a contract
      // issue; the Ruler reads via readPendingIssues. The snapshot
      // formatter uses summarizeFlags + formatFlagSummary to render
      // a bounded section in the Ruler's prompt. Pass 2 courts will
      // adjudicate via markFlagResolved.
      FLAG_KINDS,
      isValidFlagKind,
      appendFlag,
      readPendingIssues,
      markFlagResolved,
      summarizeFlags,
      formatFlagSummary,
      // Ruler-as-being primitive. The Ruler mode runs every turn at a
      // Ruler scope and decides what to do; rulerSnapshot assembles its
      // per-turn state context; rulerDecisions is the per-visitor
      // register that captures "what the Ruler chose this turn." Phase C
      // (runRulerTurn in tree-orchestrator) reads decisions to dispatch
      // the chosen role.
      buildRulerSnapshot,
      formatRulerSnapshot,
      renderRulerSnapshot,
      // Execution-stack snapshot — the Foreman's call-stack lens.
      // Distinct from the Ruler's domain snapshot. Walks down through
      // sub-Rulers (depth cap 8), walks up via lineage, surfaces
      // blockedOn rollup and non-prescriptive decision hints.
      buildExecutionStackSnapshot,
      formatExecutionStack,
      renderExecutionStack,
      // Artifact evidence — the Foreman's "what's actually on the tree"
      // probe. Lists notes on the Ruler scope + child nodes with
      // per-child note counts + pending blocking flags. The Foreman
      // wakeup payload includes this so freeze decisions are informed
      // by tree reality, not just step status.
      buildArtifactEvidence,
      formatArtifactEvidence,
      renderArtifactEvidence,
      // Worker-outcome classifier. Pure function — given a worker
      // turn's result + the Ruler's flag queue delta, returns the
      // honest leaf-step status (done/blocked/advanced/failed). The
      // dispatcher calls this on every Worker turn exit; Pass 2 court
      // adjudication calls the same function on archived turns so
      // dispatcher live + court replay agree on classification.
      classifyWorkerOutcome,
      setRulerDecision,
      getRulerDecision,
      clearRulerDecision,
      // Foreman decision register. Phase C runForemanTurn reads here
      // after the Foreman exits and applies the action (retry, mark-
      // failed, freeze, pause, resume, escalate, respond).
      setForemanDecision,
      getForemanDecision,
      clearForemanDecision,
    },
  };
}
