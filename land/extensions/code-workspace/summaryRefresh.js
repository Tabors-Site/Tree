// Child summary refresh — the representation a parent has of its
// subtree. Summaries live on each branch node's swarm metadata
// (`metadata.swarm.summary`) and capture:
//
//   - surface: one-line string describing exported types/routes/etc.
//     (from branchSummary in ./fileSurface.js)
//   - contracts: declared agreements at this branch + descendants
//   - workUnits: [{ filePath, bytes }, ...] — what files exist
//   - unresolvedSignals: count of pending inbox entries
//   - status: from the governing plan's branch step (pending/running/
//     done/failed)
//   - outcome: "clean" | "in-progress" | "failed" | "court-triggered"
//     | "escalated" — high-level result kind for Pass 3 reputation
//   - refreshedAt: ISO timestamp
//
// Summaries refresh on THREE material-change triggers:
//   1. Branch completion (swarm:afterBranchComplete hook)
//   2. File writes within the branch subtree (afterNote hook)
//   3. Signal appends and contract changes on the branch node itself
//      (afterMetadataWrite hook, namespace === "swarm")
//
// The refresh is cheap: walks only the branch's subtree (not the
// whole project) and writes one Node update.

import { branchSummary } from "./fileSurface.js";

/**
 * Refresh a branch node's childSummary. Idempotent — callers can fire
 * this on any material-change event without worrying about duplicate
 * work; the summary is replaced wholesale each time.
 *
 *   refreshChildSummary({
 *     branchNode,      // lean or mongoose doc; needs _id and name
 *     planStep,        // optional — the governing plan's step for
 *                      //   this branch, lets us stamp status/outcome
 *     reason,          // diagnostic label (e.g. "afterNote",
 *                      //   "afterBranchComplete") — logged only
 *     core,            // passed through for metadata writes
 *   })
 *
 * Returns the written summary object, or null on error / missing input.
 */
// Debounce window: refreshes within this many ms of the last one are
// suppressed. Two purposes: (1) prevent the afterMetadataWrite hook
// from recursing when setSummary itself fires the hook; (2) throttle
// bursts of material changes (a five-file write batch triggers one
// refresh, not five). 500ms is short enough that the summary stays
// fresh and long enough to coalesce rapid writes.
const REFRESH_MUTE_MS = 500;

