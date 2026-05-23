/**
 * Governing-owned WebSocket event names.
 *
 * Plan / contracts / execution lifecycle events are governing's
 * concern. The Ruler's tools fire them when the corresponding
 * lifecycle transition happens. Clients (dashboard, CLI) listen by
 * string literal — they don't import this file.
 *
 * Why these live here and not in swarm:
 * Swarm is the mechanism layer (queue dispatch, branch retry, scout
 * verification). It owns events that surface mechanism state:
 * BRANCH_STARTED, SCOUTS_DISPATCHED, etc. The plan-and-contract
 * lifecycle is governance — a Ruler decides, a Planner drafts, a
 * Contractor ratifies. Those events came from swarm historically
 * (when swarm did everything before the role taxonomy existed); they
 * moved here when the architecture clarified.
 *
 * The old swarm event names (swarmPlanProposed, swarmPlanUpdated,
 * swarmPlanArchived) still exist in swarm/wsEvents.js for any
 * legacy code that hasn't migrated. Dashboard and CLI may listen for
 * both during the transition. Once all emit sites use governing's
 * names, the swarm versions can be dropped.
 *
 * Plan-lifecycle:
 *
 *   PLAN_PROPOSED  Ruler hired Planner; Planner emitted a structured
 *                  plan; user is being shown the plan card. Client
 *                  renders Accept/Revise/Cancel buttons.
 *   PLAN_UPDATED   The Ruler revised the plan (Planner re-ran with
 *                  revision briefing). Client supersedes prior card
 *                  with the new emission.
 *   PLAN_ARCHIVED  Ruler called governing-archive-plan; the plan is
 *                  no longer active. Client clears any live plan card.
 *
 * Contract-lifecycle:
 *
 *   CONTRACTS_RATIFIED  Ruler hired Contractor; contracts were
 *                       drafted and ratified. Client may surface a
 *                       brief notification or update the plan view.
 *
 * Execution-lifecycle (mirrors the per-status terminal hooks
 * declared in governing's manifest, but as websocket events for the
 * client to track):
 *
 *   EXECUTION_STARTED   dispatch-execution kicked off the dispatch
 *                       chain. Client may show a running indicator.
 *   EXECUTION_COMPLETED Foreman froze the record at status=completed.
 *   EXECUTION_FAILED    Foreman froze at status=failed.
 *   EXECUTION_CANCELLED Foreman froze at status=cancelled.
 *   EXECUTION_PAUSED    Foreman froze at status=paused.
 *
 * Court-lifecycle (Pass 1 stub; Pass 2 fills in):
 *
 *   COURT_CONVENED      Ruler called governing-convene-court. Client
 *                       surfaces to operator that a court hearing is
 *                       pending.
 */

export const GOVERNING_WS_EVENTS = Object.freeze({
  PLAN_PROPOSED:  "governingPlanProposed",
  PLAN_UPDATED:   "governingPlanUpdated",
  PLAN_ARCHIVED:  "governingPlanArchived",

  CONTRACTS_RATIFIED: "governingContractsRatified",

  EXECUTION_STARTED:   "governingExecutionStarted",
  EXECUTION_COMPLETED: "governingExecutionCompleted",
  EXECUTION_FAILED:    "governingExecutionFailed",
  EXECUTION_CANCELLED: "governingExecutionCancelled",
  EXECUTION_PAUSED:    "governingExecutionPaused",

  COURT_CONVENED: "governingCourtConvened",
});
