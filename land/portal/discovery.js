// IBP (Inter-Being Protocol) discovery capabilities.
//
// Returned by `see <land>/.discovery` once the WebSocket is open. The HTTP
// bootstrap at /.well-known/treeos-portal returns only the WS URL and
// IBP version, not the full discovery payload.
//
// The Position Description for the land zone MAY embed a discovery summary
// under _meta for clients that have already opened a land-zone SEE.

import { getLandDomain } from "./address.js";
import { getLandConfigValue } from "../seed/landConfig.js";
import { getLandUrl } from "../canopy/identity.js";

const PORTAL_PROTOCOL_VERSION = "1.0";
const DESCRIPTOR_VERSION = "1.0";

// Canonical embodiments declared at the IBP level. Lands can extend with
// custom embodiments; the discovery only lists the ones every IBP-speaking
// land knows.
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
    supportedVerbs: ["see", "do", "talk", "be"],
    upcomingVerbs: [],
    capabilities: [],
  };
}

export {
  PORTAL_PROTOCOL_VERSION,
  DESCRIPTOR_VERSION,
  CANONICAL_EMBODIMENTS,
  SUPPORTED_ZONES,
};
