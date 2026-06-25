// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// CognitionResult . the discriminated outcome of one moment's cognition.
//
// Three kinds, no fourth:
//
//   { kind: "act",  content: string }
//       The being acted. content is the closing utterance the moment
//       seals into Act.endMessage. moment.js writes the Act row and
//       closes the inbox.
//
//   { kind: "see" }
//       The being looked and chose not to act. Not a failure . a
//       legitimate cognition outcome. No Act row, no seal, no retry,
//       no refacing. The inbox closes (the moment ran to completion).
//       MODEL.md: SEE = a = empty.
//
//   { kind: "failure", shape, reason }
//       The cognition broke. No Act, no completion. The inbox row may
//       evict (deterministic shapes) or stay (transient like aborted).
//
// SEE is NOT a failure shape. The two have the same downstream effect
// (no Act row materializes) but different meaning, different log lines,
// different recoverability semantics. A being that always SEEs is
// quietly contemplative; a being whose cognition keeps failing is
// broken.
//
// The seal-gate at 4-stamped is structural: only kind:"act" carries
// `content`, so a non-act literally cannot be sealed.
//
// Legacy `ok` field. Consumers that only care about "did a seal happen"
// can read `.ok` (kind:"act" => true; otherwise false). Kept as derived
// because the old code branches on it heavily; new code should branch
// on kind.

// timeout / http-error / garbage / aborted / internal are infra
// failures: the cognition tried to act and the rails failed. "refused"
// is a domain failure: the cognition perceived the situation and
// deliberately declined. Scripted ables use this to surface
// perception-aware refusals (e.g. birther sees a name collision in
// ctx.innerFace.blocks and refuses the mate request without going
// through the in-place uniqueness throw).
const FAILURE_SHAPES = new Set([
  "timeout",
  "http-error",
  "garbage",
  "aborted",
  "internal",
  "refused",
]);

/**
 * Coerce a legacy or external return value into a CognitionResult.
 * 3-momentum.js calls this at the boundary where able.summon's return
 * shape becomes the discriminated form.
 *
 * Rules:
 *   - Already a discriminated result (has `kind`) . pass through after
 *     validating shape / coercing ok.
 *   - Legacy `{ ok: true, content: string }` . { kind:"act", content }.
 *   - Legacy `{ ok: false, shape, reason }` . { kind:"failure", shape, reason }.
 *   - Plain `{ content: string }` . { kind:"act", content }.
 *   - Plain `{ text: string }` . { kind:"act", content: text }.
 *   - null / undefined / non-object . { kind:"failure", shape:"garbage", ... }.
 *
 * Throws no exceptions . the whole point of the result type is to
 * remove discipline-dependent control flow.
 */
export function normalizeCognitionResult(value) {
  if (value && typeof value === "object" && typeof value.kind === "string") {
    if (value.kind === "act") {
      if (typeof value.content === "string") {
        return { ...value, ok: true };
      }
      return cognitionFailure("garbage", "kind:act missing string content");
    }
    if (value.kind === "see") {
      return { kind: "see", ok: false };
    }
    if (value.kind === "failure") {
      const shape = FAILURE_SHAPES.has(value.shape) ? value.shape : "internal";
      return {
        kind: "failure",
        ok: false,
        shape,
        reason: String(value.reason || "unspecified"),
      };
    }
    return cognitionFailure("internal", `unknown cognition kind "${value.kind}"`);
  }

  if (value && typeof value === "object" && typeof value.ok === "boolean") {
    if (value.ok === true) {
      if (typeof value.content === "string") {
        return { kind: "act", ok: true, content: value.content, ...legacyExtras(value) };
      }
      return cognitionFailure("garbage", "ok:true result missing string content");
    }
    const shape = FAILURE_SHAPES.has(value.shape) ? value.shape : "internal";
    return {
      kind: "failure",
      ok: false,
      shape,
      reason: String(value.reason || "unspecified"),
    };
  }

  if (value && typeof value === "object") {
    if (typeof value.content === "string") {
      return { kind: "act", ok: true, content: value.content };
    }
    if (typeof value.text === "string") {
      return { kind: "act", ok: true, content: value.text };
    }
  }

  return cognitionFailure("garbage", "cognition returned no usable content");
}

function legacyExtras(value) {
  const out = {};
  if (value.verbResult !== undefined) out.verbResult = value.verbResult;
  return out;
}

/**
 * Build a kind:"act" result. The being produced a closing utterance.
 */
export function cognitionSuccess(content) {
  if (typeof content !== "string") {
    return cognitionFailure("garbage", "cognitionSuccess requires string content");
  }
  return { kind: "act", ok: true, content };
}

/**
 * Build a kind:"see" result. The being looked and chose not to act.
 * Distinct from any failure shape. No Act seals; the moment is
 * complete.
 */
export function cognitionSee() {
  return { kind: "see", ok: false };
}

/**
 * Build a kind:"failure" result.
 */
export function cognitionFailure(shape, reason) {
  const validShape = FAILURE_SHAPES.has(shape) ? shape : "internal";
  return {
    kind: "failure",
    ok: false,
    shape: validShape,
    reason: String(reason || ""),
  };
}

/**
 * Sentinel error used WITHIN a cognition implementation to bubble a
 * failure to the cognition's boundary without threading a result
 * through every frame. The outer boundary catches and converts to
 * { kind:"failure", ... }.
 */
export function cognitionFailureError(shape, reason) {
  const validShape = FAILURE_SHAPES.has(shape) ? shape : "internal";
  const err = new Error(`Cognition failed: ${validShape}${reason ? ` (${reason})` : ""}`);
  err._cognitionFailure = true;
  err.shape = validShape;
  err.reason = String(reason || "");
  return err;
}

export function isCognitionFailure(err) {
  return err && err._cognitionFailure === true;
}
