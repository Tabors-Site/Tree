// Lateral signal inbox — per-node queue of messages from siblings,
// validators, or ancestors. Swarm owns the mechanism (append/read/prune).
// Signal payloads are opaque. Domain extensions define their own kinds
// (code-workspace defines SYNTAX_ERROR / CONTRACT_MISMATCH / DEAD_RECEIVER;
// research-workspace would define CITATION_MISSING / CLAIM_UNSUPPORTED).
//
// Each signal has at minimum { kind, at } plus whatever payload the domain
// extension attaches. Capped at MAX_INBOX (newest wins).

import Node from "../../../seed/models/node.js";
import { mutateMeta, readMeta } from "./meta.js";

const MAX_INBOX = 30;

/**
 * Append a signal onto a target node's inbox. Capped at MAX_INBOX
 * (most recent wins). The next session that runs at that node picks it
 * up via enrichContext.
 */
export async function appendSignal({ nodeId, signal, core }) {
  if (!nodeId || !signal) return;
  return mutateMeta(nodeId, (draft) => {
    if (!Array.isArray(draft.inbox)) draft.inbox = [];
    draft.inbox.push({
      at: signal.at || new Date().toISOString(),
      ...signal,
    });
    if (draft.inbox.length > MAX_INBOX) {
      draft.inbox.splice(0, draft.inbox.length - MAX_INBOX);
    }
    return draft;
  }, core);
}

export async function readSignals(nodeId) {
  if (!nodeId) return [];
  try {
    const n = await Node.findById(nodeId).select("metadata").lean();
    if (!n) return [];
    const meta = readMeta(n);
    return Array.isArray(meta?.inbox) ? meta.inbox : [];
  } catch {
    return [];
  }
}

/**
 * Remove every signal whose filePath matches `filePath`. Used when a
 * file is re-written cleanly — all stale errors from the prior version
 * should disappear.
 */
export async function pruneSignalsForFile({ nodeId, filePath, core }) {
  if (!nodeId || !filePath) return;
  return mutateMeta(nodeId, (draft) => {
    if (!Array.isArray(draft.inbox)) return draft;
    draft.inbox = draft.inbox.filter((s) => s.filePath !== filePath);
    return draft;
  }, core);
}

/**
 * Remove every signal of the given kind. Used after a cross-branch pass
 * clears a class of issue (e.g., all contract mismatches after
 * conformance passes cleanly).
 */
export async function pruneSignalsByKind({ nodeId, kind, core }) {
  if (!nodeId || !kind) return;
  return mutateMeta(nodeId, (draft) => {
    if (!Array.isArray(draft.inbox)) return draft;
    draft.inbox = draft.inbox.filter((s) => s.kind !== kind);
    return draft;
  }, core);
}
