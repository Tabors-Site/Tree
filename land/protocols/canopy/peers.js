// TreeOS Canopy — peer registry.
//
// Canopy is the cross-land auth scheme: a land signs its outgoing IBP
// envelopes with its Ed25519 key; the receiving land verifies against the
// sender's known public key from this registry. See
// [[project_canopy_folds_into_ibp]].
//
// This file is intentionally slim. Liveness checks, redirect handling,
// and the old `/canopy/info` heartbeat retired with the parallel
// federation protocol. Liveness becomes a periodic `ibp:see <peer>/.identity`
// when the wire-protocol federation slice lands.

import log from "../../../seed/core/log.js";
import LandPeer from "./models/landPeer.js";

/**
 * Reject private/internal addresses (SSRF defense).
 */
function isPrivateHost(hostname) {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|fc|fd|fe80|::1|localhost)/i.test(hostname);
}

/**
 * Register a new peer land. Operator supplies the public key + landId
 * directly. Automated discovery (fetching the peer's `.well-known/treeos-portal`
 * or `ibp:see <peer>/.identity` and pulling the key) lands with the
 * federation wire-protocol slice.
 *
 * @param {object} info
 * @param {string} info.domain      "landB.com"
 * @param {string} info.publicKey   PEM-encoded Ed25519 public key
 * @param {string} info.landId      remote land's DID
 * @param {string} [info.baseUrl]   defaults to "https://<domain>"
 * @param {string} [info.name]      friendly name
 */
export async function registerPeer({ domain, publicKey, landId, baseUrl, name }) {
  if (!domain || !publicKey || !landId) {
    throw new Error("registerPeer requires { domain, publicKey, landId }");
  }

  let parsed;
  const url = (baseUrl || `https://${domain}`).replace(/\/+$/, "");
  try { parsed = new URL(url); } catch { throw new Error(`Invalid baseUrl: ${url}`); }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error("Cannot register a peer with a private or internal address");
  }

  const existing = await LandPeer.findOne({ domain });
  if (existing) {
    existing.publicKey = publicKey;
    existing.landId    = landId;
    existing.baseUrl   = url;
    existing.name      = name || existing.name;
    existing.status    = "active";
    await existing.save();
    return existing;
  }

  return LandPeer.create({
    domain,
    landId,
    publicKey,
    baseUrl: url,
    name: name || "",
    status: "active",
  });
}

export async function removePeer(domain) {
  return LandPeer.deleteOne({ domain });
}

export async function blockPeer(domain) {
  return LandPeer.findOneAndUpdate({ domain }, { status: "blocked" }, { new: true });
}

export async function unblockPeer(domain) {
  return LandPeer.findOneAndUpdate({ domain }, { status: "active" }, { new: true });
}

export async function getPeerByDomain(domain) {
  return LandPeer.findOne({ domain });
}

export async function getAllPeers() {
  return LandPeer.find({});
}

/**
 * Base URL for a peer. Defaults to https://<domain> when not stored.
 */
export function getPeerBaseUrl(peer) {
  if (peer?.baseUrl) return peer.baseUrl.replace(/\/+$/, "");
  return `https://${peer?.domain}`;
}
