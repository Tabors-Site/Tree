// ws/modes/tree/respond.js
// Final response generation. Receives structured context, not raw JSON.
// Used when: query results need narrative, destructive ops need confirmation,
// or the librarian/extension didn't produce a user-friendly response.

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
    nodeContext,
    operationContext,
    conversationMemory,
    confirmNeeded,
    responseHint,
    stepSummaries,
    librarianContext,
  }) {
    const sections = [];

    if (conversationMemory) {
      sections.push(`PRIOR CONVERSATION:\n${conversationMemory}`);
    }

    // Librarian context (query results): this is the primary source for queries
    if (librarianContext) {
      const ctx = typeof librarianContext === "string"
        ? librarianContext
        : (librarianContext.responseHint || librarianContext.summary || "");
      if (ctx) sections.push(`FINDINGS:\n${ctx}`);
    }

    // Destructive/structural flows: compact summaries of what happened
    if (stepSummaries) {
      sections.push(`WHAT HAPPENED:\n${stepSummaries}`);
    }
    if (operationContext) {
      // Cap at 2KB to prevent token waste from raw JSON dumps
      const capped = typeof operationContext === "string" && operationContext.length > 2000
        ? operationContext.slice(0, 2000) + "\n... (truncated)"
        : operationContext;
      sections.push(`DETAILS:\n${capped}`);
    }
    if (nodeContext) {
      const capped = typeof nodeContext === "string" && nodeContext.length > 1000
        ? nodeContext.slice(0, 1000) + "\n... (truncated)"
        : nodeContext;
      sections.push(`NODE:\n${capped}`);
    }

    if (responseHint) {
      sections.push(`GUIDANCE:\n${responseHint}`);
    }

    if (confirmNeeded) {
      sections.push(`CONFIRMATION NEEDED: Present what will happen and ask if the user wants to proceed.`);
    }

    return `You are ${username}'s tree assistant. Respond using only the context below. No tools.

${sections.join("\n\n")}

RULES:
- Be concise. One to three sentences for simple operations.
- For queries: share findings conversationally with specifics from FINDINGS.
- For destructive ops: confirm what changed clearly.
- Match the user's energy. Short input = short response.
- Do not expose node IDs, tool names, JSON, or mode names.
- Do not repeat information already in GUIDANCE.`.trim();
  },
};
