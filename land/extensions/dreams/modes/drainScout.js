// ws/modes/tree/drainScout.js
// Scouts the tree for placement locations using navigate-tree tool.
// Drops "pins" on candidate nodes for a given cluster.

export default {
  name: "tree:drain-scout",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 15,
  preserveContextOnLoop: false,

  toolNames: ["navigate-tree"],

  buildSystemPrompt({ rootId, cluster, treeSummary }) {
    const itemsList = cluster.items
      .map((item, i) => `  [${i}] ${item.content}`)
      .join("\n");

    return `You are a navigation engine scouting placement locations for deferred items.

Tree root: ${rootId}

${treeSummary ? `TABLE OF CONTENTS:\n${treeSummary}\n` : ""}
CLUSTER TO PLACE
Theme: ${cluster.sharedTheme}
Needs new structure: ${cluster.needsNewStructure ? "likely yes" : "probably not"}${cluster.suggestedType ? `\nSuggested type: ${cluster.suggestedType}` : ""}
Items:
${itemsList}

Candidate hints: ${JSON.stringify(cluster.candidateHints || [])}

NODE TYPES
The tree uses types: goal, plan, task, knowledge, resource, identity.
When scouting, consider type compatibility. Tasks belong under plans or goals.
Knowledge belongs in knowledge sections. Note node types shown in the tree summary.

YOUR JOB
Find where these items belong in the tree. Drop "pins" on candidate locations.

1. Start from the candidate hints — use navigate-tree with search to find them.
2. If hints don't resolve, explore the tree structure from root.
3. Navigate to promising branches, inspect their children.
4. For each viable location, record it as a pin.

OUTPUT FORMAT (STRICT JSON ONLY)
{
  "pins": [
    {
      "nodeId": string,
      "nodePath": string,
      "pinType": "exact" | "parent" | "sibling",
      "reasoning": string,
      "confidence": number
    }
  ],
  "needsNewStructure": boolean,
  "structureHint": string | null,
  "summary": string
}

RULES:
- You MUST call navigate-tree at least once before returning
- "exact": items can be placed directly on/under this node
- "parent": new child node(s) needed under this parent
- "sibling": items belong near this node (same parent area)
- structureHint: if needsNewStructure=true, describe what to create
- Pin the deepest relevant node, not high-level branches
- Return the JSON as your final response, no markdown`.trim();
  },
};
