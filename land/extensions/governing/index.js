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
// Single-source role specs. Each role file carries BOTH dispatch
// (summon, honoredIntents, …) AND LLM behavior (buildSystemPrompt,
// toolNames, modeKey, …) — the modes/ folder is retired. See memories
// `role-subsumes-mode` and `mode-registry-legacy`. registerRole below
// mirrors the mode-shape fields into seed/modes/registry.js so legacy
// runChat({ mode: "..." }) callers continue to work during the
// migration to runChat({ role }).
import { rulerRole } from "./roles/rulerRole.js";
import { plannerRole } from "./roles/plannerRole.js";
import { contractorRole } from "./roles/contractorRole.js";
import { foremanRole } from "./roles/foremanRole.js";
import { allWorkerRoles } from "./roles/workerRoles.js";
import { registerRole } from "../../ibp/roles/registry.js";
import {
  WORKER_TYPES,
  DEFAULT_WORKER_TYPE,
  WORKER_TYPE_MODE_KEYS,
  isValidWorkerType,
  coerceWorkerType,
} from "./roles/workerBase.js";
import {
  registerWorkspaceWorkerTypes,
  unregisterWorkspaceWorkerTypes,
  lookupWorkerMode,
  listWorkerTypeRegistrations,
  shouldGovernAtScope,
  findActiveWorkspaceAtScope,
  getWorkspaceDecompositionHints,
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
// rulerDecisions / foremanDecisions per-visitor registers retired in
// Slice 7 — the legacy orchestrator's runRulerTurn / runForemanTurn
// were the only readers, and the new SUMMON-based dispatch is inline
// (tools emit SUMMONs directly). Files deleted.
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
  readLatestPlanApproval,
  readActivePlanEmission,
  readPendingPlanEmission,
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
  // Single-registration: each role spec carries dispatch + LLM
  // behavior in one frozen object. The role registry mirrors mode-
  // shape fields into seed/modes/registry.js for legacy
  // runChat({ mode }) callers; new code uses runChat({ role }) once
  // that path lands.
  registerRole("ruler",      rulerRole,      "governing");
  registerRole("planner",    plannerRole,    "governing");
  registerRole("contractor", contractorRole, "governing");
  registerRole("foreman",    foremanRole,    "governing");
  for (const { spec, role } of allWorkerRoles) {
    registerRole(spec.name, role, "governing");
  }
  log.verbose("Governing",
    "Registered roles (with mode-mirror): ruler, planner, contractor, foreman, " +
    "worker-{build,refine,review,integrate}");

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
    // One-time backfill on boot: every node that has been promoted to
    // Ruler in a prior session may be missing the explicit
    // `metadata.beings.ruler` home declaration that the descriptor
    // now reads. Promotion happens in promoteToRuler going forward, but
    // existing rulers wouldn't have it. Walk the rulers and merge the
    // home record where it's missing.
    // afterBoot kicks off the backfill as a detached job. The walk can take
    // 30-60 seconds on lands with hundreds of governing nodes; the 5s hook
    // timeout would mark the handler as "failed" and eventually trip the
    // circuit breaker, even though the work itself proceeds correctly. By
    // returning immediately and running the backfill in the background, the
    // hook stays under its timeout and the work logs its own completion
    // ("backfilled being homes: ...") when done.
    core.hooks.register("afterBoot", async () => {
      runGoverningBackfill().catch((err) => {
        log.warn("Governing", `being-home backfill error: ${err.message}`);
      });
    }, "governing");

    async function runGoverningBackfill() {
      try {
        const Node = (await import("../../seed/models/node.js")).default;

        // Backfill being homes on the four kinds of governing structural
        // nodes: Ruler, plan trio (Planner), contracts trio (Contractor),
        // execution node (Foreman). For each kind we query by governing
        // role marker and add the matching beings entry where it
        // does not already exist.
        // Each backfill entry carries a `permissions(scopeNodeId)`
        // function that produces the SUMMON rule for the node. Trio
        // rules use the scopeRulerId (read from the existing
        // governing metadata) as the homeInDomain bound, so beings
        // from other rulerships can't address this trio's inner being.
        // Ruler nodes get an open rule (anyone can address the Ruler).
        // Each backfill entry distinguishes the node's structural
        // marker (`nodeType`, queried against metadata.governing.role)
        // from the role assigned to the being that lives there
        // (`beingRole`). They happen to match here because governing
        // has a 1:1 mapping between node kinds and being roles, but
        // the field names stay explicit so other extensions with
        // different mappings can reuse the pattern.
        const BACKFILLS = [
          {
            nodeType: "ruler", beingRole: "ruler",
            permissions: () => ({ summon: { "@ruler*": { requires: {} } } }),
          },
          {
            nodeType: "plan", beingRole: "planner",
            permissions: (scopeId) => ({ summon: { "@planner*": {
              requires: {
                role:         ["ruler", "planner", "contractor", "foreman"],
                homeInDomain: scopeId,
              },
            } } }),
          },
          {
            nodeType: "contracts", beingRole: "contractor",
            permissions: (scopeId) => ({ summon: { "@contractor*": {
              requires: {
                role:         ["ruler", "planner", "contractor", "foreman"],
                homeInDomain: scopeId,
              },
            } } }),
          },
          {
            nodeType: "execution", beingRole: "foreman",
            permissions: (scopeId) => ({ summon: { "@foreman*": {
              requires: {
                role:         ["ruler", "planner", "contractor", "foreman"],
                homeInDomain: scopeId,
              },
            } } }),
          },
        ];
        const { createBeingWithHome } = await import("../../seed/auth.js");
        const counts = {};
        for (const { nodeType, beingRole, permissions } of BACKFILLS) {
          const nodes = await Node.find({ "metadata.governing.role": nodeType })
            .select("_id metadata")
            .lean();
          let written = 0;
          for (const n of nodes) {
            const meta = n.metadata;
            const emb = meta instanceof Map ? meta.get("beings") : meta?.embodiments;
            const existingPerms = meta instanceof Map ? meta.get("permissions") : meta?.permissions;
            const beingPresent = !!emb?.[beingRole]?.beingId;
            const permsPresent = !!existingPerms?.summon?.[`@${beingRole}*`];
            if (beingPresent && permsPresent) continue;     // fully migrated
            const gov = meta instanceof Map ? meta.get("governing") : meta?.governing;
            const fresh = await Node.findById(n._id);
            if (!fresh) continue;
            // The node already exists (this is a backfill). Place the
            // being via the unified primitive if missing, then stamp
            // permission rules if missing. Each merge is independent
            // so partial-migrated nodes get topped up.
            if (!beingPresent) {
              await createBeingWithHome({
                operatingMode: "ai",
                role:          beingRole,
                homeNodeId:    String(fresh._id),
              });
              // Phase 3 migration: verb-surface merge into beings ns.
              await core.do(fresh, "set-meta", {
                namespace: "beings",
                data: {
                  [beingRole]: {
                    installedBy:  "governing-backfill",
                    from:         gov?.promotedFrom || null,
                    scopeRulerId: gov?.scopeRulerId || null,
                  },
                },
                merge: true,
              });
            }
            if (!permsPresent && typeof permissions === "function") {
              // The trio backfills want scopeRulerId; ruler backfills
              // ignore it. For trio nodes the scopeRulerId is on the
              // node's governing metadata. For ruler nodes the scope
              // IS the node itself — passing the node id as scopeId
              // produces the open ruler rule (which doesn't consult it).
              const scopeId = gov?.scopeRulerId || String(fresh._id);
              await core.do(fresh, "set-meta", {
                namespace: "permissions",
                data: permissions(scopeId),
                merge: true,
              });
            }
            written++;
          }
          if (written > 0) counts[beingRole] = written;
        }
        const summary = Object.entries(counts)
          .map(([k, v]) => `${k}:${v}`)
          .join(", ");
        if (summary) {
          log.info("Governing", `backfilled being homes: ${summary}`);
        }
      } catch (err) {
        log.warn("Governing", `being-home backfill failed: ${err.message}`);
      }
    }

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
        // saw most (usually code).
        //
        // Workspace-declared decomposition hints (defaultShape,
        // branchWhen, leafWhen, integrateWhen, antiPatterns, example)
        // come from the workspace's own registration — that's where
        // the workspace owner names the shape of its production
        // work. The Planner reads these and adapts.
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

            // Static fallback (in case a workspace hasn't declared
            // its hints yet). Workspace-declared hints below override.
            const FALLBACK_HINTS = {
              "book-workspace":
                "Prose artifacts. Workers write text as NOTES on tree nodes (create-node-note), not as files.",
              "code-workspace":
                "Code artifacts. Workers create + edit FILES via workspace-add-file / workspace-edit-file.",
            };
            const fallback = FALLBACK_HINTS[ws] || `Workspace "${ws}" is active.`;

            // Read workspace-declared decomposition hints. The
            // workspace owner names defaultShape, when-to-branch,
            // when-to-integrate, anti-patterns, and an example plan.
            // Renders to a multi-section block the Planner reads
            // directly. Without these, the Planner has no
            // workspace-specific guidance beyond the static fallback.
            let hintsBlock = "";
            try {
              const hints = getWorkspaceDecompositionHints(ws);
              if (hints) {
                const lines = [];
                if (hints.defaultShape) {
                  lines.push(`### Default decomposition shape\n${hints.defaultShape}`);
                }
                if (hints.branchWhen) {
                  lines.push(`### When to use BRANCH steps\n${hints.branchWhen}`);
                }
                if (hints.leafWhen) {
                  lines.push(`### When to use LEAF steps\n${hints.leafWhen}`);
                }
                if (hints.integrateWhen) {
                  lines.push(`### When to use INTEGRATE workerType\n${hints.integrateWhen}`);
                }
                if (Array.isArray(hints.antiPatterns) && hints.antiPatterns.length) {
                  lines.push("### Anti-patterns (do NOT emit plans shaped like these)");
                  for (const a of hints.antiPatterns) lines.push(`  • ${a}`);
                }
                if (hints.example) {
                  lines.push(`### Example plan shape\n${hints.example}`);
                }
                if (lines.length) {
                  hintsBlock = "\n\n" + lines.join("\n\n");
                }
              }
            } catch (err) {
              log.debug("Governing", `enrichContext decomp-hints read skipped: ${err.message}`);
            }

            context.governingActiveWorkspace =
              "## ACTIVE WORKSPACE AT THIS SCOPE\n\n" +
              `Workspace: **${ws}**\n` +
              (typedWorkers ? `Typed Workers available: ${typedWorkers}\n\n` : "\n") +
              fallback +
              hintsBlock;
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
    // Wake mechanism — substrate-based.
    //
    // The legacy runRulerTurn hook subscribers (six events: planner /
    // contractor / planRevised / swarmDispatched / foremanRouted /
    // branchRetried, each waking the Ruler through tree-orchestrator)
    // are retired. The new wake path:
    //
    //   sub-being's role.summon → emitReplyToAsker → asker's inbox →
    //   scheduler invokes asker's role.summon
    //
    // For approval gates (entry-scope plan emission, etc.) the Ruler
    // itself emits a reply-SUMMON to its chain-initial caller (the
    // user-being or parent Ruler). The card is a SUMMON content shape,
    // not a special hook-emitted socket event. See memory
    // `card-is-a-summon` for the architectural lock.
    //
    // Dashboard SSE subscribers (above) stay — they're observation, not
    // mechanism.
    // ─────────────────────────────────────────────────────────────────
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

  // Phase 3 ([[project_seed_four_verbs_only]]): utility functions that
  // write through the verb surface need `core` in scope. Wrapping them
  // here injects core at the export boundary so external callers
  // (tree-orchestrator/dispatch.js, rulerTools, flagTools, etc.)
  // continue calling these helpers with their existing signatures.
  // The helper functions inside state/* and roles/* require core to
  // be present; the wrapper guarantees it.
  const bindCore = (fn) => (args = {}) => fn({ ...args, core });

  // ────────────────────────────────────────────────────────────────────
  // Phase 3c: Register governing's DO operations.
  //
  // Operations reachable via `core.do(target, "governing:<action>", ...)`
  // from anywhere with `core` in scope . extension code, wire dispatch,
  // future MCP tools that compile to DO calls. Each handler runs through
  // the seed verb dispatcher, which auto-writes a Did and (when Phase 5
  // adds it) gates through authorize.
  //
  // Proof slice: `governing:flag-issue`. The existing
  // `governing-flag-issue` MCP tool can be migrated in a follow-up to
  // dispatch through this operation instead of calling appendFlag
  // directly; for now both paths reach the same handler (appendFlag).
  // ────────────────────────────────────────────────────────────────────
  if (typeof core.do?.registerOperation === "function") {
    // Helper: extract a nodeId from whatever target shape arrived.
    const idOf = (t) =>
      (t && typeof t === "object" && (t._id || t.nodeId)) || t || null;

    // Operation names are bare. The loader's scoped registerOperation
    // wrapper auto-prepends "governing:" and stamps ownerExtension. The
    // extension never types its own namespace . the namespace is
    // implicit from the registration context.
    core.do.registerOperation("flag-issue", {
      targets: ["node"],
      handler: async ({ target, params, identity }) => {
        return appendFlag({
          rulerNodeId: idOf(target),
          payload: {
            kind: params.kind,
            artifactContext: params.artifactContext || {},
            localChoice: params.localChoice || null,
            blocking: !!params.blocking,
            proposedResolution: params.proposedResolution || null,
          },
          beingId: identity?.beingId || null,
          sourceWorkerScopeId: params.sourceWorkerScopeId || null,
          sourceWorkerType:    params.sourceWorkerType || null,
          core,
        });
      },
    });

    core.do.registerOperation("hire-planner", {
      targets: ["node"],
      handler: async ({ target, params, identity }) => {
        // Materializes the plan trio child + Planner being at the
        // Ruler scope (target). Idempotent.
        return ensurePlanAtScope({
          scopeNodeId: idOf(target),
          beingId:     identity?.beingId || params.beingId || null,
          name:        params.name || "plans",
          systemSpec:  params.systemSpec || null,
          summonId:    params.summonId || null,
          sessionId:   params.sessionId || null,
          core,
        });
      },
    });

    core.do.registerOperation("hire-contractor", {
      targets: ["node"],
      handler: async ({ target, params, identity }) => {
        return ensureContractsNode({
          scopeNodeId: idOf(target),
          beingId:     identity?.beingId || params.beingId || null,
          core,
        });
      },
    });

    core.do.registerOperation("route-to-foreman", {
      targets: ["node"],
      handler: async ({ target, params, identity }) => {
        return ensureExecutionNode({
          scopeNodeId: idOf(target),
          beingId:     identity?.beingId || params.beingId || null,
          core,
        });
      },
    });

    core.do.registerOperation("ratify-plan", {
      targets: ["node"],
      handler: async ({ target, params }) => {
        // target is the Ruler node; params.planNodeId is the plan
        // emission being ratified. Status defaults to "approved".
        return appendPlanApproval({
          rulerNodeId: idOf(target),
          planNodeId:  params.planNodeId,
          status:      params.status || "approved",
          supersedes:  params.supersedes || null,
          reason:      params.reason || null,
          core,
        });
      },
    });

    core.do.registerOperation("archive-plan", {
      targets: ["node"],
      handler: async ({ target, params }) => {
        // Marks the plan approval as "archived". Same primitive as
        // ratify, different status. Optionally freezes the active
        // execution-record as "cancelled" too (Pass 1 archive policy).
        return appendPlanApproval({
          rulerNodeId: idOf(target),
          planNodeId:  params.planNodeId,
          status:      "archived",
          supersedes:  params.supersedes || null,
          reason:      params.reason || null,
          core,
        });
      },
    });

    core.do.registerOperation("emit-contracts", {
      targets: ["node"],
      handler: async ({ target, params, identity }) => {
        return setContracts({
          scopeNodeId:           idOf(target),
          contracts:             params.contracts || [],
          beingId:               identity?.beingId || null,
          systemSpec:            params.systemSpec || null,
          reasoning:             params.reasoning || null,
          inheritsFrom:          params.inheritsFrom || null,
          parentContractsApplied: params.parentContractsApplied || [],
          core,
        });
      },
    });

    log.verbose("Governing",
      "Registered DO operations (auto-namespaced): flag-issue, hire-planner, " +
      "hire-contractor, route-to-foreman, ratify-plan, archive-plan, emit-contracts");
  } else {
    log.debug("Governing", "core.do.registerOperation unavailable; skipping operation registrations");
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
      promoteToRuler: bindCore(promoteToRuler), readRole, isRuler, findRulerScope, walkRulers, PROMOTED_FROM, NS,
      // Dashboard data orchestrator + tree-governance predicate.
      // The governance page calls buildDashboardData; isTreeGoverned
      // is a cheap probe other extensions can use.
      buildDashboardData, isTreeGoverned,
      // LCA / scope authority
      findLCA, ancestorChain, isAncestorOrSelf, validateScopeAuthority,
      // Contracts (trio: contracts-type node holds emissions, Ruler holds
      // approval ledger). See project_contracts_node_architecture.
      setContracts: bindCore(setContracts), readContracts, readScopedContracts, readApprovalsAtRuler,
      // Trio member ensure-fns. Each scaffolds a child node + role/mode/
      // being/permissions metadata writes through the verb surface.
      readActiveContractsEmission,
      ensureContractsNode: bindCore(ensureContractsNode),
      // Plan trio member primitive (Phase F absorbed from the plan
      // extension). governing now owns plan-type node creation +
      // role/mode stamping directly, parallel to contracts-type and
      // execution-type. Plan-emission ring records (immutable per
      // Planner invocation) live as children; the Ruler's planApprovals
      // ledger tracks the active emission.
      createPlanNode: bindCore(createPlanNode),
      ensurePlanAtScope: bindCore(ensurePlanAtScope),
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
      appendPlanApproval: bindCore(appendPlanApproval),
      readPlanApprovalsAtRuler,
      readPlanApprovalLedger,
      readActivePlanApproval,
      readLatestPlanApproval,
      readActivePlanEmission,
      readPendingPlanEmission,
      buildPlanRef, parsePlanRef,
      // Sub-Ruler lineage. writeLineage is called at dispatch time
      // (sub-Ruler promotion); readLineage walks the upstream chain.
      // inferLineageFromParent reconstructs lineage details from the
      // parent's active plan emission when explicit dispatch params
      // weren't threaded (current branch-swarm path).
      writeLineage: bindCore(writeLineage), readLineage, inferLineageFromParent,
      // Foreman quartet member. ensureExecutionNode materializes the
      // execution-node child of a Ruler; appendExecutionRecord creates
      // a new execution-record tied to a plan emission (with optional
      // contracts emission ref) and writes the executionApproval
      // ledger entry. updateStepStatus / freezeExecutionRecord are
      // called by swarm (Phase B+) as branches transition through
      // pending → running → done / failed. The Foreman LLM reasoning
      // surface lands in Pass 2; Pass 1 establishes the data home.
      ensureExecutionNode: bindCore(ensureExecutionNode), findExecutionNode,
      appendExecutionRecord: bindCore(appendExecutionRecord),
      appendExecutionApproval: bindCore(appendExecutionApproval),
      readExecutionApprovalsAtRuler, readActiveExecutionApproval,
      readActiveExecutionRecord,
      updateStepStatus: bindCore(updateStepStatus),
      updateStepStatusByBranchName: bindCore(updateStepStatusByBranchName),
      freezeExecutionRecord: bindCore(freezeExecutionRecord),
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
      getWorkspaceDecompositionHints,
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
      appendFlag: bindCore(appendFlag),
      readPendingIssues,
      markFlagResolved: bindCore(markFlagResolved),
      summarizeFlags,
      formatFlagSummary,
      // Ruler-as-being primitive. The Ruler mode runs every turn at a
      // Ruler scope and decides what to do; rulerSnapshot assembles its
      // per-turn state context. Slice 7 retired the rulerDecisions
      // per-visitor register and the runRulerTurn dispatcher that read
      // it — tools now emit SUMMONs inline. The Ruler is the addressable
      // being; its kernel-scheduler-driven role.summon (roles/rulerRole.js)
      // replaces the orchestrator-side dispatch loop.
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
    },
  };
}
