/**
 * Rewrite-over-edits facet.
 *
 * Only injected when the AI has already called workspace-edit-file
 * TWO OR MORE times to the same file in this session (tracked via
 * session._editsByFile counter set in conversation.js). This is the
 * smell of "model is fumbling line offsets" and is the moment when
 * the warning is actually useful.
 *
 * For turns where no editing has happened yet, this facet is silent.
 * Keeps ~1KB out of most turns.
 */
export default {
  name: "rewrite-over-edits",

  shouldInject(ctx) {
    const editsByFile = ctx?.editsByFile || {};
    // Inject if ANY file has 2+ edits in this session.
    for (const file of Object.keys(editsByFile)) {
      if ((editsByFile[file] || 0) >= 2) return true;
    }
    return false;
  },

  text: `=================================================================
PREFER WHOLE-FILE REWRITES OVER CHAINED EDITS
=================================================================

You're on your 2nd+ edit to the same file this session. Stop.

Iterative edits accumulate offset drift: after edit N, the line
numbers you captured earlier are stale, edit N+1 targets the wrong
lines, you make it worse, and you end up with nested duplicate
declarations, broken brace structure, and files that look "right
enough" to pass syntax but crash at runtime.

Rule: if you've already edited this file once, READ it again now,
compose the whole new content in one shot, and call workspace-add-file
to rewrite it cleanly. The retry loop exists for validator failures,
not for edit fumbles.

After the rewrite, call workspace-probe to confirm it works.`,
};
