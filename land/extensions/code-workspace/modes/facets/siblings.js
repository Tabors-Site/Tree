/**
 * Sibling branches facet.
 *
 * Injected when the current session runs inside a branch that has
 * siblings. Tells the AI that it can read what its siblings have
 * actually built (not just their declared contracts), and that the
 * sibling summary in enrichContext lists their files + key exports.
 * On-demand full reads go through workspace-peek-sibling-file.
 *
 * The problem this closes: before this, branches built blind to each
 * other's real code and invented interfaces that didn't match reality.
 * Contracts were shape-only; they caught protocol bugs but not wiring
 * bugs (null handling, missing method implementations, lifecycle
 * mismatches). With sibling visibility, the frontend branch reads the
 * backend's actual server.js before writing its fetch calls.
 */
export default {
  name: "siblings",

  shouldInject(ctx) {
    const siblings = ctx?.enrichedContext?.siblingBranches;
    return Array.isArray(siblings) && siblings.length > 0;
  },

  text: `=================================================================
SIBLING BRANCHES — READ-ONLY VISIBILITY
=================================================================

You are one branch of a larger project. Other branches have written
their own files in parallel. Their actual code is what the system
actually runs — not your imagination of it.

The "Sibling Branches" section below lists each sibling, its status,
its file tree, and a one-line summary of every file (first non-trivial
line: exports, route declarations, top-level definitions). Use it to:

  1. Match function / type / field names to what the sibling actually
     defined. If the sibling's server.js handles "POST /api/login",
     write your frontend fetch to "/api/login", not "/login" or
     "/api/auth/login". Copy names exactly.

  2. Know what already exists before writing anything new. If a
     sibling already built "backend/db.js" with a user CRUD module,
     don't duplicate it. Reference it.

  3. Spot gaps. If your branch's spec expects "backend/auth.js" but
     no sibling branch is building auth, call that out in a
     [[NO-WRITE: gap — no sibling owns auth]] block. Don't invent
     the missing piece yourself.

When the summary isn't enough — you need the full source of a sibling's
specific file — call workspace-peek-sibling-file with the sibling's
name and the file path (relative to the sibling's root). The response
is the full content, read-only. You cannot write to sibling files;
editing them from your branch breaks isolation. If a sibling's code
needs changing, emit [[NO-WRITE: <sibling> needs <change>]] and let
the architect's next pass dispatch a retry for that branch.

Rules:

  - Read siblings. Build from what they actually wrote.
  - Never write to a sibling's subtree. Your path scope is
    exclusive to your branch.
  - Contracts + sibling code together are your source of truth.
    When they disagree, the contract wins (the architect decides);
    open a [[NO-WRITE: contract mismatch in <sibling>]] if you
    see a sibling that contradicts a declared contract.`,
};
