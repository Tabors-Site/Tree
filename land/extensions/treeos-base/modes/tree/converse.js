// extensions/treeos-base/modes/tree/converse.js
// Default conversational mode for free-form nodes.
// When no extension claims this position, the AI reads what's here and talks about it.
// Position determines reality. Every node has a voice.

import { getContextForAi } from "../../../../seed/tree/treeFetch.js";

export default {
  name: "tree:converse",
  emoji: "\uD83D\uDCAC",
  label: "Converse",
  bigMode: "tree",

  maxMessagesBeforeLoop: 20,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "get-node-notes",
    "create-node-note",
    "create-new-node-branch",
    "edit-node-name",
    "edit-node-type",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId, conversationMemory }) {
    const nodeId = currentNodeId || rootId;

    // Read everything at this position before speaking
    let context = null;
    if (nodeId) {
      try {
        context = await getContextForAi(nodeId, {
          includeNotes: true,
          includeChildren: true,
          includeSiblings: false,
          includeParentChain: true,
          userId: null,
        });
      } catch {}
    }

    const ctx = context || {};
    const name = ctx.name || "this node";
    const isRoot = ctx.isRoot || (nodeId === rootId);

    // Build what we know about this position
    const sections = [];

    if (ctx.notes?.length) {
      const noteText = ctx.notes
        .slice(0, 15)
        .map(n => n.content || "")
        .filter(c => c.length > 0)
        .join("\n---\n");
      if (noteText) sections.push(`NOTES HERE:\n${noteText}`);
    }

    if (ctx.children?.length) {
      const childList = ctx.children.map(c => {
        const parts = [c.name];
        if (c.type) parts.push(`(${c.type})`);
        if (c.status && c.status !== "active") parts.push(`[${c.status}]`);
        return parts.join(" ");
      }).join(", ");
      sections.push(`CHILDREN: ${childList}`);
    }

    if (ctx.parentChain?.length) {
      const path = ctx.parentChain.map(p => p.name).join(" / ");
      sections.push(`PATH: ${path}`);
    }

    if (ctx.type) sections.push(`TYPE: ${ctx.type}`);
    if (ctx.status && ctx.status !== "active") sections.push(`STATUS: ${ctx.status}`);

    if (conversationMemory) {
      sections.push(`RECENT CONVERSATION:\n${conversationMemory}`);
    }

    const contextBlock = sections.length > 0
      ? sections.join("\n\n")
      : "This node is empty. No notes, no children. A blank page.";

    return `You are the voice of "${name}" in ${username}'s tree.

${contextBlock}

You have read everything here. You know this place.

WHAT YOU DO:
- Talk from this position's perspective. Reflect what's here.
- If notes exist, you understand them. Reference specifics, not summaries.
- If children exist, you know the structure. Mention what's growing.
- Help the user think about what's at this position.
- Add notes when the user shares thoughts. Create children when ideas need structure.
- If this is empty, invite the user to tell you what this place is for.

HOW YOU SPEAK:
- You are not a librarian. You are not a router. You live here.
- Be conversational and direct. No bullet point lists of options.
- Match the user's energy. Short input, short response.
- Reference specific content from the notes above, not generic summaries.
- Never say "I'm your assistant" or "How can I help you today."
- Never ask "What would you like to do?" when the answer is in the notes.

${isRoot ? `This is the tree root. You see the whole structure. Talk about what the tree contains and what the user has been building.` : `This is a branch. You see what's above you (path) and what's below you (children). You are one perspective in a larger tree.`}`.trim();
  },
};
