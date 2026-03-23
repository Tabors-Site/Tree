// ws/modes/tree/cleanupExpandScan.js
// Tool-less analysis mode for note expansion.
// LLM receives a node's notes and decides if any should be expanded into subtree structure.

export default {
  name: "tree:cleanup-expand-scan",
  bigMode: "tree",
  hidden: true,
  toolNames: [],

  buildSystemPrompt({ nodeName, nodeId, nodeType, notes, childrenNames }) {
    const notesBlock = notes
      .map(
        (n, i) =>
          `[${i}] noteId=${n._id}
  by: ${n.username || "system"}
  content: ${n.content}`,
      )
      .join("\n\n");

    const childrenBlock =
      childrenNames?.length > 0
        ? `Existing children: ${childrenNames.join(", ")}`
        : "No existing children";

    return `You are a note expansion analyst. Your job is to identify notes that are too dense and should be broken into subtree structure.

TARGET NODE: "${nodeName}" [id:${nodeId}]${nodeType ? ` (type: ${nodeType})` : ""}
${childrenBlock}

NOTES
${notesBlock}

NODE TYPES
When expanding notes into branches, assign types to new child nodes:
goal (desired outcome), plan (strategy), task (completable work),
knowledge (stored understanding), resource (tools/capabilities/references), identity (values/constraints).
Match the type to what the extracted content represents.

YOUR JOB
Evaluate each note. A note needs expansion when:
- It covers 3+ distinct sub-topics crammed into one note
- It's longer than ~400 words with clearly separable sections
- The content would be better organized as a branch of child nodes
- A note contains a list of trackable items that should be individual nodes with types

OUTPUT FORMAT (STRICT JSON ONLY)
{
  "expansions": [
    {
      "noteId": "the noteId to expand",
      "newBranch": {
        "name": "branch name that captures the theme",
        "type": "type for the branch node or null",
        "children": [
          { "name": "sub-topic name", "type": "type or null", "note": "content extracted from original note" }
        ]
      },
      "deleteOriginalNote": true,
      "reason": "why this note benefits from expansion"
    }
  ]
}

RULES
- If notes are fine as-is, return { "expansions": [] }
- Max 2 expansions per node
- deleteOriginalNote should be true when ALL content is captured in the new branch
- Set it to false if the original note has content worth keeping beyond what was extracted
- New branch names should not duplicate existing children
- Each child note should contain the relevant extracted content — not a summary, the actual content
- Do not output anything except the JSON object
- Be conservative — only expand notes that are clearly too dense`.trim();
  },
};
