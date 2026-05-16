// Portal Protocol discovery capabilities.
//
// Returned by `see <land>/.discovery` once the WebSocket is open. The HTTP
// bootstrap at /.well-known/treeos-portal returns only the WS URL and
// protocol version, not the full discovery payload.
//
// The Stance Descriptor for the land zone MAY embed a discovery summary
// under _meta for clients that have already opened a land-zone SEE.

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
    supportedVerbs: [],
    // Verbs in the spec but not yet wired on this land. As each verb is
    // built, it moves from `upcomingVerbs` into `supportedVerbs`. Clients
    // can detect what to expect at this protocol version on this land.
    upcomingVerbs: ["see", "do", "talk", "be"],
    capabilities: [],
  };
}

export {
  PORTAL_PROTOCOL_VERSION,
  DESCRIPTOR_VERSION,
  CANONICAL_EMBODIMENTS,
  SUPPORTED_ZONES,
};
