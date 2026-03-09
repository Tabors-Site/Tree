// ws/modes/tree/drainPlan.js
// Takes cluster items + scouted pins, proposes concrete build + place steps.
// Pure reasoning — no tools.

export default {
  name: "tree:drain-plan",
  bigMode: "tree",
  hidden: true,
  toolNames: [],

  buildSystemPrompt({ rootId, cluster, pins }) {
    const itemsList = cluster.items
      .map(
        (item, i) =>
          `[${i}] id=${item._id}\n  content: ${item.content}`,
      )
      .join("\n\n");

    return `You are a tree structure planner. Given deferred items and scouted locations (pins), create a placement plan.

Tree root: ${rootId}

ITEMS TO PLACE
${itemsList}

SCOUTED PINS
${JSON.stringify(pins, null, 2)}

YOUR JOB
Create a placement plan with two phases:
1. BUILD: New nodes/branches to create first (if any)
2. PLACE: Where each item's content becomes a note

OUTPUT FORMAT (STRICT JSON ONLY)
{
  "buildSteps": [
    {
      "parentNodeId": string,
      "structure": { "name": string, "children": [{ "name": string }] },
      "reason": string
    }
  ],
  "placeSteps": [
    {
      "itemId": string,
      "targetNodeId": string | null,
      "targetNewNodeName": string | null,
      "noteContent": string,
      "confidence": number
    }
  ],
  "overallConfidence": number,
  "summary": string
}

RULES:
- buildSteps run first, creating structure. placeSteps run after.
- When a placeStep targets a node from buildSteps, set targetNewNodeName to the name and targetNodeId to null
- noteContent must preserve the user's original words — do not rewrite or formalize
- If overallConfidence < 0.5, the cluster will be re-queued rather than placed
- buildSteps can be empty if existing nodes suffice
- Do not output anything except the JSON object`.trim();
  },
};
