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
 *                  pending user review.
 *   PLAN_UPDATED   A running branch emitted nested [[BRANCHES]]; the
 *                  architect re-emitted the whole plan.
 *   PLAN_ARCHIVED  User pivoted while a plan was in flight.
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
  SCOUTS_DISPATCHED: "swarmScoutsDispatched",
  SCOUT_REPORT:      "swarmScoutReport",
  ISSUES_ROUTED:     "swarmIssuesRouted",
  REDEPLOYING:       "swarmRedeploying",
  SWARM_RECONCILED:  "swarmReconciled",
});
