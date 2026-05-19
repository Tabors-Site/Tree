// Server-side IBP Address parsing.
//
// Re-exports the single-source-of-truth parser from /portal/lib/ibp-address.js
// and adds server-side context injection so handlers don't have to assemble
// the parse context themselves.
//
// The parser itself is shared between Portal client (browser) and Land
// server. Both need to parse the same grammar; both produce the same
// normalized stance shape: { land, path, being }.

import {
  parse as parseRaw,
  format,
  expand,
  canonical,
  validate,
  toHttpRoute,
  isValidLand,
  isValidPath,
  isValidBeing,
} from "../../../portal/lib/ibp-address.js";

import { PortalError, PORTAL_ERR } from "./errors.js";

// Cache the land's bare domain. Derived from process.env.LAND_DOMAIN with a
// localhost fallback (matches canopy/identity.js). Stripped of protocol/port
// because an IBP Address Land is just the domain.
let cachedLandDomain = null;
function getLandDomain() {
  if (cachedLandDomain) return cachedLandDomain;
  const raw = process.env.LAND_DOMAIN || "localhost";
  cachedLandDomain = raw
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/:\d+$/, "");
  return cachedLandDomain;
}

// Parse an IBP Address string using a socket's identity context.
// Throws PortalError on parse failure.
//
// The socket provides:
//   - socket.name → currentUser (for ~ shorthand)
// The land config provides:
//   - currentLand (this server's bare domain)
//
// Returns the normalized IBPA: { left, right } where each side is a Stance
// or null. See /portal/lib/ibp-address.js for shape.
export function parseFromSocket(socket, input, extraCtx = {}) {
  const ctx = {
    currentLand: getLandDomain(),
    currentUser: socket?.name || null,
    ...extraCtx,
  };
  try {
    return parseRaw(input, ctx);
  } catch (e) {
    throw new PortalError(
      PORTAL_ERR.ADDRESS_PARSE_ERROR,
      e.message || "Invalid IBP Address",
      { code: e.code, paInput: e.paInput },
    );
  }
}

// Parse without a socket — used in HTTP bootstrap path and tests. Same shape.
export function parseWithContext(input, ctx = {}) {
  const fullCtx = { currentLand: getLandDomain(), ...ctx };
  try {
    return parseRaw(input, fullCtx);
  } catch (e) {
    throw new PortalError(
      PORTAL_ERR.ADDRESS_PARSE_ERROR,
      e.message || "Invalid IBP Address",
      { code: e.code, paInput: e.paInput },
    );
  }
}

// Re-export the rest of the parser API for convenience.
export {
  format,
  expand,
  canonical,
  validate,
  toHttpRoute,
  isValidLand,
  isValidPath,
  isValidBeing,
  getLandDomain,
};