export async function refreshChildSummary({ branchNode, planStep = null, reason = "material-change", core = null }) {
  if (!branchNode?._id) return null;
  try {
    // Debounce: read the existing summary; if it was written within
    // REFRESH_MUTE_MS, skip this refresh. Handles both the hook-
    // recursion case (setSummary → afterMetadataWrite → refresh) and
    // the rapid-burst case.
    const { default: NodeModel } = await import("../../seed/models/node.js");
    const preNode = await NodeModel.findById(branchNode._id).select("metadata").lean();
    const preMeta = preNode?.metadata instanceof Map
      ? preNode.metadata.get("swarm")
      : preNode?.metadata?.swarm;
    const lastRefreshedAt = preMeta?.summary?.refreshedAt;
    if (lastRefreshedAt) {
      const age = Date.now() - new Date(lastRefreshedAt).getTime();
      if (age >= 0 && age < REFRESH_MUTE_MS) return null;
    }

    // Walk files under THIS branch only. Cheaper than walking the
    // whole project on every material change.
    const { walkProjectFiles } = await import("./workspace.js");
    const files = await walkProjectFiles(branchNode._id);
    const workUnits = (files || []).map((f) => ({
      filePath: f.filePath,
      bytes: typeof f.content === "string" ? f.content.length : 0,
    }));

    // Surface string (one-line description of exported types/routes).
    const surface = branchSummary(branchNode.name || "branch", files) || null;

    // Reuse preNode's metadata for the inbox.
    const { getExtension } = await import("../loader.js");
    const sw = getExtension("swarm")?.exports;
    const inbox = Array.isArray(preMeta?.inbox) ? preMeta.inbox : [];
    const unresolvedSignals = inbox.length;

    // Scoped contracts visible to this branch — walk the plan chain
    // via readScopedContracts. The summary captures the BRANCH's
    // scoped slice (not all contracts in the project) so Pass 2's
    // courts can read what THIS branch was bound by.
    let scopedContracts = [];
    try {
      if (sw?.readScopedContracts) {
        scopedContracts = await sw.readScopedContracts({
          nodeId: branchNode._id,
          branchName: branchNode.name,
        });
      }
    } catch {}

    // Consumption tracking: which scoped identifiers did the branch
    // actually reference in its files, and did it use any identifier
    // that wasn't in its scoped contracts? This is the "drift" signal
    // — Pass 2 courts will read out-of-scope usage as case evidence.
    const consumption = computeContractConsumption({
      scopedContracts,
      files,
    });

    // Status + outcome derived from the plan step (if caller supplied).
    // outcome maps plan-step status to the Pass 3 reputation kinds.
    // court-triggered specifically means a contract-class signal is
    // unresolved (not just any noisy signal kind), so the outcome
    // accurately predicts what Pass 2's courts will need to handle.
    const status = planStep?.status || preMeta?.status || "pending";
    const contractSignalCount = inbox.filter((s) =>
      s?.kind === "contract-mismatch" ||
      s?.kind === "coherence-gap" ||
      s?.kind === "undeclared-identifier"
    ).length;
    const outcome = deriveOutcome(status, unresolvedSignals, contractSignalCount, planStep);

    const summary = {
      surface,
      // Scoped contract count. Full contract data lives on the plan
      // node (metadata.plan.contracts) — Pass 2 readers fetch it
      // there. Storing the full entries here would nest the swarm
      // namespace past the kernel's max depth (scope objects + shared
      // arrays = depth 6 inside swarm.summary.contracts[].scope.shared).
      // The flat ID list is captured on consumption.scoped below.
      contractCount: scopedContracts.length,
      // Consumption: what the branch actually did with its scoped
      // contracts. `scoped` = flat list of contract IDs the branch was
      // bound by. `referenced` = subset whose canonical values appear
      // in the branch's files. `outOfScope` = identifier-like strings
      // used but not declared in any scoped contract — drift signals
      // for Pass 2 case-filing. All three are flat (strings or shallow
      // {kind,value,file} objects), keeping summary depth ≤ 4.
      consumption,
      workUnits,
      unresolvedSignals,
      status,
      outcome,
      refreshedAt: new Date().toISOString(),
      refreshReason: reason,
    };

    // Write via swarm's setter so namespace ownership is respected
    // and afterMetadataWrite fires for downstream consumers.
    if (sw?.setSummary) {
      await sw.setSummary({ nodeId: branchNode._id, summary, core });
    } else {
      // Fallback: direct namespace write (should not happen if swarm
      // is loaded, but keeps the refresh idempotent in degraded envs).
      await NodeModel.updateOne(
        { _id: branchNode._id },
        { $set: { "metadata.swarm.summary": summary } },
      );
    }

    return summary;
  } catch {
    // Never let summary-refresh failures cascade. A stale summary is
    // worse than a skipped refresh, but crashing the hook that
    // triggered this is worse still.
    return null;
  }
}

/**
 * Compute contract consumption for a branch's files. Three buckets:
 *
 *   scoped:     contract IDs the branch was bound by (input list)
 *   referenced: subset of scoped where the branch's files contain the
 *               canonical value (string match — cheap, approximate)
 *   outOfScope: identifier-like strings used in the branch's files
 *               that match common shared-vocabulary patterns
 *               (localStorage keys, DOM IDs, custom events) but
 *               aren't declared in scopedContracts. Pass 2 case
 *               evidence. Bounded list (most-recent first, capped).
 *
 * The detection is regex-based and intentionally cheap. False
 * positives are acceptable (a Pass 2 court can adjudicate); false
 * negatives are also acceptable (Pass 3 will refine with AST-based
 * scanning if needed).
 */
