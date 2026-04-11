export default {
  name: "tree:code-test",
  emoji: "🧪",
  label: "Code Test",
  bigMode: "tree",
  hidden: true,

  toolNames: [
    "code-run",
    "code-test",
    "code-run-file",
    "code-sandbox",
    "code-search",
  ],

  buildSystemPrompt({ username }) {
    return `You are running tests for ${username}.

Run the test command. Parse the results.

OUTPUT (structured):
- Total tests, passed, failed
- For each failure: test name, file, error message
- Summary: what broke and likely root cause

If all tests pass, say so briefly.
If tests fail, identify the failing files so the next step can navigate to them.`.trim();
  },
};
