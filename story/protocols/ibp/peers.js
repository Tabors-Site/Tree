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

import log from "../../seed/seedStory/log.js";
import StoryPeer, { buildPeerDoc } from "./models/storyPeer.js";

/**
 * Reject private/internal addresses (SSRF defense).
 */
function isPrivateHost(hostname) {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|fc|fd|fe80|::1|localhost)/i.test(hostname);
}

/**
 * Register a new peer place. Operator supplies the public key + storyId
 * directly. Automated discovery (fetching the peer's `.well-known/treeos-portal`
 * or `ibp:see <peer>/./identity` and pulling the key) places with the
 * federation wire-protocol slice.
 *
 * @param {object} info
 * @param {string} info.domain      "storyB.com"
 * @param {string} info.publicKey   PEM-encoded Ed25519 public key
 * @param {string} info.storyId      remote place's DID
 * @param {string} [info.baseUrl]   defaults to "https://<domain>"
 * @param {string} [info.name]      friendly name
 * @param {boolean} [info.requireSignedEnvelopes]  strict mode: refuse
 *                                  envelopes from this peer that lack
 *                                  the acting being's own signature
 */
export async function registerPeer({ domain, publicKey, storyId, baseUrl, name, requireSignedEnvelopes }) {
  if (!domain || !publicKey || !storyId) {
    throw new Error("registerPeer requires { domain, publicKey, storyId }");
  }

  let parsed;
  const url = (baseUrl || `https://${domain}`).replace(/\/+$/, "");
  try { parsed = new URL(url); } catch { throw new Error(`Invalid baseUrl: ${url}`); }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error("Cannot register a peer with a private or internal address");
  }

  const existing = await StoryPeer.findById(domain);
  if (existing) {
    // Mutate the loaded doc in place, preserving every other field,
    // then upsert the row by its _id (= domain).
    existing.publicKey = publicKey;
    existing.storyId   = storyId;
    existing.baseUrl   = url;
    existing.name      = name || existing.name;
    existing.status    = "active";
    if (typeof requireSignedEnvelopes === "boolean") {
      existing.requireSignedEnvelopes = requireSignedEnvelopes;
    }
    await StoryPeer.updateOne({ _id: domain }, { $set: existing }, { upsert: true });
    return existing;
  }

  const doc = buildPeerDoc({
    domain,
    storyId,
    publicKey,
    baseUrl: url,
    name: name || "",
    status: "active",
    requireSignedEnvelopes: requireSignedEnvelopes === true,
  });
  await StoryPeer.updateOne({ _id: domain }, { $set: doc }, { upsert: true });
  return doc;
}

export async function removePeer(domain) {
  return StoryPeer.deleteOne({ _id: domain });
}

export async function blockPeer(domain) {
  await StoryPeer.updateOne({ _id: domain }, { $set: { status: "blocked" } });
  return StoryPeer.findById(domain);
}

export async function unblockPeer(domain) {
  await StoryPeer.updateOne({ _id: domain }, { $set: { status: "active" } });
  return StoryPeer.findById(domain);
}

export async function getPeerByDomain(domain) {
  return StoryPeer.findById(domain);
}

export async function getAllPeers() {
  return StoryPeer.find({});
}

/**
 * Base URL for a peer. Defaults to https://<domain> when not stored.
 */
export function getPeerBaseUrl(peer) {
  if (peer?.baseUrl) return peer.baseUrl.replace(/\/+$/, "");
  return `https://${peer?.domain}`;
}
