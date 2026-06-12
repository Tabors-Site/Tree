// TreeOS Canopy — peer registry.
//
// Canopy is the cross-place auth scheme: a place signs its outgoing IBP
// envelopes with its Ed25519 key; the receiving place verifies against the
// sender's known public key from this registry.
//
//
// This file is intentionally slim. Liveness checks, redirect handling,
// and the old `/canopy/info` heartbeat retired with the parallel
// federation protocol. Liveness becomes a periodic `ibp:see <peer>/./identity`
// when the wire-protocol federation slice places.

import log from "../../seed/seedReality/log.js";
import RealityPeer from "./models/realityPeer.js";

/**
 * Reject private/internal addresses (SSRF defense).
 */
function isPrivateHost(hostname) {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|fc|fd|fe80|::1|localhost)/i.test(hostname);
}

/**
 * Register a new peer place. Operator supplies the public key + realityId
 * directly. Automated discovery (fetching the peer's `.well-known/treeos-portal`
 * or `ibp:see <peer>/./identity` and pulling the key) places with the
 * federation wire-protocol slice.
 *
 * @param {object} info
 * @param {string} info.domain      "realityB.com"
 * @param {string} info.publicKey   PEM-encoded Ed25519 public key
 * @param {string} info.realityId      remote place's DID
 * @param {string} [info.baseUrl]   defaults to "https://<domain>"
 * @param {string} [info.name]      friendly name
 */
export async function registerPeer({ domain, publicKey, realityId, baseUrl, name }) {
  if (!domain || !publicKey || !realityId) {
    throw new Error("registerPeer requires { domain, publicKey, realityId }");
  }

  let parsed;
  const url = (baseUrl || `https://${domain}`).replace(/\/+$/, "");
  try { parsed = new URL(url); } catch { throw new Error(`Invalid baseUrl: ${url}`); }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error("Cannot register a peer with a private or internal address");
  }

  const existing = await RealityPeer.findOne({ domain });
  if (existing) {
    existing.publicKey = publicKey;
    existing.realityId    = realityId;
    existing.baseUrl   = url;
    existing.name      = name || existing.name;
    existing.status    = "active";
    await existing.save();
    return existing;
  }

  return RealityPeer.create({
    domain,
    realityId,
    publicKey,
    baseUrl: url,
    name: name || "",
    status: "active",
  });
}

export async function removePeer(domain) {
  return RealityPeer.deleteOne({ domain });
}

export async function blockPeer(domain) {
  return RealityPeer.findOneAndUpdate({ domain }, { status: "blocked" }, { new: true });
}

export async function unblockPeer(domain) {
  return RealityPeer.findOneAndUpdate({ domain }, { status: "active" }, { new: true });
}

export async function getPeerByDomain(domain) {
  return RealityPeer.findOne({ domain });
}

export async function getAllPeers() {
  return RealityPeer.find({});
}

/**
 * Base URL for a peer. Defaults to https://<domain> when not stored.
 */
export function getPeerBaseUrl(peer) {
  if (peer?.baseUrl) return peer.baseUrl.replace(/\/+$/, "");
  return `https://${peer?.domain}`;
}
