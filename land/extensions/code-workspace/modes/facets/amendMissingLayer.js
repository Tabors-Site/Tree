/**
 * Amend-missing-layer facet.
 *
 * Injected when the current node has a subPlan with at least one existing
 * branch AND the position is still a project-or-branch role (the node
 * decomposes into children). The block teaches the agent: if the user's
 * latest message asks for a layer that is NOT covered by an existing
 * branch, the correct action is to emit a [[BRANCHES]] block with ONLY
 * the missing layer — the swarm's subPlan is additive, existing branches
 * stay as they are, contracts carry over.
 *
 * This is what makes compound projects survive the "architect forgot a
 * layer" failure mode and makes follow-up messages like "now build the
 * client side" or "add an admin dashboard" actually extend the tree
 * instead of silently writing files at the project root.
 *
 * We do NOT read the user's latest message here — it is not in ctx —
 * so we push the is-layer-missing? decision to the LLM. The text
 * explicitly tells the agent to skip this block when the message fits
 * an existing branch or is a normal edit.
 */
export default {
  name: "amend-missing-layer",

  shouldInject(ctx) {
    const view = ctx?.enrichedContext?.localViewData;
    if (!view) return false;
    // Must be a node that scopes children: project root or an existing branch.
    const selfRole = view.self?.role;
    if (selfRole !== "project" && selfRole !== "branch") return false;
    // Must have at least one child branch. Otherwise compoundBranches
    // handles the fresh-decomposition case.
    const childCount = view.self?.childCount || 0;
    if (childCount === 0) return false;
    return true;
  },

  text: `=================================================================
EXTENDING THE PLAN — ADD A MISSING LAYER
=================================================================

This position already has child branches (see the PROJECT PLAN above).
If the user's latest message asks for a LAYER that is NOT covered by
any existing branch — for example "build the client side" when only a
backend branch exists, or "add an admin dashboard" when the plan has
just an app — your FIRST action is to extend the plan with the missing
layer, not to write files at this position.

To extend, emit a [[BRANCHES]] block with ONLY the new branch(es):

    [[BRANCHES]]
    branch: <missing-layer-name>
      spec: <one paragraph, derived from the project's systemSpec and
            the user's message>
      slot: code-plan
      path: <same as name>
      files: <expected files for this layer>
    [[/BRANCHES]]
    [[DONE]]

The swarm runner appends only the new branches to the existing
subPlan — existing branches are untouched and are NOT re-dispatched.
Existing contracts are already stored on the project root and will be
injected into the new branch's prompt automatically; do NOT re-declare
them.

Skip this block when:
  - The user's message fits an EXISTING branch's scope — let the normal
    code-plan flow dispatch to that branch.
  - The user is asking a general question, requesting status, or wants
    a small edit to files you already control — proceed without
    branching.
  - You are inside a leaf branch (no children expected here).

The same rule holds at any depth. If you are inside a branch and the
user asks for a sub-component that does not yet exist, emit a
[[BRANCHES]] block from here. The new branch becomes a child of your
current node. The tree extends itself; the plan stays coherent.`,
};
