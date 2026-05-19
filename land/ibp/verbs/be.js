// TreeOS IBP — BE verb handler.
//
// Consumes the unified envelope per [[project_ibp_wire_shape]]:
//
//   { id, verb: "be", address (stance or land), payload, identity? }
//
// `payload.op` is one of "register" | "claim" | "release" | "switch".
// Remaining payload fields carry operation-specific credentials/state:
//
//   register  { op, username, password, ... }
//   claim     { op, username, password }                (from land/auth-being address)
//   claim     { op }                                    (re-claim a held stance)
//   release   { op }
//   switch    { op, from }                              (address is the target stance)
//
// BE addresses the land's auth-being. A bare-land address (e.g.
// "treeos.ai") is shorthand for the auth-being stance "treeos.ai/@auth".
// For release/switch/token-reclaim the address is the held stance.

import log from "../../seed/log.js";
import { PortalError, PORTAL_ERR, isPortalError } from "../errors.js";
import { ackOk, ackError } from "../envelope.js";
import { authBeing } from "../roles/auth.js";
import { getLandDomain } from "../address.js";
import { authorize, getAuthConfig } from "../authorize.js";

const VALID_OPERATIONS = new Set(["register", "claim", "release", "switch"]);

export async function handleBe(socket, env, ack) {
  const id = env?.id || null;
  try {
    const { address, addressKind, payload } = env;
    const operation = payload?.op || payload?.operation;
    if (typeof operation !== "string" || !VALID_OPERATIONS.has(operation)) {
      throw new PortalError(
        PORTAL_ERR.INVALID_INPUT,
        `ibp BE payload must include \`op\` (one of: ${[...VALID_OPERATIONS].join(", ")})`,
      );
    }

    // Verify the address points at THIS land.
    const targetLand = extractLandFromAddress(address, addressKind);
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
        throw new PortalError(PORTAL_ERR.FORBIDDEN, "Registration is disabled on this land", { operation: "register" });
      }
      if (operation === "claim" && !authConfig.claim_enabled) {
        throw new PortalError(PORTAL_ERR.FORBIDDEN, "Claim is disabled on this land", { operation: "claim" });
      }
    }

    // Identity requirements per operation.
    if (operation === "release" || operation === "switch") {
      if (!socket.beingId) {
        throw new PortalError(
          PORTAL_ERR.UNAUTHORIZED,
          `BE ${operation} requires an authenticated identity`,
        );
      }
    }

    // Stance Authorization gate. BE register/claim from arrival is the
    // bootstrap exception; the authorize function permits it inherently.
    const identityForAuth = socket.beingId
      ? { beingId: socket.beingId, username: socket.username }
      : null;
    const decision = await authorize({
      identity: identityForAuth,
      verb: "be",
      target: { kind: addressKind, value: address },
      operation,
    });
    if (!decision.ok) {
      throw new PortalError(
        PORTAL_ERR.FORBIDDEN,
        `BE denied for stance "${decision.stance}": ${decision.reason}`,
        { stance: decision.stance, operation },
      );
    }

    // Strip op/operation from payload before handing it to auth-being.
    // What remains is the operation-specific data (credentials, state).
    const { op: _op, operation: _operation, identity: _identityField, ...opPayload } = payload;

    const ctx = {
      socket,
      address: { kind: addressKind, value: address },
      identity: identityForAuth,
    };

    let result;
    switch (operation) {
      case "register":
        result = await authBeing.register(opPayload, ctx);
        break;
      case "claim":
        result = await handleClaim({ kind: addressKind, value: address }, opPayload, ctx);
        break;
      case "release":
        result = await authBeing.release(opPayload, ctx);
        break;
      case "switch": {
        // `from` (current stance) lives in payload; `to` is the address.
        const from = opPayload.from || env.payload?.from;
        const to = addressKind === "stance" ? address : null;
        result = await authBeing.switch({ from, to }, ctx);
        break;
      }
    }

    return ackOk(ack, id, result);
  } catch (err) {
    if (isPortalError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `ibp BE failed: ${err.message}`);
    return ackError(ack, id, PORTAL_ERR.INTERNAL, err.message || "Internal portal error");
  }
}

async function handleClaim(address, opPayload, ctx) {
  // Two claim modes:
  //   - credentials (address is land or <land>/@auth, payload has username+password)
  //   - token re-claim (address is a held stance, identity carries a valid token)
  const isAuthBeingAddress =
    address.kind === "land" ||
    (address.kind === "stance" && /\/@auth$/.test(address.value));

  if (isAuthBeingAddress) {
    return authBeing.claim(opPayload, ctx);
  }

  // Stance-based re-claim. The session must already hold the stance.
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
  return {
    identityToken: null, // no new token issued; existing one stays valid
    beingAddress: expectedStance,
    note: "already held",
  };
}

function extractLandFromAddress(address, addressKind) {
  if (addressKind === "land") return address;
  // stance: "<land>/<path>@<being>". Split off everything after the first "/".
  const slashIndex = address.indexOf("/");
  if (slashIndex === -1) return address;
  return address.slice(0, slashIndex);
}
