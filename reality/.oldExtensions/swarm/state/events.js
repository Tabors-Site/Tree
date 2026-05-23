// Swarm events: flat audit log on the project root. One line per
// noteworthy write, debounced so a save-burst collapses to one entry
// with a count field.
//
// Swarm stores events opaquely. Domain extensions decide what goes in
// (summary, kind, filePath, branchId). Debounce collapses same-file +
// same-kind + same-actor events within a 5-second window.

import Node from "../../../seed/models/node.js";
import { mutateMeta, readMeta } from "./meta.js";

const MAX_EVENTS = 30;
const DEBOUNCE_MS = 5000;

/**
 * Record an event into the project root's flat audit log. Same-file /
 * same-kind / same-actor events inside a 5-second window merge into the
 * tail entry (advances at, increments count). This turns a "save 10
 * times in 8 seconds" spam burst into one entry with count=10. The
 * `summaryTier` comparator lets callers promote a more informative
 * summary over a less-informative one during merge.
 */
export async function recordEvent({ projectNodeId, event, core, summaryTier }) {
  if (!projectNodeId || !event) return;
  return mutateMeta(projectNodeId, (draft) => {
    if (!Array.isArray(draft.events)) draft.events = [];
    const nowIso = event.at || new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const last = draft.events[draft.events.length - 1];

    const sameKey =
      last &&
      last.filePath === event.filePath &&
      last.kind === event.kind &&
      (last.branchId || null) === (event.branchId || null);

    const lastMs = last?.at ? Date.parse(last.at) : 0;
    const withinWindow = sameKey && Number.isFinite(lastMs) && nowMs - lastMs < DEBOUNCE_MS;

    if (withinWindow) {
      last.at = nowIso;
      last.count = (last.count || 1) + 1;
      if (event.summary && typeof summaryTier === "function" &&
          (!last.summary || summaryTier(event.summary) > summaryTier(last.summary))) {
        last.summary = event.summary;
      } else if (event.summary && !last.summary) {
        last.summary = event.summary;
      }
    } else {
      draft.events.push({ ...event, at: nowIso, count: 1 });
      if (draft.events.length > MAX_EVENTS) {
        draft.events.splice(0, draft.events.length - MAX_EVENTS);
      }
    }
    return draft;
  }, core);
}

export async function readEvents(projectNodeId) {
  if (!projectNodeId) return [];
  try {
    const n = await Node.findById(projectNodeId).select("metadata").lean();
    if (!n) return [];
    const meta = readMeta(n);
    return Array.isArray(meta?.events) ? meta.events : [];
  } catch {
    return [];
  }
}
