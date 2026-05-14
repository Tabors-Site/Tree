// Flag queue — durable accumulator for Worker-surfaced contract
// issues. Pass 1 substrate; Pass 2 courts read this queue when they
// adjudicate.
//
// Workers call governing-flag-issue when they hit ambiguity, missing
// vocabulary, or a discovered need that the parent scope's contracts
// didn't cover. The flag persists on the Ruler's metadata under
// `pendingContractIssues` and stays there until a court adjudicates.
//
// The flag shape is deliberately rich (kind + artifactContext +
// localChoice + blocking + proposedResolution) so Pass 2 courts can
// determine bubbling targets (cross-Ruler flags) and synthesize
// rulings without re-running the original Worker. The artifactContext
// is the key field — it carries the file/function/scope where the
// issue surfaced, which is what courts use to decide where the
// ruling applies.
//
// Content hashing is for snapshot-rendering grouping only — two
// siblings hitting the same vocabulary gap produce structurally
// similar flags, and the hash lets the renderer collapse them into
// "3 flags of this kind" without doing storage-layer dedup. The
// original flags stay distinct in the queue so courts can read each
// individual emission.

import Node from "../../../seed/models/node.js";
import log from "../../../seed/log.js";
import { NS } from "./role.js";

// The five kinds carve at real joints surfaced by the MS Paint test.
// Resist adding a sixth until Pass 2 courts run on real material and
// surface a class the existing five don't cover.
//
//   missing-contract       — vocabulary the parent's contracts didn't
//                            commit but multiple consumers need
//                            (e.g., ToolConfig type that two siblings
//                            ended up redeclaring)
//   contract-ambiguity     — contract names a thing but the
//                            specification leaves an axis open
//                            (e.g., onScore event named but its
//                            transport — DOM CustomEvent vs JS bus —
//                            not pinned)
//   contract-conflict      — two contracted commitments disagree at
//                            the integration surface (rarer; usually
//                            surfaces during Integrate work)
//   discovered-dependency  — Worker needs a sibling-scope artifact
//                            that the contracts didn't expose
//                            (the cross-branch type-import problem)
//   discovered-need        — Worker noticed a vocabulary gap that
//                            wasn't blocking THIS work but would
//                            help future scopes (forward-looking)
export const FLAG_KINDS = [
  "missing-contract",
  "contract-ambiguity",
  "contract-conflict",
  "discovered-dependency",
  "discovered-need",
];

const FLAG_KIND_SET = new Set(FLAG_KINDS);
export function isValidFlagKind(k) {
  return typeof k === "string" && FLAG_KIND_SET.has(k);
}

// Cheap stable hash for grouping. Two flags with identical (kind +
// scope + file + function + localChoice) hash to the same value,
// which is exactly the case where snapshot rendering should collapse
// them. Bigger keys (errors, timestamps) deliberately don't
// participate — they shouldn't break grouping.
function flagContentHash(payload) {
  const key = [
    payload.kind || "",
    payload.artifactContext?.scope || "",
    payload.artifactContext?.file || "",
    payload.artifactContext?.function || "",
    String(payload.localChoice || "").slice(0, 200),
  ].join("|");
  // Synchronous lightweight hash. No crypto import — we don't need
  // collision resistance against adversaries; we need cheap grouping.
  let h = 0n;
  const FNV_PRIME = 1099511628211n;
  const FNV_OFFSET = 14695981039346656037n;
  const MASK = (1n << 64n) - 1n;
  h = FNV_OFFSET;
  for (let i = 0; i < key.length; i++) {
    h = ((h ^ BigInt(key.charCodeAt(i))) * FNV_PRIME) & MASK;
  }
  return h.toString(16).padStart(16, "0");
}

/**
 * Append a flag to the Ruler's pendingContractIssues queue. Returns
 * the persisted flag record (with id, timestamp, contentHash) or
 * null on failure.
 *
 * @param {object} args
 * @param {string} args.rulerNodeId   the scope receiving the flag
 * @param {object} args.payload       the flag content (kind, artifactContext, localChoice, blocking, proposedResolution?)
 * @param {string} [args.userId]      Worker's user id (for audit)
 * @param {string} [args.sourceWorkerScopeId] the node id where the Worker ran
 * @param {string} [args.sourceWorkerType]    "build" | "refine" | "review" | "integrate"
 */
