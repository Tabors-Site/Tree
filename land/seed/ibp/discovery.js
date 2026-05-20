// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Land discovery payload.
//
// Returned by `ibp:see <land>/.discovery` once the WebSocket is open.
// Describes what this land speaks: protocol version, descriptor
// version(s) supported, the WS URL clients should use, the role names
// actually registered on this land, and the verb set.
//
// Lives in seed because every field is seed-shaped: land config, the
// live role registry, the verb set. The protocol-version constant is
// the only wire-shape concern in the payload.

import { getLandDomain } from "./address.js";
import { DESCRIPTOR_VERSION } from "./descriptor.js";
import { getLandConfigValue, getLandUrl } from "../landConfig.js";
import { listRoles } from "../roles/registry.js";
import { listSeeds } from "../core/seeds.js";

// The version of the IBP wire protocol this build implements. Bumps
// when the envelope, address grammar, or verb contract changes in a
// way clients must opt into.
export const IBP_PROTOCOL_VERSION = "1.0";

// Code-cognition system beings that live at the land root. Hardcoded
// here because they're addressable via BE without going through the
// role registry (which is shaped around SUMMON-honoring roles). The
// dispatcher in seed/core/verbs.js routes BE calls to these directly.
const SYSTEM_BE_BEINGS = ["auth", "llm-assigner"];

export function buildDiscovery() {
  const landUrl = getLandUrl();
  const wsUrl = landUrl.replace(/^http/, "ws");

  // Merge two sources: the live role registry (SUMMON-honoring roles
  // registered by the kernel + extensions) and the canonical system
  // beings (BE-only — auth, llm-assigner). Dedupe + sort.
  const roles = Array.from(new Set([
    ...listRoles(),
    ...SYSTEM_BE_BEINGS,
  ])).sort();

  return {
    name:                       getLandConfigValue("LAND_NAME") || "Unnamed Land",
    land:                       getLandDomain(),
    protocolVersion:            IBP_PROTOCOL_VERSION,
    descriptorVersionSupported: [DESCRIPTOR_VERSION],
    ws:                         wsUrl,
    auth:                       { method: "bearer" },
    roles,
    // Plantable seed catalog. Operators see what scaffolds are installed
    // on this land and can plant one through a DO `plant-seed` call. Same
    // listing shape as `core.seeds.list()`.
    seeds:                      listSeeds(),
    supportedVerbs:             ["see", "do", "summon", "be"],
    capabilities:               [],
  };
}
