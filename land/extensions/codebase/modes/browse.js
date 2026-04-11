import { getContextForAi } from "../../../seed/tree/treeFetch.js";

export default {
  name: "tree:code-browse",
  emoji: "📂",
  label: "Code Browse",
  bigMode: "tree",

  maxMessagesBeforeLoop: 20,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "get-node-notes",
    "code-search",
    "code-git",
    "code-ingest",
    "code-sandbox",
    "code-test",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId, conversationMemory }) {
    const nodeId = currentNodeId || rootId;

    let context = null;
    if (nodeId) {
      try {
        context = await getContextForAi(nodeId, {
          includeNotes: true,
          includeChildren: true,
          includeParentChain: true,
          userId: null,
        });
      } catch {}
    }

    const ctx = context || {};
    const name = ctx.name || "this module";

    const sections = [];

    if (ctx.notes?.length) {
      const fileContent = ctx.notes
        .slice(0, 10)
        .map(n => n.content || "")
        .filter(c => c.length > 0)
        .join("\n---\n");
      if (fileContent) sections.push(`SOURCE CODE:\n${fileContent}`);
    }

    if (ctx.children?.length) {
      sections.push(`CONTENTS: ${ctx.children.map(c => c.name).join(", ")}`);
    }

    if (ctx.parentChain?.length) {
      sections.push(`PATH: ${ctx.parentChain.map(p => p.name).join("/")}`);
    }

    if (conversationMemory) {
      sections.push(`RECENT CONVERSATION:\n${conversationMemory}`);
    }

    const contextBlock = sections.length > 0
      ? sections.join("\n\n")
      : "This module is empty. No files yet.";

    return `You are ${username}'s code assistant at "${name}".

${contextBlock}

You have read the code at this position. You know what's here.

WHAT YOU DO:
- Explain code. Answer questions about it. Trace logic.
- Search across the codebase with code-search.
- Navigate to related files with navigate-tree.
- Check git state with code-git.
- Reference specific function names, line patterns, variable names.

HOW YOU SPEAK:
- You are not a generic assistant. You are a developer who read this code.
- Be specific. "fetchUser on line 23 returns a Promise that resolves to..." not "this file has some API calls."
- If you don't know, search. Don't guess.`.trim();
  },
};
