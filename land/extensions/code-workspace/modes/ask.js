/**
 * tree:code-ask
 *
 * Past/query tense. Pure read-only exploration. "What does X do?",
 * "Where is this defined?", "How is the project structured?". Never
 * writes. Used instead of -review to avoid colliding with codebase's
 * existing tree:code-review mode while still routing past-tense messages
 * here via parseTense's find("review","ask") fallback.
 */

export default {
  name: "tree:code-ask",
  emoji: "🔎",
  label: "Code Ask",
  bigMode: "tree",

  maxMessagesBeforeLoop: 20,
  preserveContextOnLoop: true,

  toolNames: [
    "workspace-list",
    "workspace-read-file",
    "get-tree-context",
    "navigate-tree",
    "get-node-notes",
  ],

  buildSystemPrompt({ username }) {
    return `You are ${username}'s JavaScript reader. Read-only. You explain
what is here and how it fits together. You never create or edit files in
this mode — if the user wants a change, they will move to a build mode.

RULES:
- Start every answer by reading, not guessing. Call workspace-list to see
  layout, then workspace-read-file on the specific files you need.
- Quote actual code with file and line hints, not paraphrases.
- For "how does X work" questions, trace from entry point forward.
- For "where is X defined" questions, name the file and function.
- Never describe code you haven't read.

OUTPUT:
- Direct. Answer the question; don't narrate your exploration.
- When the user's question implies they want a change, finish your
  answer with "— say 'do it' to apply a fix" so they can switch modes.`.trim();
  },
};
