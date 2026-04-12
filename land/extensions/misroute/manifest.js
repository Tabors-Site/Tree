export default {
  name: "misroute",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Detects when a message was routed to the wrong extension and captures the " +
    "evidence. Two signals feed it. First, follow-up corrections from the user " +
    "('no that's fitness', 'i meant food', 'wrong mode'). Second, an explicit " +
    "!misroute tag the user can type on the message right after a bad routing " +
    "decision. On detection, the extension logs the original message, the parse " +
    "tree, the actual route, and the correct route when inferable. It then " +
    "analyzes which words in the original message matched the wrong extension " +
    "and proposes adding the trigger words to the correct extension's vocabulary. " +
    "The operator reviews suggestions via the misroute CLI or the profile page " +
    "and applies them by editing the relevant manifest. This is the feedback " +
    "loop that makes routing self-improving without touching the kernel. " +

    "CURRENT LIMITATION: the extension treats the routing decision as atomic. " +
    "It records the top-level dispatch from localClassify and assumes any " +
    "correction is about that single decision. This is correct for the common " +
    "case (one message, one extension, vocabulary picked the wrong domain) " +
    "which is where about eighty percent of routing failures live. It is " +
    "incorrect for graph-level execution mistakes: a sequence chain where step " +
    "N was wrong but earlier steps were right, a fork where the LLM evaluator " +
    "picked the wrong branch, or a fanout where the resolveSet hook returned " +
    "the wrong items. In all three cases the routing log will attribute the " +
    "failure to the top-level noun and surface a vocabulary suggestion that " +
    "may be misleading. The operator can still see the captured event and " +
    "decide what to do, but the auto-suggestion is naive. " +

    "FUTURE PLAN: add a `kind` field to the routing ring entries so the " +
    "misroute extension can distinguish four failure modes. (1) Per-step " +
    "recording inside runChain so each step in a sequence appends its own " +
    "ring entry with parentMessage, stepIndex, and totalSteps. A correction " +
    "after a chain attributes to the most recent step. (2) Per-branch " +
    "recording inside the fork executor so the evaluator's verdict (true/" +
    "false/unknown, confidence, reasoning) is captured alongside the chosen " +
    "path. A correction after a fork attributes to 'evaluator picked X when " +
    "it should have picked Y' rather than 'wrong domain'. (3) Per-set " +
    "recording inside the fanout executor so resolveSet's returned item IDs " +
    "are captured. A correction targeting 'wrong items' becomes distinguishable " +
    "from 'wrong domain'. (4) Three feedback channels in the UI: vocabulary " +
    "suggestions (current), evaluator feedback (new, surfaces fork " +
    "mispredictions for prompt or model tuning), and set feedback (new, " +
    "surfaces fanout misresolutions for extension resolveSet refinement). " +
    "An alternative or complementary approach: when a correction is detected, " +
    "ask the user a one-shot disambiguation question ('was it the wrong word, " +
    "wrong step, wrong evaluation, or wrong items?') and tag the log entry " +
    "accordingly. Higher friction, much higher attribution accuracy. " +

    "BUILD ORDER when picked up: per-step sequence recording first (cheapest, " +
    "covers the long-chain case), then per-branch fork recording, then " +
    "per-set fanout recording, then the multi-channel UI split.",

  territory: "misroute, routing feedback, correction",

  needs: {
    models: ["User"],
    services: ["hooks", "userMetadata"],
  },

  optional: {
    extensions: ["tree-orchestrator"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,

    hooks: {
      fires: [],
      listens: ["beforeLLMCall"],
    },

    cli: [
      {
        command: "misroute [action]",
        scope: ["land", "tree", "home"],
        description:
          "Review routing mistakes. Actions: list (recent misroutes), " +
          "suggestions (pending vocabulary proposals), clear (wipe log), " +
          "stats (counts by extension pair).",
        method: "GET",
        endpoint: "/misroute",
        subcommands: {
          list: {
            method: "GET",
            endpoint: "/misroute/list",
            description: "Show recent misroutes with their parse trees",
          },
          suggestions: {
            method: "GET",
            endpoint: "/misroute/suggestions",
            description: "Show proposed vocabulary additions from accumulated misroutes",
          },
          clear: {
            method: "DELETE",
            endpoint: "/misroute",
            description: "Wipe the misroute log and suggestions",
          },
          stats: {
            method: "GET",
            endpoint: "/misroute/stats",
            description: "Count of misroutes grouped by wrong -> correct extension pair",
          },
        },
      },
    ],
  },
};
