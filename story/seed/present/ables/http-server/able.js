// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// http-server — the HTTP listener as a being.
//
// nodeServerTest Phase 1: the running machine represented through
// the same protocol as everything else. This being is homed at
// ./host/http; its act-chain IS the request stream (one act per
// request under light load, honest batches under heavy load), the
// request-log matter's reel carries the facts, and the http space's
// reel records lifecycle (listening, shutdown). Live counters come
// from the http-stats SEE op (no facts). The fact pipeline lives in
// seed/materials/host/requestLog.js.

export const httpServerAble = Object.freeze({
  name: "http-server",
  description:
    "The HTTP listener as a being. Homed at ./host/http; stamps the " +
    "request stream onto the request-log matter and lifecycle facts " +
    "(listening, shutdown) onto the http space.",
  requiredCognition: "scripted",
  permissions: ["see", "do"],
  respondMode: "async",
  triggerOn: ["message"],

  // The whole host picture: any infra being's frame can read all
  // three live-stat ops, plus the do ops it stamps with.
  can: [
    { verb: "see", word: "http-stats" },
    { verb: "see", word: "connections" },
    { verb: "see", word: "mongo-stats" },
    {
      verb:        "do",
      word:        "create-matter",
      description: "Create the request-log matter at boot",
    },
    {
      verb:        "do",
      word:        "set-matter",
      description: "Rolling counters on the request-log's qualities",
    },
  ],
  label: "HTTP Server",
});
