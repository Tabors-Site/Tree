// Worker-outcome classification.
//
// A Worker's turn ends when it stops emitting. The dispatcher used to
// auto-mark every leaf "done" on turn-end, which lied: a Worker that
// flagged a contract-conflict, emitted [[NO-WRITE]], or ended on reads
// would still show "done" while no artifact existed.
//
// This module reads the Worker's tool trace + the Ruler's flag queue
// delta + the Worker's text and classifies the turn into one of:
//
//   "done"     — at least one artifact-producing write happened.
//                Coordination tools (governing-*, foreman-*) do NOT
//                count: a Worker that ONLY called governing-flag-issue
//                produced no artifact.
//   "blocked"  — Worker emitted a blocking flag, declared [[NO-WRITE]],
//                or called only coordination tools (e.g. a non-blocking
//                flag and nothing else).
//   "advanced" — Worker emitted [[BRANCHES]] (leaf advanced to scope).
//   "failed"   — Worker turn ended on reads / nothing / empty output.
//                Substrate violation — every Worker turn must end with
//                one of write, flag, [[NO-WRITE]], [[BRANCHES]], or
//                [[DONE]]-after-write.
//
// The classifier is pure: same inputs → same outputs. It does not
// read the tree, does not write the record. The dispatcher (or Pass 2
// court adjudicator) reads the result and applies it.

const ARTIFACT_TOOL_EXCLUDE_PREFIXES = ["governing-", "foreman-"];

const NO_WRITE_RE = /\[\[\s*no[\s-]?write(?::\s*([^\]]*))?\s*\]\]/i;
const BRANCHES_RE = /\[\[\s*branches\s*\]\]/i;

/**
 * @param {object} args
 * @param {object} args.workerResult — runSteppedMode's return value.
 *   Reads ._writeTrace (write-tool entries), ._readCount, ._writeCount,
 *   ._allContent (concatenated text across continuation turns).
 * @param {Array}  args.flagsBefore  — snapshot of Ruler's pending flags
 *   before the Worker turn (from readPendingIssues).
 * @param {Array}  args.flagsAfter   — same snapshot after the turn.
 * @returns {{ status: "done"|"blocked"|"advanced"|"failed", reason: string }}
 */
export function classifyWorkerOutcome({
  workerResult,
  flagsBefore = [],
  flagsAfter = [],
} = {}) {
  // 1. New blocking flag during the Worker's turn → explicit refusal.
  const beforeIds = new Set(
    (Array.isArray(flagsBefore) ? flagsBefore : []).map((f) => f?.id).filter(Boolean),
  );
  const newFlags = (Array.isArray(flagsAfter) ? flagsAfter : [])
    .filter((f) => f && f.id && !beforeIds.has(f.id));
  const blocking = newFlags.find((f) => f && f.blocking);
  if (blocking) {
    const kind = blocking.kind || "contract-issue";
    const choice = String(blocking.localChoice || "").trim();
    const proposed = String(blocking.proposedResolution || "").trim();
    const detailParts = [];
    if (choice) detailParts.push(`local: ${choice.slice(0, 200)}`);
    if (proposed) detailParts.push(`proposed: ${proposed.slice(0, 200)}`);
    return {
      status: "blocked",
      reason: `Worker emitted blocking ${kind} flag${detailParts.length ? ` — ${detailParts.join(" / ")}` : ""}`,
    };
  }

  // 2. Artifact-producing write tool calls → done.
  const writeTrace = Array.isArray(workerResult?._writeTrace)
    ? workerResult._writeTrace
    : [];
  const artifactWrites = writeTrace.filter((e) => {
    const t = String(e?.tool || "");
    if (!t) return false;
    for (const pfx of ARTIFACT_TOOL_EXCLUDE_PREFIXES) {
      if (t.startsWith(pfx)) return false;
    }
    return true;
  });
  if (artifactWrites.length > 0) {
    const names = artifactWrites.slice(0, 4).map((e) => e.tool);
    return {
      status: "done",
      reason: `Worker called ${artifactWrites.length} artifact-producing tool${artifactWrites.length === 1 ? "" : "s"}: ${names.join(", ")}`,
    };
  }

  // 3. Marker-only legitimate exits ([[NO-WRITE]] or [[BRANCHES]]).
  const text = String(
    workerResult?._allContent
    || workerResult?.content
    || workerResult?.answer
    || "",
  );
  const noWriteMatch = text.match(NO_WRITE_RE);
  if (noWriteMatch) {
    const reason = String(noWriteMatch[1] || "").trim();
    return {
      status: "blocked",
      reason: `Worker declared [[NO-WRITE]]${reason ? `: ${reason.slice(0, 200)}` : " with no reason given"}`,
    };
  }
  if (BRANCHES_RE.test(text)) {
    return {
      status: "advanced",
      reason: "Worker emitted [[BRANCHES]] — leaf decomposed into sub-scopes",
    };
  }

  // 4. Empty or coordination-only turn → failed / blocked.
  const readCount = workerResult?._readCount || 0;
  const coordWrites = writeTrace.length;
  if (coordWrites > 0) {
    // Worker called coordination tools (e.g. governing-flag-issue
    // non-blocking) but produced no artifact. Treat as blocked — the
    // Worker surfaced something but did not realize the leaf.
    return {
      status: "blocked",
      reason: `Worker called ${coordWrites} coordination tool${coordWrites === 1 ? "" : "s"} (no blocking flag, no artifact) — leaf not realized`,
    };
  }
  return {
    status: "failed",
    reason: readCount > 0
      ? `Worker turn ended with ${readCount} read${readCount === 1 ? "" : "s"} and zero writes / markers — leaf not realized`
      : "Worker turn ended with no tool activity and no markers — substrate violation",
  };
}
