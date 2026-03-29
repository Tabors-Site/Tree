import { getLandIdentity } from "./identity.js";

const CURRENT_PROTOCOL_VERSION = 1;

// Minimum protocol version we accept from peers
const MIN_COMPATIBLE_VERSION = 1;

/**
 * Check if a remote land's protocol version is compatible with ours.
 */
export function isCompatibleVersion(remoteVersion) {
  return (
    typeof remoteVersion === "number" &&
    Number.isFinite(remoteVersion) &&
    Number.isInteger(remoteVersion) &&
    remoteVersion >= MIN_COMPATIBLE_VERSION &&
    remoteVersion <= CURRENT_PROTOCOL_VERSION
  );
}

/**
 * Validate an incoming canopy request body.
 * Checks required fields based on the endpoint type.
 */
export function validateCanopyRequest(type, body) {
  const errors = [];

  switch (type) {
    case "invite_offer":
      if (!body.invitingUserId) errors.push("missing invitingUserId");
      if (!body.receivingUsername) errors.push("missing receivingUsername");
      if (!body.rootId) errors.push("missing rootId");
      if (!body.sourceLandDomain) errors.push("missing sourceLandDomain");
      break;

    case "invite_accept":
      if (!body.inviteId) errors.push("missing inviteId");
      if (!body.userId) errors.push("missing userId");
      break;

    case "invite_decline":
      if (!body.inviteId) errors.push("missing inviteId");
      break;

    case "notify":
      if (!body.targetUserId) errors.push("missing targetUserId");
      if (!body.notificationType) errors.push("missing notificationType");
      break;

    case "llm_proxy":
      if (!Array.isArray(body.messages)) errors.push("missing or invalid messages array");
      if (Array.isArray(body.messages) && body.messages.length > 100) errors.push("messages array too large (max 100)");
      if (body.slot && (typeof body.slot !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(body.slot))) errors.push("invalid slot name");
      break;

    default:
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Build standard canopy response headers.
 */
export function canopyResponseHeaders() {
  const identity = getLandIdentity();
  return {
    "X-Canopy-Protocol-Version": String(identity.protocolVersion),
    "X-Canopy-Land-Id": identity.landId,
    "X-Canopy-Domain": identity.domain,
  };
}

export { CURRENT_PROTOCOL_VERSION, MIN_COMPATIBLE_VERSION };
