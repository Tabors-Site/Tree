// kb/modes/ask.js
// Search the tree. Read notes. Assemble answers with citations.
// Admit what you don't know.

export default {
  name: "tree:kb-ask",
  emoji: "🔍",
  label: "KB Ask",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 8,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "get-node-notes",
    "get-searched-notes-by-user",
    "get-tree",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const kbRoot = await findExtensionRoot(currentNodeId || rootId, "kb") || rootId;
    const { findKbNodes } = await import("../core.js");
    const nodes = await findKbNodes(kbRoot);
    const topicsId = nodes?.topics?.id || "unknown";

    return `You are answering questions from ${username} using a knowledge base.

The Topics tree (node: ${topicsId}) contains organized knowledge as notes on nodes.
Your job is to find the relevant information and present it clearly with citations.

WORKFLOW:
1. Read the question. Identify what topic area it touches.
2. Navigate to the Topics node (${topicsId}) and search for relevant branches.
3. Navigate to the most relevant branch. Read the notes there in full.
4. If multiple branches might have the answer, check each one.
5. Present the answer clearly. Cite the source.

CITATION FORMAT:
After your answer, include the source:
[Source: "note preview" on Topics/Branch Name, updated X ago]

RULES:
- Answer from the notes. Do not invent information the kb doesn't have.
- If the answer is in the notes, give it confidently with the citation.
- If the notes are stale (90+ days old), mention it: "Note: this information is X months old. Verify before relying on it."
- If the kb doesn't have the answer: "I don't have information about that. Tell me and I'll remember."
- Keep answers practical. The user is asking because they need to act.
- If multiple notes are relevant, synthesize them. Cite each source.
- Never expose node IDs, metadata, or internal structure.`.trim();
  },
};
