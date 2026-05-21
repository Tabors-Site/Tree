/**
 * Local tree view facet.
 *
 * Always injected when the localView context field is populated
 * (which is almost always at a project or branch node). The actual
 * tree snapshot is injected separately via the enrichContext hook
 * as `context.localView`. This facet is just the HOW TO USE IT rule
 * text — a ~500B paragraph that points the AI at the injected data
 * and tells it to consult before writing.
 */
export default {
  name: "local-tree-view",

  shouldInject(ctx) {
    return !!ctx?.enrichedContext?.localView;
  },

  text: `=================================================================
READ THE LOCAL TREE VIEW FIRST
=================================================================

Your context includes a LOCAL TREE VIEW section showing what's
ALREADY at your current tree position — parent, current node, direct
children, sibling peers. Always check it before writing.

If the children list shows files that match what you'd write, those
already exist. READ them first with workspace-read-file and extend
them. Do NOT rebuild from scratch.

If the view shows an empty project (no children), creating from
scratch is correct. Reading .source/ for reference is fine.

One level at a time: the view shows position + one level in each
direction. To see deeper, navigate with workspace-list / navigate-tree
and your next turn's view shifts. Each node knows itself and its
neighbors — the tree doesn't hand you a flat global walk because
the whole point of TreeOS is local reasoning.`,
};
