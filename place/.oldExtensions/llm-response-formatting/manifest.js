export default {
  name: "llm-response-formatting",
  version: "1.0.2",
  builtFor: "TreeOS",
  description:
    "Post-processing layer between the LLM and the user. Hooks into two lifecycle events " +
    "(beforeResponse and beforeToolCall) to clean up the messy, inconsistent output that " +
    "language models produce. The goal is that every response reaching the user follows the " +
    "same formatting conventions regardless of which model generated it.\n\n" +
    "The beforeResponse hook runs a three-stage cleaning pipeline on every AI response. First, " +
    "emoji stripping: a comprehensive regex covering emoticons, dingbats, transport symbols, " +
    "flags, supplemental symbols, and variation selectors removes all emoji characters while " +
    "preserving basic punctuation, arrows, math symbols, and currency signs. Second, whitespace " +
    "normalization: runs of three or more consecutive newlines collapse to exactly two, preventing " +
    "the excessive vertical spacing many models produce. Third, filler trimming: a pattern-matched " +
    "removal of trailing pleasantries that LLMs append reflexively. Phrases like 'Let me know if " +
    "you need anything else', 'Feel free to ask', 'Hope this helps', and 'Don't hesitate to " +
    "reach out' are stripped from the end of responses.\n\n" +
    "The beforeToolCall hook fixes tool name mismatches. Some models generate tool calls with " +
    "underscores (navigate_tree) when the registered tool uses hyphens (navigate-tree). The hook " +
    "first checks the exact name against the tool registry. If no match is found, it replaces " +
    "underscores with hyphens and checks again. A successful match silently rewrites the tool " +
    "name before it reaches MCP dispatch, preventing tool-not-found errors that would otherwise " +
    "break the conversation flow. The fast path (exact name match) adds zero overhead to " +
    "correctly-named tool calls.",

  needs: {
    services: ["hooks"],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},

    hooks: {
      fires: [],
      listens: ["beforeResponse", "beforeToolCall"],
    },
  },
};
