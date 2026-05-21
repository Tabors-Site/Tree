// extensions/dreams/modes/cleanupAnalyze.js
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

NODE TYPES
Nodes may have a type: goal, plan, task, knowledge, resource, identity, or custom.
Use types to evaluate structure quality:
- A goal without child plans or tasks beneath it is unsupported
- Tasks scattered outside any plan may belong grouped under one
- Knowledge nodes buried under task branches may belong in a knowledge section
- Identity nodes should be near the root, not deep in branches
- Mistyped nodes (a task that's clearly knowledge) can be flagged

YOUR JOB
Analyze the tree for:
1. Nodes under wrong parents, considering both topic AND type hierarchy
2. Empty misplaced nodes with no meaningful content
3. Type-structural issues: unsupported goals, orphaned tasks, misplaced identity nodes

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
  "typeIssues": [
    {
      "nodeId": "the [id:xxx] from the tree",
      "nodeName": "human-readable name",
      "currentType": "current type or null",
      "suggestedType": "what it should be",
      "reason": "why"
    }
  ],
  "summary": "one-sentence overview of changes"
}

RULES
- NEVER move or delete the root node (depth 0)
- Only delete nodes that are clearly broken hierarchy (duplicates, redundant structure) or completely irrelevant to the tree
- Empty nodes that fit the tree's structure should be LEFT ALONE — they may be placeholders waiting to be filled
- Nodes with [N notes] annotations have user content — NEVER delete these, move them instead
- Prefer moving over deleting — when in doubt, MOVE instead of delete
- Max 5 moves and 3 deletes per analysis
- If the tree is well-organized, return empty arrays: { "moves": [], "deletes": [], "summary": "Tree is well-organized" }
- Use the [id:xxx] values from the tree summary for nodeId and newParentId
- Do not output anything except the JSON object
- Be conservative — only flag clear misplacements, not subjective preferences`.trim();
  },
};
