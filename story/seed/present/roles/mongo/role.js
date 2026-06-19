// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// mongo — the Mongo connection as a being.
//
// nodeServerTest Phase 1. Homed at ./host/mongo. Stamps the boot
// connection fact (db name, credential-redacted host, pool config)
// and reconnect facts carrying outage gaps (a disconnect cannot
// stamp while Mongo is down, so the reconnect fact records the whole
// gap retroactively). Live state via the mongo-stats SEE op. The
// chain's own write path stays direct — this being is observability,
// not a wrapper around Fact.create (that circularity is exactly what
// the doc warns against).

// NOTE on the name: the role is "mongo-connection" while the BEING
// is named "mongo". The roles mirror manifests every registered role
// as a space named after it under ./roles, and matter/space names
// are unique per kind per branch — a role named "mongo" would
// collide with the ./host/mongo space.
export const mongoRole = Object.freeze({
  name: "mongo-connection",
  description:
    "The Mongo connection as a being. Homed at ./host/mongo; stamps " +
    "boot and reconnect facts on the mongo space's reel; live stats " +
    "via the mongo-stats SEE op.",
  requiredCognition: "scripted",
  permissions: ["see", "do"],
  respondMode: "async",
  triggerOn: ["message"],

  // Its facts are direct emits on its own moments (connect,
  // reconnect are not DO ops); no operator-facing DO surface.
  can: [
    { verb: "see", word: "mongo-stats" },
    { verb: "see", word: "connections" },
    { verb: "see", word: "http-stats" },
  ],
  label: "Mongo Connection",
});
