export default {
  name: "peer-review",
  version: "1.0.0",
  builtFor: "seed",
  description:
    "Structured AI-to-AI peer review between nodes. Set a review partner on any node. " +
    "When a note is written, the content cascades to the partner. The AI at the partner " +
    "reviews the work and returns structured feedback. If autoApply is true, the source " +
    "AI revises and sends back for re-review. Loop until consensus or maxRounds.",

  needs: {
    services: ["hooks", "llm", "metadata"],
    models: ["Node", "Note"],
    extensions: [],
  },

  optional: {
    extensions: ["propagation", "codebook"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [],

    modes: [
      {
        key: "tree:review",
        handler: "./modes/review.js",
        assignmentSlot: "review",
      },
    ],

    cli: [
      {
        command: "review [action] [args...]", scope: ["tree"],
        description: "Peer review status and control",
        method: "GET",
        endpoint: "/node/:nodeId/review/status",
        subcommands: {
          "set-partner": {
            method: "POST",
            endpoint: "/node/:nodeId/review/partner",
            args: ["partnerId"],
            description: "Set the node that reviews this node's work",
          },
          clear: {
            method: "DELETE",
            endpoint: "/node/:nodeId/review",
            description: "Remove review config from this node",
          },
          history: {
            method: "GET",
            endpoint: "/node/:nodeId/review/history",
            description: "Show review history at this position",
          },
          pause: {
            method: "POST",
            endpoint: "/node/:nodeId/review/pause",
            description: "Pause automatic reviews",
          },
          resume: {
            method: "POST",
            endpoint: "/node/:nodeId/review/resume",
            description: "Resume automatic reviews",
          },
          apply: {
            method: "POST",
            endpoint: "/node/:nodeId/review/apply",
            description: "Apply pending review feedback",
          },
          dismiss: {
            method: "POST",
            endpoint: "/node/:nodeId/review/dismiss",
            description: "Dismiss pending review feedback",
          },
        },
      },
    ],
  },
};
