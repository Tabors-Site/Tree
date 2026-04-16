/**
 * Node-local plan facet.
 *
 * Injects when enrichedContext.nodePlan is populated — i.e., this node
 * has (or its subtree has) a checklist to advance. The rendered plan
 * itself is injected separately as `context.nodePlan`; this facet is
 * just the HOW-TO-USE-IT rule the AI needs to read the plan, pick the
 * next pending step, advance one thing per turn, and check it off.
 *
 * Self-similar: the same facet applies at a project root, at a branch,
 * at a sub-branch, at any workspace node that owns steps. Each scope
 * plans locally; children's counts roll up into the parent's rollup
 * line automatically via rollUpStepCounts.
 */
export default {
  name: "node-plan",

  shouldInject(ctx) {
    if (!ctx?.enrichedContext?.nodePlan) return false;
    // Defer to compoundBranches on turn 1 at an empty project root.
    // Otherwise both facets render and the AI gets contradictory
    // guidance: "set a plan" vs "emit [[BRANCHES]] first". The empty-
    // root path should go through compoundBranches exclusively so the
    // AI emits a [[BRANCHES]] block instead of calling workspace-plan
    // action=set (which now gets rejected by the gate and leaves the
    // AI with no productive next action).
    const view = ctx?.enrichedContext?.localViewData;
    const isFreshProjectRoot =
      ctx?.isFirstTurn === true &&
      view &&
      (!view.self?.role || view.self.role === "project") &&
      (view.self?.childCount || 0) === 0;
    if (isFreshProjectRoot) return false;
    return true;
  },

  text: `=================================================================
NODE-LOCAL PLAN — ADVANCE IT, DO NOT IGNORE IT
=================================================================

A "Plan for ..." block is injected in your context. That is YOUR
checklist for THIS tree position. It is the canonical record of what
needs to happen at this scope. Read it first every turn.

How a turn works:

  1. Find the first pending step (one with "[ ]") in your local plan.
  2. Do that step in exactly one tool call.
  3. Check it off with workspace-plan action=check stepId=<id>.
  4. Return one line and stop.

IMPORTANT — stepIds rotate when the plan is re-set. The ids you
saw in earlier turns are STALE. Read the Plan block in THIS turn's
CONTEXT FOR THIS TURN section and copy the exact stepId for the
first "[ ]" entry you see NOW. Do not reuse an id from memory of
a previous turn.

If the plan shows "(no local plan yet)" AND the task you were handed
is not a one-line change, your FIRST action this turn is:

    workspace-plan action=set steps=["first step", "second step", ...]

Decompose the task into 3-8 concrete, checkable steps. Each step
should be one file write or one edit. Do not plan in words — plan
in commits. Only after the plan is set do you begin executing it.

If you hit a problem you cannot resolve, mark the step blocked:

    workspace-plan action=block stepId=<id> reason="short reason"

Do NOT silently skip steps. Do NOT do two steps in one turn. The
continuation loop will re-invoke you for the next step.

When every step is "[x] done" AND no rollup shows pending descendants,
end your turn with [[DONE]] on its own line.

If the plan shows "Including descendants: N pending" but your own
local steps are all done, your job at this node is complete — emit
[[DONE]] and let the children's sessions continue their own plans.
You are responsible for YOUR scope, not theirs.`,
};
