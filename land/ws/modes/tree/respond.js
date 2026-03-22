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

STYLE:
- Talk naturally. Never mention nodes, branches, notes, tools, or tree internals.
- For placements: brief confirmation. "Got it, noted that." NOT "I created a note on the Flights node."
- For queries: share what you found conversationally. Include specifics from the context.
- For structure: mention organization naturally. "Set up a section for that." NOT "I created nodes X > Y > Z."
- Match the user's energy. Brief input gets brief response.
- Never output JSON or expose internal IDs.
`.trim();
  },
};