function computeContractConsumption({ scopedContracts = [], files = [] } = {}) {
  const scoped = scopedContracts.map((c) => c.id || `${c.namespace || c.kind || "contract"}:${c.name || ""}`);
  const referenced = new Set();
  const outOfScope = [];
  const seenOutOfScope = new Set();
  const MAX_OUT_OF_SCOPE = 20;

  // Build a lookup of contract canonical values keyed by string.
  // For storage-key / dom-id / event-name / module-export, the
  // canonical value IS the string the code will reference. For
  // identifier-set, the canonical values is an array of strings.
  const declaredStrings = new Map(); // canonicalString → contractId
  for (const c of scopedContracts) {
    const id = c.id || `${c.namespace || c.kind || "contract"}:${c.name || ""}`;
    const ns = c.namespace || c.kind;
    const v = c.values || {};
    if (ns === "identifier-set" && v.values) {
      const arr = Array.isArray(v.values) ? v.values
        : String(v.values).replace(/^\[|\]$/g, "").split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
      for (const item of arr) {
        if (item) declaredStrings.set(String(item), id);
      }
    } else if (v.value) {
      declaredStrings.set(String(v.value).replace(/^['"]|['"]$/g, ""), id);
    } else if (c.name) {
      // Many contracts use `name` as the canonical reference (e.g. the
      // event name itself, the storage key itself). Index by name.
      declaredStrings.set(String(c.name), id);
    }
  }

  // Patterns for shared identifiers in code:
  //   localStorage.getItem("KEY") / setItem("KEY", ...)
  //   document.getElementById("ID") / querySelector("#ID")
  //   addEventListener("EVENT_NAME", ...) / dispatchEvent(new CustomEvent("EVENT_NAME"))
  //   window.NAME = / global module exports
  const STORAGE_KEY_RE = /localStorage\.(?:getItem|setItem|removeItem)\s*\(\s*["']([^"']+)["']/g;
  const DOM_ID_RE = /(?:document\.getElementById\s*\(\s*["']([^"']+)["']|querySelector\s*\(\s*["']#([^"'\s.>]+)["'])/g;
  const EVENT_NAME_RE = /(?:addEventListener|dispatchEvent\s*\(\s*new\s+CustomEvent)\s*\(\s*["']([^"']+)["']/g;
  const WINDOW_EXPORT_RE = /window\.([A-Za-z_$][\w$]*)\s*=/g;

  const recordCandidate = (kind, value, file) => {
    if (!value) return;
    if (declaredStrings.has(value)) {
      referenced.add(declaredStrings.get(value));
      return;
    }
    const key = `${kind}:${value}`;
    if (seenOutOfScope.has(key)) return;
    if (outOfScope.length >= MAX_OUT_OF_SCOPE) return;
    seenOutOfScope.add(key);
    outOfScope.push({ kind, value, file: file || null });
  };

  for (const f of files) {
    const filePath = f?.filePath || null;
    const content = typeof f?.content === "string" ? f.content : "";
    if (!content) continue;

    let m;
    STORAGE_KEY_RE.lastIndex = 0;
    while ((m = STORAGE_KEY_RE.exec(content)) !== null) {
      recordCandidate("storage-key", m[1], filePath);
    }
    DOM_ID_RE.lastIndex = 0;
    while ((m = DOM_ID_RE.exec(content)) !== null) {
      recordCandidate("dom-id", m[1] || m[2], filePath);
    }
    EVENT_NAME_RE.lastIndex = 0;
    while ((m = EVENT_NAME_RE.exec(content)) !== null) {
      recordCandidate("event-name", m[1], filePath);
    }
    WINDOW_EXPORT_RE.lastIndex = 0;
    while ((m = WINDOW_EXPORT_RE.exec(content)) !== null) {
      recordCandidate("module-export", m[1], filePath);
    }
  }

  return {
    scoped,
    referenced: [...referenced],
    outOfScope,
  };
}

function deriveOutcome(status, unresolvedSignals, contractSignalCount, planStep) {
  if (status === "failed") return "failed";
  if (status === "done") {
    // court-triggered specifically means a CONTRACT-class signal is
    // unresolved at completion. Generic signals (runtime errors,
    // probe failures, syntax errors) get retried within Pass 1's
    // existing loop and don't need Pass 2 court adjudication. Only
    // contract-class signals (mismatch, coherence gap, undeclared
    // identifier) require cross-branch reconciliation that Pass 2
    // courts will own. Filtering this way keeps the Pass 3
    // reputation reasoning honest — court-triggered is rare and
    // specific, not the default for any branch with leftover noise.
    if (contractSignalCount > 0) return "court-triggered";
    if (planStep?.escalatedTo) return "escalated";
    return "clean";
  }
  if (status === "running" || status === "pending" || status === "paused") {
    return "in-progress";
  }
  return "in-progress";
}
