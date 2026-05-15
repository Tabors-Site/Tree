// Portal Protocol discovery capabilities.
//
// Returned by:
//   - GET /.well-known/treeos-portal (HTTP bootstrap)
//   - portal:discover (WS op)
//   - The land-zone Position Descriptor MAY embed this under _meta as well.
//
// Discovery is the same shape regardless of transport. The HTTP route exists
// only because a client with no WS connection needs to learn WHERE to open
// the socket; everything else stays in the Portal Protocol.

import { getLandDomain } from "./address.js";
import { getLandConfigValue } from "../seed/landConfig.js";
import { getLandUrl } from "../canopy/identity.js";

const PORTAL_PROTOCOL_VERSION = "1.0";
const DESCRIPTOR_VERSION = "1.0";

// Canonical embodiments declared at the Portal Protocol level. Lands can
// extend with custom embodiments; the discovery only lists the ones every
// Portal-speaking land knows.
const CANONICAL_EMBODIMENTS = [
  "citizen",
  "ruler",
  "planner",
  "contractor",
  "worker",
  "foreman",
  "oracle",
  "dreamer",
  "merchant",
  "guardian",
  "builder",
  "historian",
  "archivist",
  "swarm",
];

const SUPPORTED_ZONES = ["land", "home", "tree"];

export function buildDiscovery() {
  const landUrl = getLandUrl();
  const wsUrl = landUrl.replace(/^http/, "ws"); // http://... → ws://..., https://... → wss://...
  return {
    name: getLandConfigValue("LAND_NAME") || "Unnamed Land",
    land: getLandDomain(),
    portalProtocolVersion: PORTAL_PROTOCOL_VERSION,
    descriptorVersionSupported: [DESCRIPTOR_VERSION],
    ws: wsUrl,
    auth: { method: "bearer" },
    zones: SUPPORTED_ZONES,
    embodiments: CANONICAL_EMBODIMENTS,
    capabilities: ["portal:fetch", "portal:discover"],
    // capabilities that AREN'T live yet but are part of the spec — clients
    // can detect this version and know not to call them. Each landing slice
    // moves an op from this list into capabilities.
    upcoming: [
      "portal:resolve",
      "portal:speak",
      "portal:cancel",
      "portal:subscribe",
      "portal:unsubscribe",
    ],
  };
}

export {
  PORTAL_PROTOCOL_VERSION,
  DESCRIPTOR_VERSION,
  CANONICAL_EMBODIMENTS,
  SUPPORTED_ZONES,
};
