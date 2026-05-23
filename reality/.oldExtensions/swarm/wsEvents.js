/**
 * Swarm-owned WebSocket event names.
 *
 * Kept OUT of seed/protocol.js's WS table because these events are
 * extension-specific — the kernel doesn't know about swarms.
 * Servers inside the swarm extension (and any code that needs to
 * emit from a socket) import the constants from here.
 *
 * Clients (CLI, dashboard) listen to the string literals directly.
 * They don't import this file — web bundles and the CLI never pull
 * from the server's extension tree.
 *
 * Plan-lifecycle events (plan-first swarm):
 *
 *   PLAN_PROPOSED  Architect emitted [[BRANCHES]]; swarm is paused
 *                  pending user review. v1 of a freshly proposed plan.
 *   PLAN_UPDATED   The architect re-emitted the plan in response to
 *                  a user revision request (v2+). The plan is still
 *                  pending approval; the client re-renders its plan
 *                  card with the revised branches. Distinct from
 *                  SUB_PLAN_PROPOSED (which fires when a worker emits
 *                  nested [[BRANCHES]] for a scoped sub-plan; that path
 *                  was Pass 1's local rewire of an older root-replan
 *                  flow that this event used to serve).
 *   PLAN_ARCHIVED  User pivoted while a plan was in flight.
 *
 * Sub-plan lifecycle (Pass 1 — scoped approval at worker's node):
 *
 *   SUB_PLAN_PROPOSED  A running worker emitted nested [[BRANCHES]].
 *                      A plan-type node was created as child of the
 *                      worker's node, populated with proposed branches
 *                      in pending-approval status. Payload shows only
 *                      the local sub-plan with parent context as
 *                      breadcrumbs (not the whole project plan).
 *                      Client renders a scoped plan card.
 *   SUB_PLAN_COMPLETE  A sub-plan's branches have all terminated.
 *                      Parent branch's session resumes with a rollup
 *                      of sub-branch outcomes in its signal inbox.
 *   SUB_PLAN_ESCALATION  A sub-plan couldn't settle locally and needs
 *                      parent-plan attention (budget exhausted,
 *                      unresolved signals). Parent's inbox gets the
 *                      escalation; parent decides whether to retry,
 *                      redistribute, or emit [[DONE]].
 *
 * Scout-phase events (seam-verification layer, fires after all branches
 * finish their builder work):
 *
 *   SCOUTS_DISPATCHED  A scout cycle just started. Payload: { cycle,
 *                      branches: [{ name, kind: "per-branch"|"integration" }] }.
 *                      Clients show "🔍 Dispatching N scouts (cycle C)...".
 *   SCOUT_REPORT       One scout returned findings. Payload: { cycle,
 *                      branch, kind, issues: [{ kind, detail, targetBranch? }] }.
 *                      Clients render one line per issue.
 *   ISSUES_ROUTED      All scouts in this cycle have reported; their issues
 *                      have been appended to the affected branches' signal
 *                      inboxes. Payload: { cycle, total, affectedBranches }.
 *   REDEPLOYING        The branches with routed issues are being re-run.
 *                      Payload: { cycle, branches: [names] }.
 *   SWARM_RECONCILED   The scout loop finished. Payload: { cycles, status:
 *                      "clean" | "stuck" | "capped", totalIssues }.
 */

export const SWARM_WS_EVENTS = Object.freeze({
  PLAN_PROPOSED: "swarmPlanProposed",
  PLAN_UPDATED:  "swarmPlanUpdated",
  PLAN_ARCHIVED: "swarmPlanArchived",
  SUB_PLAN_PROPOSED:   "swarmSubPlanProposed",
  SUB_PLAN_COMPLETE:   "swarmSubPlanComplete",
  SUB_PLAN_ESCALATION: "swarmSubPlanEscalation",
  SUB_PLAN_ARCHIVED:   "swarmSubPlanArchived",
  SUB_PLAN_DISPATCHED: "swarmSubPlanDispatched",
  // Client → server actions (user approves/cancels a proposed sub-plan).
  // Registered via registerSocketHandler on the server side.
  SUB_PLAN_ACCEPT: "swarmSubPlanAccept",
  SUB_PLAN_CANCEL: "swarmSubPlanCancel",
  SCOUTS_DISPATCHED: "swarmScoutsDispatched",
  SCOUT_REPORT:      "swarmScoutReport",
  ISSUES_ROUTED:     "swarmIssuesRouted",
  REDEPLOYING:       "swarmRedeploying",
  SWARM_RECONCILED:  "swarmReconciled",
});
