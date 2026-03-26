export default {
  name: "gateway-reddit",
  version: "1.0.0",
  description:
    "Reddit channel type for the gateway. Output posts to a subreddit. " +
    "Input-output responds to comments on the tree's posts. " +
    "Input-only monitors subreddits or keywords. " +
    "The tree publishes research, answers questions, and monitors discussions.",

  needs: {
    extensions: ["gateway"],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: true,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [
      { key: "REDDIT_CLIENT_ID", required: false, description: "Reddit app client ID (from reddit.com/prefs/apps)" },
      { key: "REDDIT_CLIENT_SECRET", required: false, secret: true, description: "Reddit app client secret" },
      { key: "REDDIT_USERNAME", required: false, description: "Reddit bot account username" },
      { key: "REDDIT_PASSWORD", required: false, secret: true, description: "Reddit bot account password" },
    ],
    cli: [],
  },
};
