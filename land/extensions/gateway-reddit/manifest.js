export default {
  name: "gateway-reddit",
  version: "1.0.0",
  builtFor: "treeos-connect",
  description:
    "Registers the Reddit channel type with the gateway core, enabling trees to publish " +
    "content to subreddits, respond to comments, and monitor discussions across Reddit. " +
    "Output channels submit self-posts to a configured subreddit via the Reddit API's " +
    "/api/submit endpoint. The tree can publish research, summaries, dream outputs, or " +
    "any notification type as a Reddit post." +
    "\n\n" +
    "Input channels operate in two modes depending on configuration. Subreddit monitoring " +
    "polls /r/{subreddit}/new for new posts and routes each post's text through the gateway " +
    "pipeline as an inbound message. Keyword monitoring polls /search with a custom query " +
    "string, catching relevant discussions across all of Reddit regardless of subreddit. " +
    "Both modes use a timestamp watermark to process only new content since the last poll. " +
    "Input-output channels monitor comments in the configured subreddit. When a comment " +
    "arrives, it is processed through the tree orchestrator, and the AI's reply is posted " +
    "back as a threaded comment via /api/comment. The tree becomes an active participant " +
    "in subreddit discussions." +
    "\n\n" +
    "Authentication uses Reddit's OAuth2 password grant for script-type apps. The token " +
    "cache is keyed by client ID and username, with automatic refresh before expiration. " +
    "Credentials can be set globally via environment variables (REDDIT_CLIENT_ID, " +
    "REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD) or overridden per channel " +
    "for multi-account setups. The poll job runs on a 90-second interval, well within " +
    "Reddit's rate limits of 100 authenticated requests per minute. Posts are truncated " +
    "to Reddit's 40,000 character limit for self-posts and 300 characters for titles. " +
    "Comment replies are capped at 10,000 characters. On startup, the extension scans " +
    "for enabled Reddit input channels and begins polling automatically.",

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