export async function appendFlag({
  rulerNodeId,
  payload,
  userId = null,
  sourceWorkerScopeId = null,
  sourceWorkerType = null,
}) {
  if (!rulerNodeId || !payload) return null;
  if (!isValidFlagKind(payload.kind)) {
    log.warn("Governing/Flags", `appendFlag rejected: invalid kind=${payload.kind}`);
    return null;
  }

  const node = await Node.findById(rulerNodeId);
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? node.metadata.get(NS)
    : node.metadata?.[NS];
  if (meta?.role !== "ruler") {
    log.warn("Governing/Flags",
      `appendFlag: ${String(rulerNodeId).slice(0, 8)} is not a Ruler scope (role=${meta?.role || "(none)"})`);
    return null;
  }

  // UUID-ish id without pulling uuid dep here (callers don't need to
  // care). Time + entropy is sufficient for queue ordering; this is
  // not a primary key in a database.
  const id = `flag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  const flag = {
    id,
    timestamp: new Date().toISOString(),
    kind: payload.kind,
    artifactContext: {
      file: payload.artifactContext?.file || null,
      function: payload.artifactContext?.function || null,
      scope: payload.artifactContext?.scope || null,
    },
    localChoice: String(payload.localChoice || "").slice(0, 2000),
    blocking: !!payload.blocking,
    proposedResolution: payload.proposedResolution
      ? String(payload.proposedResolution).slice(0, 2000)
      : null,
    contentHash: flagContentHash(payload),
    sourceWorker: {
      scopeId: sourceWorkerScopeId ? String(sourceWorkerScopeId) : null,
      workerType: sourceWorkerType || null,
      userId: userId || null,
    },
    status: "unresolved",
  };

  const existingQueue = Array.isArray(meta?.pendingContractIssues)
    ? meta.pendingContractIssues
    : [];
  const queue = [...existingQueue, flag];

  const { setExtMeta } = await import("../../../seed/tree/extensionMetadata.js");
  await setExtMeta(node, NS, {
    ...(meta || {}),
    pendingContractIssues: queue,
  });

  log.info("Governing/Flags",
    `🚩 Flag appended at Ruler ${String(rulerNodeId).slice(0, 8)}: ` +
    `kind=${flag.kind}, blocking=${flag.blocking}, ` +
    `scope=${flag.artifactContext.scope || "?"}, ` +
    `queueSize=${queue.length}`);

  // Fire the lifecycle hook so the governance dashboard's SSE stream
  // (and any future court adjudicator) picks up new flags without
  // polling. Fire-and-forget; subscribers handle their own errors.
  try {
    const { hooks } = await import("../../../seed/hooks.js");
    hooks.run("governing:flagAppended", {
      rulerNodeId: String(rulerNodeId),
      flagId: flag.id,
      kind: flag.kind,
      blocking: flag.blocking,
      sourceWorkerScopeId: flag.sourceWorker?.scopeId || null,
    }).catch(() => {});
  } catch (err) {
    log.debug("Governing/Flags", `governing:flagAppended fire skipped: ${err.message}`);
  }

  return flag;
}

/**
 * Read all pending (unresolved) flags from a Ruler's queue. Returns
 * the full array, ordered by timestamp ascending.
 */
export async function readPendingIssues(rulerNodeId) {
  if (!rulerNodeId) return [];
  const node = await Node.findById(rulerNodeId).select("metadata").lean();
  if (!node) return [];
  const meta = node.metadata instanceof Map
    ? node.metadata.get(NS)
    : node.metadata?.[NS];
  if (meta?.role !== "ruler") return [];
  const queue = Array.isArray(meta?.pendingContractIssues)
    ? meta.pendingContractIssues
    : [];
  return queue.filter((f) => f && f.status !== "resolved");
}

/**
 * Mark a flag resolved (called by Pass 2 court adjudication; Pass 1
 * has no caller for this yet, but the primitive lands here so the
 * mark-resolved code path exists when courts arrive).
 */
export async function markFlagResolved({ rulerNodeId, flagId, resolution }) {
  if (!rulerNodeId || !flagId) return null;
  const node = await Node.findById(rulerNodeId);
  if (!node) return null;
  const meta = node.metadata instanceof Map
    ? node.metadata.get(NS)
    : node.metadata?.[NS];
  if (meta?.role !== "ruler") return null;
  const queue = Array.isArray(meta?.pendingContractIssues)
    ? meta.pendingContractIssues
    : [];
  let mutated = false;
  const next = queue.map((f) => {
    if (f?.id === flagId && f.status !== "resolved") {
      mutated = true;
      return {
        ...f,
        status: "resolved",
        resolvedAt: new Date().toISOString(),
        resolution: resolution
          ? String(resolution).slice(0, 2000)
          : null,
      };
    }
    return f;
  });
  if (!mutated) return null;
  const { setExtMeta } = await import("../../../seed/tree/extensionMetadata.js");
  await setExtMeta(node, NS, {
    ...(meta || {}),
    pendingContractIssues: next,
  });
  return next.find((f) => f?.id === flagId) || null;
}

/**
 * Produce a snapshot-ready summary of the flag queue. Bounded — the
 * verbatim "recent additions" section caps at lastN regardless of
 * total queue size so snapshot growth stays bounded across builds
 * where courts haven't drained the queue.
 *
 * Returns:
 * {
 *   total,
 *   blockingCount,
 *   countsByKind: { "missing-contract": 3, ... },
 *   uniqueHashes,            // distinct content-hash count (groups)
 *   recent: [...]            // last N flags, full payload
 * }
 */
export function summarizeFlags(flags, { lastN = 5 } = {}) {
  const all = Array.isArray(flags) ? flags : [];
  const unresolved = all.filter((f) => f && f.status !== "resolved");
  const countsByKind = {};
  for (const f of unresolved) {
    countsByKind[f.kind] = (countsByKind[f.kind] || 0) + 1;
  }
  const blockingCount = unresolved.filter((f) => f.blocking).length;
  const uniqueHashes = new Set(unresolved.map((f) => f.contentHash)).size;
  // Recent = last N in chronological order. Sort defensively in case
  // queue order ever diverges from append order (it shouldn't, but
  // a future migration or hand-edit could break it).
  const sorted = [...unresolved].sort((a, b) => {
    const ta = a.timestamp || "";
    const tb = b.timestamp || "";
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  const recent = sorted.slice(-lastN);
  return {
    total: unresolved.length,
    blockingCount,
    countsByKind,
    uniqueHashes,
    recent,
  };
}

/**
 * Render a flag summary as a prompt-ready block for the Ruler's
 * snapshot. Returns null when the queue is empty so callers can
 * conditionally include the section.
 */
export function formatFlagSummary(summary) {
  if (!summary || summary.total === 0) return null;
  const lines = [];
  lines.push("## ACCUMULATED FLAGS");
  lines.push("");
  lines.push(
    `${summary.total} unresolved flag${summary.total === 1 ? "" : "s"}` +
    (summary.uniqueHashes < summary.total
      ? ` (${summary.uniqueHashes} distinct group${summary.uniqueHashes === 1 ? "" : "s"} after content-hash collapse)`
      : "") +
    (summary.blockingCount > 0
      ? `, ${summary.blockingCount} blocking`
      : ""),
  );
  lines.push("");
  const kinds = Object.entries(summary.countsByKind)
    .sort((a, b) => b[1] - a[1]);
  if (kinds.length > 0) {
    lines.push("By kind:");
    for (const [kind, count] of kinds) {
      lines.push(`  • ${kind}: ${count}`);
    }
    lines.push("");
  }
  if (summary.recent.length > 0) {
    lines.push(`Recent (last ${summary.recent.length}):`);
    for (const f of summary.recent) {
      const where = f.artifactContext?.scope
        ? `${f.artifactContext.scope}${f.artifactContext.file ? "/" + f.artifactContext.file : ""}`
        : f.artifactContext?.file || "?";
      const blocker = f.blocking ? " [blocking]" : "";
      const wt = f.sourceWorker?.workerType ? ` (${f.sourceWorker.workerType})` : "";
      lines.push(`  • ${f.kind}${blocker} at ${where}${wt}`);
      const choice = String(f.localChoice || "").slice(0, 160);
      if (choice) lines.push(`      local choice: ${choice}`);
      if (f.proposedResolution) {
        lines.push(`      proposed: ${String(f.proposedResolution).slice(0, 160)}`);
      }
    }
    lines.push("");
  }
  lines.push(
    "These flags will be adjudicated by Pass 2 courts. " +
    "Pass 1 has no court yet, so the queue accumulates. " +
    "When synthesizing a build summary, mention the flag count and " +
    "be honest that future court adjudication will resolve them.",
  );
  return lines.join("\n");
}
