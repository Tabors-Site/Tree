export default {
  name: "api-keys",
  version: "1.0.2",
  builtFor: "TreeOS",
  description:
    "Every interaction with TreeOS normally goes through a browser session or a WebSocket " +
    "connection authenticated by JWT. That works for humans sitting at a keyboard. It does not " +
    "work for scripts, CI pipelines, external services, or any programmatic client that needs " +
    "to hit the tree API without logging in through a browser. API keys solve this. " +
    "\n\n" +
    "Each user can create up to ten named API keys. A key is a 256-bit random token hashed " +
    "with bcrypt before storage. The raw key is shown exactly once at creation time. After " +
    "that, only the hash and an eight-character prefix exist in the database. Keys live in " +
    "user metadata under the apiKeys namespace. No separate model. No extra collection. " +
    "\n\n" +
    "Authentication works by registering a custom auth strategy with the kernel's auth system. " +
    "Any request with an X-Api-Key header or an Authorization: ApiKey header is intercepted " +
    "before the normal JWT check. The prefix narrows the candidate set to avoid comparing " +
    "every key in the database. Each candidate hash is compared with bcrypt. On match, the " +
    "request proceeds as that user. Usage count and last-used timestamp update on every " +
    "successful authentication. " +
    "\n\n" +
    "Brute force protection is built in. Failed attempts are tracked per client IP with a " +
    "sliding five-minute window. After ten failures, the IP is locked out until the window " +
    "expires. The tracking map is pruned on a ten-minute interval to prevent memory growth. " +
    "\n\n" +
    "Keys can be revoked individually or in bulk. Revoking sets a flag rather than deleting " +
    "the record, so the audit trail of which keys existed and when they were used is preserved. " +
    "If html-rendering is installed, the extension serves a full management UI for creating, " +
    "listing, and revoking keys directly in the browser.",

  needs: {
    services: ["auth"],
    models: ["User"],
  },

  optional: {
    extensions: ["html-rendering", "treeos-base"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    authStrategies: true,
  },
};
