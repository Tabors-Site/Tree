// Aggregation: rolled-up descendant state that flows upward on every
// write. By the time a change reaches the project root, every ancestor
// has the merged counts, deduplicated contracts, and latest activity
// timestamp — no polling, no re-reads.
//
// Delta shape:
//   {
//     filesWrittenDelta: +1,
//     newContracts: ["POST /api/login"],
//     statusDelta: { done: +1 } | null,
//     verifiedEndpoint: { key, status, returnedFields, lastVerifiedAt, probedBy } | null,
//     lastActivity: ISO,
//   }
//
// The verifiedEndpoint slot is a narrow extension point: domain code
// (code-workspace's probe tool) records successful endpoint verifications.
// Swarm stores them as an opaque map keyed by "METHOD path". Other
// domains would use the same slot differently or ignore it.

import Node from "../../../seed/models/node.js";
import { mutateMeta, readMeta } from "./meta.js";

const MAX_CONTRACTS_PER_LEVEL = 50;
const MAX_VERIFIED_ENDPOINTS = 80;

/**
 * Walk from a leaf node upward, merging a delta into every ancestor's
 * aggregatedDetail. Stops at the project root once reached.
 */
export async function rollUpDetail({ fromNodeId, delta, core, stopAtProject = true, stopAtRuler = stopAtProject }) {
  if (!fromNodeId || !delta) return;
  let cursor = String(fromNodeId);
  let guard = 0;
  while (cursor && guard < 64) {
    const n = await Node.findById(cursor).select("_id parent metadata").lean();
    if (!n) return;
    const meta = readMeta(n);
    // Aggregate at branch nodes (swarm-mechanism marker) and at Ruler
    // scopes (governing's role). The legacy "project" role is gone.
    const governingMeta = n.metadata instanceof Map
      ? n.metadata.get("governing")
      : n.metadata?.governing;
    const isRulerScope = governingMeta?.role === "ruler";
    if (meta && (meta.role === "branch" || isRulerScope)) {
      await mutateMeta(n._id, (draft) => {
        if (!draft.aggregatedDetail) {
          draft.aggregatedDetail = {
            filesWritten: 0,
            contracts: [],
            statusCounts: { done: 0, running: 0, pending: 0, failed: 0 },
            lastActivity: null,
          };
        }
        const agg = draft.aggregatedDetail;
        if (delta.filesWrittenDelta) {
          agg.filesWritten = (agg.filesWritten || 0) + delta.filesWrittenDelta;
        }
        if (Array.isArray(delta.newContracts) && delta.newContracts.length) {
          const existing = new Set(agg.contracts || []);
          for (const c of delta.newContracts) existing.add(String(c));
          agg.contracts = Array.from(existing).slice(-MAX_CONTRACTS_PER_LEVEL);
        }
        if (delta.statusDelta) {
          if (!agg.statusCounts) agg.statusCounts = { done: 0, running: 0, pending: 0, failed: 0 };
          for (const [k, v] of Object.entries(delta.statusDelta)) {
            agg.statusCounts[k] = (agg.statusCounts[k] || 0) + v;
          }
        }
        if (delta.verifiedEndpoint) {
          if (!agg.verifiedEndpoints) agg.verifiedEndpoints = {};
          const key = delta.verifiedEndpoint.key;
          const returnedFields = delta.verifiedEndpoint.returnedFields || [];
          // Filter out the static-fallback case: `GET /` with zero
          // returned fields means the preview spawner served an HTML
          // file from disk, not a real JSON handler.
          const isStaticFallback = key === "GET /" && returnedFields.length === 0;
          if (key && !isStaticFallback) {
            agg.verifiedEndpoints[key] = {
              status: delta.verifiedEndpoint.status,
              returnedFields,
              lastVerifiedAt: delta.verifiedEndpoint.lastVerifiedAt,
              probedBy: delta.verifiedEndpoint.probedBy || null,
            };
            const keys = Object.keys(agg.verifiedEndpoints);
            if (keys.length > MAX_VERIFIED_ENDPOINTS) {
              const sorted = keys
                .map((k) => [k, agg.verifiedEndpoints[k].lastVerifiedAt || ""])
                .sort((a, b) => b[1].localeCompare(a[1]))
                .slice(0, MAX_VERIFIED_ENDPOINTS);
              const next = {};
              for (const [k] of sorted) next[k] = agg.verifiedEndpoints[k];
              agg.verifiedEndpoints = next;
            }
          }
        }
        if (delta.lastActivity) agg.lastActivity = delta.lastActivity;
        return draft;
      }, core);

      // Stop at the nearest Ruler scope. Roll-up never crosses Ruler
      // boundaries: each Ruler aggregates its own subtree.
      if (stopAtRuler && isRulerScope) return;
    }
    if (!n.parent) return;
    cursor = String(n.parent);
    guard++;
  }
}

/**
 * Read a node's own aggregatedDetail (not walked — just what's stored
 * on that specific node). Used by enrichContext.
 */
export async function readAggregatedDetail(nodeId) {
  if (!nodeId) return null;
  try {
    const n = await Node.findById(nodeId).select("metadata").lean();
    if (!n) return null;
    const meta = readMeta(n);
    return meta?.aggregatedDetail || null;
  } catch {
    return null;
  }
}
