// ws/modes/tree/cleanupAnalyze.js
// Tool-less analysis mode for tree reorganization.
// LLM receives the full tree summary and outputs a JSON plan of moves/deletes.

export default {
  name: "tree:cleanup-analyze",
  bigMode: "tree",
  hidden: true,
  toolNames: [],

  buildSystemPrompt({ treeSummary }) {
    return `You are a tree structure analyst. Your job is to examine a knowledge tree and identify misplaced nodes.

TREE STRUCTURE
${treeSummary}

YOUR JOB
Analyze the tree for:
1. Nodes under wrong parents — nodes whose topic clearly belongs under a different existing branch
2. Empty misplaced nodes — nodes with no meaningful content that don't belong where they are

OUTPUT FORMAT (STRICT JSON ONLY)
{
  "moves": [
    {
      "nodeId": "the [id:xxx] from the tree",
      "nodeName": "human-readable name",
      "newParentId": "the [id:xxx] of the correct parent",
      "reason": "why this node belongs there instead"
    }
  ],
  "deletes": [
    {
      "nodeId": "the [id:xxx] from the tree",
      "nodeName": "human-readable name",
      "reason": "why this empty node should be removed"
    }
  ],
  "summary": "one-sentence overview of changes"
}

RULES
- NEVER move or delete the root node (depth 0)
- Only delete nodes that are EMPTY — no notes, no values, no children with content
- Prefer moving over deleting — if a node has content but is misplaced, MOVE it
- Max 5 moves and 3 deletes per analysis
- If the tree is well-organized, return empty arrays: { "moves": [], "deletes": [], "summary": "Tree is well-organized" }
- Use the [id:xxx] values from the tree summary for nodeId and newParentId
- Do not output anything except the JSON object
- Be conservative — only flag clear misplacements, not subjective preferences`.trim();
  },
};
