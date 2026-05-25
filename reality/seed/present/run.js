// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// run.js — the loop over moments for one summon.
//
// A being doesn't live a moment. It lives a stream of them. When
// the moments come in a driven loop, that loop is the run.
// See philosophy/MOMENT.md "The stream, the run, the two chains."
//
// Two run shapes today:
//
//   LLM run (internal). One SUMMON to an LLM being unrolls into
//     many moments inside the present: the LLM folds, perceives
//     (SEE-shaped moments), decides, may take an act (DO/BE), then
//     folds again with the act's facts on the reel — and continues
//     until it answers. The loop runs INSIDE the present, driven
//     by the LLM voice's tool dispatch in voices/llm/runTurn.js.
//     That file is the home of the loop body today; this file
//     names the concept.
//
//   Human run (external). One wire-call per moment. The human's
//     own life is the loop; the present sees one moment at a time
//     come in from the transport. No internal loop is needed
//     because the human is already running theirs externally.
//
// Same atom either way — one moment is fold + at-most-one-act +
// seal. Only the location of the loop differs.
//
// What lives here as code, eventually:
//   - The LLM tool-call loop lifted out of voices/llm/runTurn.js
//     and named for what it is — `runForSummon(...)`.
//   - The per-summon bookkeeping that's currently fused with the
//     LLM voice (iteration cap, compress trigger, abort propagation
//     to nested moments).
//   - Hooks so other voices (a future scripted-loop voice, an
//     external-driver agent) can declare their own run shape.
//
// What lives here as concept today: nothing in code yet. The LLM's
// loop body is in voices/llm/runTurn.js; the per-being intake drain
// is in intake/scheduler.js. Both predate the run.js naming. This
// file is a docked seat for the consolidated form; calling it out
// here keeps run.js next to intake/ per doctrine.

export const RUN_DOCTRINE = `
A being lives a stream of moments. When those moments come in a
driven loop, the loop is the run. LLMs run inside the present;
humans run outside it. Same atom either way: fold, at-most-one-act,
seal.
`;

// ────────────────────────────────────────────────────────────────
// CognitionResult — the discriminated result type every cognition
// step returns up through the moment. Failed cognition does NOT
// reach the seal; the seal-gate in moment.js only accepts ok:true.
//
// Per MODEL.md: a moment is SEE (a = ∅, seals nothing) or DO/BE
// (a ≠ ∅, seals). A failed cognition is a moment whose act is ∅
// — it collapses to SEE. No Act row is written, no inbox row is
// closed, the being's reel and act-chain are byte-identical to
// before the moment ran. Zero trace, by the type, not by anyone
// remembering to re-throw.
//
//   { ok: true, content: string }
//      Cognition produced a valid act. content is the closing
//      utterance the moment seals into Act.endMessage. moment.js
//      writes the Act row and the inbox closes.
//
//   { ok: false, shape: "timeout" | "http-error" | "garbage" |
//                       "aborted" | "internal", reason: string }
//      Cognition produced no act. The moment releases. No Act row
//      is created. The InboxProjection stays open (no answering
//      Act exists to close it — this is automatic, not a policy).
//      Tool-call Facts stamped earlier in the moment persist with
//      their actId pointing to a row that never materialized; that
//      is the audit ("intermediate Facts happened inside a moment
//      that ultimately produced no answer").
//
// The shapes:
//   - timeout    : the conduit's deadline race fired before the
//                  cognition call returned
//   - http-error : the LLM provider returned an error status
//   - garbage    : the LLM call returned but with no parseable
//                  content (no choices, empty choices, choice
//                  without message, empty text)
//   - aborted    : ctx.signal aborted mid-call
//   - internal   : any other failure path in the cognition layer
//
// The bad path is structurally unreachable at the seal: moment.js
// branches on result.ok, and ok:false carries no `content`, so a
// failure literally cannot be sealed. This is the difference
// between "hard to get wrong" and "cannot be gotten wrong."
//
// Legacy scripted roles return `{ content: "string" }` directly
// (no `ok` field). normalizeCognitionResult coerces: an object
// with a string `content` becomes { ok: true, content }; anything
// else becomes { ok: false, shape: "garbage", reason: "..." }.
// New cognition paths should return the discriminated form
// directly; the normalizer is the back-compat shim for the
// scripted-role API that predates this rule.
// ────────────────────────────────────────────────────────────────

const FAILURE_SHAPES = new Set(["timeout", "http-error", "garbage", "aborted", "internal"]);

/**
 * Coerce a cognition step's return value into a CognitionResult.
 * Used by momentum.js as the single boundary where legacy role.summon
 * return shapes become the discriminated form.
 *
 * Rules:
 *   - Already a discriminated result (has `ok` boolean) → pass through
 *     after validating shape on ok:false.
 *   - Plain object with string `content` → { ok: true, content }.
 *   - Plain object with string `text` (legacy LLM return shape) →
 *     { ok: true, content: text }.
 *   - null / undefined / anything else → { ok: false, shape: "garbage",
 *     reason: "cognition returned no usable content" }.
 *
 * Throws no exceptions — the whole point of the result type is to
 * remove discipline-dependent control flow.
 */
export function normalizeCognitionResult(value) {
  if (value && typeof value === "object" && typeof value.ok === "boolean") {
    if (value.ok === true) {
      if (typeof value.content === "string") return value;
      // ok:true with no content is malformed; treat as garbage.
      return { ok: false, shape: "garbage", reason: "ok:true result missing string `content`" };
    }
    // ok:false — validate shape.
    const shape = FAILURE_SHAPES.has(value.shape) ? value.shape : "internal";
    return { ok: false, shape, reason: String(value.reason || "unspecified") };
  }
  if (value && typeof value === "object") {
    if (typeof value.content === "string") return { ok: true, content: value.content };
    if (typeof value.text === "string") return { ok: true, content: value.text };
  }
  return { ok: false, shape: "garbage", reason: "cognition returned no usable content" };
}

/**
 * Convenience constructor for failure results. Cognition paths use
 * this rather than literal object construction so future fields
 * (telemetry, retry hints) land in one place.
 */
export function cognitionFailure(shape, reason) {
  const validShape = FAILURE_SHAPES.has(shape) ? shape : "internal";
  return { ok: false, shape: validShape, reason: String(reason || "") };
}

/**
 * Convenience constructor for success results.
 */
export function cognitionSuccess(content) {
  if (typeof content !== "string") {
    return { ok: false, shape: "garbage", reason: "cognitionSuccess requires string content" };
  }
  return { ok: true, content };
}
