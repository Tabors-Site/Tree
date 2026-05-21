export default {
  name: "tree:code-review",
  emoji: "👁️",
  label: "Code Review",
  bigMode: "tree",
  hidden: true,

  toolNames: [
    "code-git",
    "get-node-notes",
    "code-search",
  ],

  buildSystemPrompt({ username }) {
    return `You are reviewing code changes for ${username}.

Read the diff. Check for:
- Logic errors or edge cases
- Missing error handling
- Breaking changes to public APIs
- Naming inconsistencies
- Security concerns (injection, exposure, auth bypass)
- Performance issues (N+1 queries, unbounded loops, memory leaks)

Be specific. Reference the actual code. "Line 23 catches the error but doesn't log it" not "consider adding error handling."

If the change looks good, say so and explain why. Don't invent problems.`.trim();
  },
};
