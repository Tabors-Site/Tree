// ws/modes/tree/drainCluster.js
// Groups pending ShortMemory items into placement clusters.
// Pure reasoning — no tools. All items injected into system prompt.

export default {
  name: "tree:drain-cluster",
  bigMode: "tree",
  hidden: true,
  toolNames: [],

  buildSystemPrompt({ rootId, items }) {
    const itemsBlock = items
      .map(
        (item, i) =>
          `[${i}] id=${item._id}
  content: ${item.content}
  deferReason: ${item.deferReason || "none"}
  candidates: ${item.candidates?.length ? item.candidates.map((c) => `${c.nodePath || c.nodeId} (${c.confidence})`).join(", ") : "none"}
  sessionId: ${item.sessionId || "none"}
  systemResponse: ${item.systemResponse ? item.systemResponse.slice(0, 200) : "none"}`,
      )
      .join("\n\n");

    return `You are a clustering engine for deferred memory items in a knowledge tree.

Tree root: ${rootId}

PENDING ITEMS
${itemsBlock}

YOUR JOB
Group these items into placement clusters. Items belong in the same cluster when:
1. They came from the same session (same sessionId) — this is the strongest signal, start here
2. They share overlapping candidate nodes (same node appears in multiple items)
3. Their content is about the same topic and would land in the same area of the tree
4. They have similar deferReasons

Each cluster should be placeable as a unit — all items in a cluster go to the same area.
Single-item clusters are fine when an item is unrelated to others.

NODE TYPES
When suggesting structure, consider what type the placement target should be:
goal, plan, task, knowledge, resource, identity. This helps the placement engine
assign types when creating new nodes.

OUTPUT FORMAT (STRICT JSON ONLY)
{
  "clusters": [
    {
      "clusterId": number,
      "itemIds": [string],
      "sharedTheme": string,
      "candidateHints": [string],
      "needsNewStructure": boolean,
      "suggestedType": "goal|plan|task|knowledge|resource|identity|null"
    }
  ]
}

RULES:
- Every item must appear in exactly one cluster
- candidateHints: node names or paths from candidates that should be checked first
- needsNewStructure: true if items likely need new branches/nodes, false if existing nodes suffice
- Do not output anything except the JSON object`.trim();
  },
};
