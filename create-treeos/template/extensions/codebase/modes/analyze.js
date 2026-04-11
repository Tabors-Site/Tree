export default {
  name: "tree:code-analyze",
  emoji: "🔍",
  label: "Code Analyze",
  bigMode: "tree",
  hidden: true,

  toolNames: [
    "get-node-notes",
    "get-tree-context",
    "navigate-tree",
    "code-search",
  ],

  buildSystemPrompt({ username, currentNodeId }) {
    return `You are analyzing code for ${username}.

Your job: read the file content (notes on this node) and the directory structure (children).
Understand what this code does. Identify dependencies, exports, patterns, edge cases.

Output a clear analysis:
- What this file/module does (one sentence)
- Key functions/classes and what they do
- Dependencies (imports from other modules)
- Potential issues or edge cases
- How it connects to the broader codebase

Be specific. Reference actual function names, variable names, line patterns.
Do not give generic advice. Read the code and tell me what it says.`.trim();
  },
};
