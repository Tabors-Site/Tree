// ws/modes/tree/respond.js
export default {
  name: "tree:respond",
  emoji: "💬",
  label: "Respond",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 2,
  preserveContextOnLoop: false,

  toolNames: [],

  buildSystemPrompt({
    username,
    rootId,
    nodeContext,
    operationContext,
    conversationMemory,
    confirmNeeded,
    responseHint,
    stepSummaries,
    librarianContext,
  }) {
    const isLibrarianFlow = !!librarianContext;

    // Build context sections
    const sections = [];

    if (conversationMemory) {
      sections.push(`PRIOR CONVERSATION:\n${conversationMemory}`);
    }

    if (librarianContext) {
      const ctx = typeof librarianContext === "string"
        ? librarianContext
        : (librarianContext.responseHint || librarianContext.summary || JSON.stringify(librarianContext));
      sections.push(`TREE CONTEXT:\n${ctx}`);
    }

    if (stepSummaries) {
      sections.push(`WHAT HAPPENED:\n${stepSummaries}`);
    }

    if (nodeContext) {
      sections.push(`NODE:\n${nodeContext}`);
    }

    if (operationContext && !isLibrarianFlow) {
      sections.push(`OPERATION:\n${operationContext}`);
    }

    if (responseHint) {
      sections.push(`GUIDANCE:\n${responseHint}`);
    }

    if (confirmNeeded) {
      sections.push(`CONFIRMATION NEEDED: Present what will happen and ask if the user wants to proceed. Do NOT say you will do it.`);
    }

    return `You are ${username}'s tree assistant. Respond using only the context below. No tools.

${sections.join("\n\n")}

CRITICAL RULES:
- Be concise but informative. Confirm what happened without being verbose.
- For placements: brief confirmation of what was placed and where. One or two sentences.
- For queries: share what you found conversationally. Include specifics from the context.
- For structure changes: summarize what was organized. "Set up sections for chest, back, and legs under Workouts."
- For destructive ops: confirm what changed. "Removed the duplicates under Fitness."
- Match the user's energy. Short input = short response. Long input = proportional detail.
- Talk naturally. Do not expose internal details (node IDs, tool names, JSON, mode names).
- Do not repeat the same information the GUIDANCE section already contains. Build on it.
`.trim();
  },
};
