// TreeOS Canopy — peer registry.
//
// Canopy is the cross-place auth scheme: a place signs its outgoing IBP
// envelopes with its Ed25519 key; the receiving place verifies against the
// sender's known public key from this registry. See
// [[project_canopy_folds_into_ibp]].
//
// This file is intentionally slim. Liveness checks, redirect handling,
// and the old `/canopy/info` heartbeat retired with the parallel
// federation protocol. Liveness becomes a periodic `ibp:see <peer>/.identity`
// when the wire-protocol federation slice places.

import log from "../../seed/system/log.js";
import PlacePeer from "./models/placePeer.js";

/**
 * Reject private/internal addresses (SSRF defense).
 */
function isPrivateHost(hostname) {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|fc|fd|fe80|::1|localhost)/i.test(hostname);
}

/**
 * Register a new peer place. Operator supplies the public key + placeId
 * directly. Automated discovery (fetching the peer's `.well-known/treeos-portal`
 * or `ibp:see <peer>/.identity` and pulling the key) places with the
 * federation wire-protocol slice.
 *
 * @param {object} info
 * @param {string} info.domain      "placeB.com"
 * @param {string} info.publicKey   PEM-encoded Ed25519 public key
 * @param {string} info.placeId      remote place's DID
 * @param {string} [info.baseUrl]   defaults to "https://<domain>"
 * @param {string} [info.name]      friendly name
 */
export async function registerPeer({ domain, publicKey, placeId, baseUrl, name }) {
  if (!domain || !publicKey || !placeId) {
    throw new Error("registerPeer requires { domain, publicKey, placeId }");
  }

  let parsed;
  const url = (baseUrl || `https://${domain}`).replace(/\/+$/, "");
  try { parsed = new URL(url); } catch { throw new Error(`Invalid baseUrl: ${url}`); }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error("Cannot register a peer with a private or internal address");
  }

  const existing = await PlacePeer.findOne({ domain });
  if (existing) {
    existing.publicKey = publicKey;
    existing.placeId    = placeId;
    existing.baseUrl   = url;
    existing.name      = name || existing.name;
    existing.status    = "active";
    await existing.save();
    return existing;
  }

  return PlacePeer.create({
    domain,
    placeId,
    publicKey,
    baseUrl: url,
    name: name || "",
    status: "active",
  });
}

export async function removePeer(domain) {
  return PlacePeer.deleteOne({ domain });
}

export async function blockPeer(domain) {
  return PlacePeer.findOneAndUpdate({ domain }, { status: "blocked" }, { new: true });
}

export async function unblockPeer(domain) {
  return PlacePeer.findOneAndUpdate({ domain }, { status: "active" }, { new: true });
}

export async function getPeerByDomain(domain) {
  return PlacePeer.findOne({ domain });
}

export async function getAllPeers() {
  return PlacePeer.find({});
}

/**
 * Base URL for a peer. Defaults to https://<domain> when not stored.
 */
export function getPeerBaseUrl(peer) {
  if (peer?.baseUrl) return peer.baseUrl.replace(/\/+$/, "");
  return `https://${peer?.domain}`;
}
