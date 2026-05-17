// TreeOS IBP — BE verb handler.
//
// Envelope:
//   { id, operation: "register" | "claim" | "release" | "switch",
//     stance: "<stance>" OR land: "<land>",
//     identity?: <token>,
//     payload?: <operation-specific>,
//     from?, to?    // for switch
//   }
//
// BE addresses the land's auth-being. The `land` field is shorthand for
// addressing `<land>/@auth` (the auth-being stance at the land root).
// For `release` and `switch`, the address is the specific held stance.
// The auth-being implementation is in embodiments/auth.js.

import log from "../../seed/log.js";
import { PortalError, PORTAL_ERR, isPortalError } from "../errors.js";
import { extractStanceOrLand, ackOk, ackError } from "../envelope.js";
import { authBeing } from "../embodiments/auth.js";
import { getLandDomain } from "../address.js";
import { authorize, getAuthConfig } from "../authorize.js";

const VALID_OPERATIONS = new Set(["register", "claim", "release", "switch"]);

export async function handleBe(socket, msg, ack) {
  const id = msg?.id || null;
  try {
    const operation = typeof msg?.operation === "string" ? msg.operation : null;
    if (!operation || !VALID_OPERATIONS.has(operation)) {
      throw new PortalError(
        PORTAL_ERR.INVALID_INPUT,
        `portal:be requires \`operation\` to be one of: ${Array.from(VALID_OPERATIONS).join(", ")}`,
      );
    }

    const address = extractStanceOrLand(msg, "portal:be");

    // Verify the address points at THIS land. Pass 1 only.
    const targetLand = extractLandFromAddress(address);
    if (targetLand !== getLandDomain()) {
      throw new PortalError(
        PORTAL_ERR.NODE_NOT_FOUND,
        `Land "${targetLand}" is not served by this server`,
        { targetLand, serverLand: getLandDomain() },
      );
    }

    // Land-level BE config: register_enabled / claim_enabled flags.
    if (operation === "register" || operation === "claim") {
      const authConfig = await getAuthConfig();
      if (operation === "register" && !authConfig.register_enabled) {
        throw new PortalError(
          PORTAL_ERR.FORBIDDEN,
          "Registration is disabled on this land",
          { operation: "register" },
        );
      }
      if (operation === "claim" && !authConfig.claim_enabled) {
        throw new PortalError(
          PORTAL_ERR.FORBIDDEN,
          "Claim is disabled on this land",
          { operation: "claim" },
        );
      }
    }

    // Identity requirements per operation.
    if (operation === "release" || operation === "switch") {
      if (!socket.userId) {
        throw new PortalError(
          PORTAL_ERR.UNAUTHORIZED,
          `BE ${operation} requires an authenticated identity`,
        );
      }
    }

    // Stance Authorization gate. BE register/claim from arrival is the
    // bootstrap exception; the authorize function permits it inherently.
    // For release/switch from an established identity, authorize confirms.
    const identityForAuth = socket.userId
      ? { userId: socket.userId, username: socket.username }
      : null;
    const decision = await authorize({
      identity: identityForAuth,
      verb: "be",
      target: { kind: address.kind, value: address.value },
      operation,
    });
    if (!decision.ok) {
      throw new PortalError(
        PORTAL_ERR.FORBIDDEN,
        `BE denied for stance "${decision.stance}": ${decision.reason}`,
        { stance: decision.stance, operation },
      );
    }

    // Dispatch by operation. register/claim with credentials never need
    // identity; release/switch require it; claim with stance + identity
    // (token re-claim) returns a fresh token from the still-valid one.
    const ctx = {
      socket,
      address,
      identity: socket.userId
        ? { userId: socket.userId, username: socket.username }
        : null,
    };

    let result;
    switch (operation) {
      case "register":
        result = await authBeing.register(msg.payload || {}, ctx);
        break;
      case "claim":
        result = await handleClaim(address, msg.payload || {}, ctx);
        break;
      case "release":
        result = await authBeing.release(msg.payload || {}, ctx);
        break;
      case "switch":
        result = await authBeing.switch(
          { from: msg.from, to: address.kind === "stance" ? address.value : null },
          ctx,
        );
        break;
    }

    return ackOk(ack, id, result);
  } catch (err) {
    if (isPortalError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("Portal", `portal:be failed: ${err.message}`);
    return ackError(ack, id, PORTAL_ERR.INTERNAL, err.message || "Internal portal error");
  }
}

async function handleClaim(address, payload, ctx) {
  // Two claim modes:
  //   - credentials (address is land or <land>/@auth, payload has username+password)
  //   - token re-claim (address is a held stance, identity carries a valid token)
  const isAuthBeingAddress =
    address.kind === "land" ||
    (address.kind === "stance" && /\/@auth$/.test(address.value));

  if (isAuthBeingAddress) {
    return authBeing.claim(payload, ctx);
  }

  // Stance-based re-claim. The session must already hold the stance (carry
  // a still-valid identity token whose user matches the stance).
  if (!ctx.identity) {
    throw new PortalError(
      PORTAL_ERR.UNAUTHORIZED,
      "Token re-claim requires a still-valid identity token",
    );
  }
  const expectedStance = `${getLandDomain()}/@${ctx.identity.username}`;
  if (address.value !== expectedStance) {
    throw new PortalError(
      PORTAL_ERR.FORBIDDEN,
      "Cannot re-claim a stance the session does not hold",
      { held: expectedStance, requested: address.value },
    );
  }
  // Token re-claim is a no-op confirmation in Pass 1; the session already
  // has a valid token. Return the same beingAddress.
  return {
    identityToken: null, // no new token issued; existing one stays valid
    beingAddress: expectedStance,
    note: "already held",
  };
}

function extractLandFromAddress(address) {
  if (address.kind === "land") return address.value;
  // stance: "<land>/<path>@<embodiment>". Split off everything after the
  // first "/" to get the land.
  const slashIndex = address.value.indexOf("/");
  if (slashIndex === -1) return address.value;
  return address.value.slice(0, slashIndex);
}
