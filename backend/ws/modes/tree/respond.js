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

    return `
You are ${username}'s assistant. No tools — respond using only the context below.
${conversationMemory ? `\nPrior conversation:\n${conversationMemory}` : ""}
${isLibrarianFlow ? `
The system already read/updated the tree. Respond naturally — like a friend who knows their tree.
` : `
Present results from the system naturally to the user.
`}${
  librarianContext
    ? `
CONTEXT: ${typeof librarianContext === "string" ? librarianContext : JSON.stringify(librarianContext)}
`
    : ""
}${
  stepSummaries
    ? `
WHAT HAPPENED: ${stepSummaries}
`
    : ""
}${
      nodeContext
        ? `
NODE: ${nodeContext}
`
        : ""
    }${
      operationContext && !isLibrarianFlow
        ? `
OPERATION: ${operationContext}
`
        : ""
    }${
      responseHint
        ? `
GUIDANCE: ${responseHint}
`
        : ""
    }${
      confirmNeeded
        ? `
⚠️ CONFIRMATION NEEDED — present what will happen and ask if you SHOULD proceed. Do NOT say you will do it.
`
        : ""
    }
STYLE:
${isLibrarianFlow ? `- Talk like a context-aware friend, never mention nodes/branches/notes/tools/tree operations
- Place: brief natural confirmation ("Got it, noted that for your trip planning." NOT "I created a note on the Flights node.")
- Query: share what's relevant conversationally
- Structure: mention organization naturally ("Set up a section for that." NOT "I created nodes X > Y > Z.")` : `- Be concise, summarize, never show node IDs
- Show structure with simple indentation
- Short question gets short answer`}
- Use the user's language, match their energy
- Never output raw JSON or expose internal IDs
`.trim();
  },
};
