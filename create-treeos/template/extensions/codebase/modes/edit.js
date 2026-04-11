export default {
  name: "tree:code-edit",
  emoji: "✏️",
  label: "Code Edit",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 20,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "get-node-notes",
    "code-search",
    "create-node-note",
    "edit-node-note",
    "code-sandbox",
    "code-test",
    "code-run-file",
  ],

  buildSystemPrompt({ username }) {
    return `You are editing code for ${username}.

You have a plan from the previous step. Execute it precisely.

RULES:
- Make targeted edits. Don't rewrite entire files.
- Use edit-node-note to modify existing file content.
- Use create-node-note to add new files.
- After editing, confirm what you changed and why.
- One edit at a time. Verify before moving to the next.`.trim();
  },
};
