// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// storyPeer.js — the file-backed home of the federation peering
// registry. A StoryPeer is the address-book row for one foreign place:
// its domain, baseUrl, storyId, public key (the canopy verifies
// envelopes against it), liveness status, and the small mutable
// bookkeeping (lastSeenAt, uptimeHistory, rateLimits, consecutive-
// Failures). It is NOT a folded reel — it is small mutable metadata
// keyed by domain — so it gets the SAME shape the secondary cross-
// cutting projections (inbox / threads / position) and the History
// registry use: a FileCollection, one JSON doc per row, under the store
// (<storeRoot>/proj/storyPeer/...).
//
// The row's `_id` IS the domain (one doc per peer). `findById(domain)`
// resolves the single row; `findOne({domain})` / `find({})` scan the
// index. peers.js is the curated read/write seam; it builds the full
// default-filled doc on register (filling every field a peer row
// carries) and upserts it here.

import { FileCollection } from "../../../seed/past/projStore.js";

// One instance, shared process-wide. Keyed by domain (each doc's _id ===
// its domain). Stored as JSON under <storeRoot>/proj/storyPeer/.
export const StoryPeer = new FileCollection("storyPeer");

// Build a full peer doc from the supplied fields, filling every default
// a peer row carries (so a freshly registered peer reads back fully
// populated). `domain` becomes the row `_id`.
export function buildPeerDoc({
  domain,
  storyId,
  publicKey,
  baseUrl = null,
  name = "",
  status = "active",
  requireSignedEnvelopes = false,
  protocolVersion = 1,
  seedVersion = null,
  extensions = [],
} = {}) {
  const now = new Date();
  return {
    _id: domain,
    domain,
    baseUrl,
    storyId,
    publicKey,
    protocolVersion,
    seedVersion,
    name,
    lastSeenAt: now,
    status,
    requireSignedEnvelopes,
    consecutiveFailures: 0,
    firstFailureAt: null,
    lastSuccessAt: now,
    uptimeHistory: [],
    rateLimits: {
      requestsPerMinute: 1000,
      requestsPerUserPerMinute: 60,
    },
    extensions,
    registeredAt: now,
  };
}

export default StoryPeer;
