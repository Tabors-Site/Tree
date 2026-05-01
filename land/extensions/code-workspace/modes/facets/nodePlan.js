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
    // Skip when the rendered "plan" is just the empty-state placeholder
    // ("no local plan yet"). At an empty plan node the Planner has not
    // yet emitted; injecting plan-advancement rules into that turn
    // would contradict the Planner's own work.
    if (/\(no local plan yet\b/.test(ctx.enrichedContext.nodePlan)) return false;
    // Skip on turn 1 at a fresh project root. The Ruler-cycle is about
    // to dispatch the Planner; the Worker shouldn't see plan-advancement
    // rules before the plan exists.
    const view = ctx?.enrichedContext?.localViewData;
    const isFreshProjectRoot =
      ctx?.isFirstTurn === true &&
      view &&
      (!view.self?.role || view.self.role === "project") &&
      (view.self?.childCount || 0) === 0;
    if (isFreshProjectRoot) return false;
    return true;
  },

  text: `Plan rules:
  • Find the first "[ ]" step. Do it in one tool call. Check off
    with workspace-plan action=check stepId=<id>. One line of output.
  • stepIds rotate when a plan is re-set — copy the id from THIS
    turn's plan block, never from memory of a previous turn.
  • One step per turn. The continuation loop re-invokes for the next.
  • Don't check off steps you didn't actually do. If one write
    covered multiple steps, re-set the plan to match reality before
    checking any off.
  • Blocked? workspace-plan action=block stepId=<id> reason="..."
  • All your local steps done → [[DONE]]. Descendant rollup pending
    is fine — that's their sessions' job, not yours.`,
};
