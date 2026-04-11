// extensions/treeos-base/modes/tree/converse.js
// Default conversational mode for free-form nodes.
// When no extension claims this position, the AI reads what's here and talks about it.
// Position determines reality. Every node has a voice.

import { getContextForAi, buildDeepTreeSummary } from "../../../../seed/tree/treeFetch.js";

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

  async buildSystemPrompt({ username, rootId, currentNodeId, conversationMemory, treeCapabilities }) {
    const nodeId = currentNodeId || rootId;
    const isRoot = !currentNodeId || currentNodeId === rootId;

    // Read everything at this position before speaking
    let context = null;
    if (nodeId) {
      try {
        context = await getContextForAi(nodeId, {
          includeNotes: true,
          includeChildren: true,
          includeSiblings: false,
          includeParentChain: !isRoot,
          userId: null,
        });
      } catch {}
    }

    const ctx = context || {};
    const name = ctx.name || "this node";

    // Build what we know about this position
    const sections = [];

    // At root or near-root positions, show the full tree skeleton (4 levels deep).
    // This gives the AI structural awareness of everything in the tree.
    // At deeper positions, show local context (notes, children, path).
    let treeSkeleton = null;
    if (isRoot && rootId) {
      try {
        treeSkeleton = await buildDeepTreeSummary(rootId);
      } catch {}
    }

    if (treeSkeleton) {
      sections.push(treeSkeleton);
    } else {
      // Deeper position: show local context
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
    }

    if (ctx.notes?.length) {
      const noteText = ctx.notes
        .slice(0, 15)
        .map(n => n.content || "")
        .filter(c => c.length > 0)
        .join("\n---\n");
      if (noteText) sections.push(`NOTES HERE:\n${noteText}`);
    }

    if (ctx.type) sections.push(`TYPE: ${ctx.type}`);
    if (ctx.status && ctx.status !== "active") sections.push(`STATUS: ${ctx.status}`);

    if (conversationMemory) {
      sections.push(`RECENT CONVERSATION:\n${conversationMemory}`);
    }

    const contextBlock = sections.length > 0
      ? sections.join("\n\n")
      : "This node is empty. No notes, no children. A blank page.";

    // Tree capabilities from the routing index. Only inject when we DON'T have the full
    // skeleton (deeper positions). At root the skeleton already conveys more info.
    const capabilitiesBlock = (treeCapabilities && !treeSkeleton)
      ? `\nTREE CAPABILITIES (specialized domains in this tree):\n${treeCapabilities}\n\nThese domains handle their own topics automatically. When the user says something that clearly belongs to one of these (food logging, workout tracking, etc.), the system routes there on the next message. You don't need to handle those topics. Your job is everything else: general conversation, cross-domain overviews, and guiding the user toward the right branch when they seem lost.`
      : "";

    return `You are the voice of "${name}" in ${username}'s tree.

${contextBlock}${capabilitiesBlock}

You have read everything here. You know this place.

WHAT YOU DO:
- Talk from this position's perspective. Reflect what's here.
- If notes exist, you understand them. Reference specifics, not summaries.
- If children exist, you know the structure. Mention what's growing.
- Help the user think about what's at this position.
- Add notes when the user shares thoughts. Create children when ideas need structure.
- If this is empty, invite the user to tell you what this place is for.${treeCapabilities ? `
- If the user seems lost, mention what domains are available in this tree.
- If asked "how am I doing" or for an overview, summarize what you know about each domain from the tree structure.` : ""}

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
