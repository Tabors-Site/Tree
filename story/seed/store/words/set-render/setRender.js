// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// set-render . the canonical sensory-write op.
//
// `qualities.render` is the seed-owned namespace any matter/space/being
// can carry. It declares how the thing is rendered across every
// sensory channel the portal supports . the model URL it appears as
// in 3D, the animations triggered by fact arrivals, the sounds those
// same fact arrivals produce, and any future channel (effects,
// haptics, ambient, voice synthesis) that adds its own fact-action
// to channel-output map.
//
// One write op for the whole sensory block, not one op per channel.
// All channels are declared together on the rendered thing because
// they're consequences of the same chain events . a drum's "tick"
// fact triggers the bounce animation AND the drum-hit sound AND the
// future dust-pulse particle effect, all from one render block.
//
// Shape:
//
//   {
//     model?:      string,      // "<ext>:<asset-name>" → /assets/<ext>/<file>
//     scale?:      number,      // positive scalar
//     rotation?:   { x, y, z: number },
//     animations?: { [factAction]: animClipName },
//     sounds?:     { [factAction]: "<ext>:<asset-name>" },
//     merge?:      boolean,     // default true (merges into existing block)
//   }
//
// Validator rejects unknown top-level keys . catches typos at the
// substrate layer, and means future-channel additions to the schema
// are an additive change here rather than a silent-drop-of-typos in
// the wild.
//
// WORD-SOLE (handler-less, Tabor's no-mirror law): set-render has NO JS handler. Its
// world strand is set-render.word — the ONLY path. The op registers a `word` descriptor
// (+ its `hostEnv`, setRenderHostEnv); do.js's generic runOpWord resolves set-render.word,
// runs it with the standard trigger, and promotes the word-authored `factParams`
// ({ field:"qualities.render", value, merge }) via stampsWordFact. The op's WORLD effect
// is the ONE do:set-render fact carrying the render block as a qualities.render set; the
// target's reducer folds it via applySetQualities (set-render ∈ SET_ACTIONS), exactly as
// the JS handler's stampsFact laid. No `_setRenderViaWord` adapter, no JS body — the only
// JS that remains is validateRenderBlock (the schema floor the .word reaches as a see-op).

import { registerOperation } from "../../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { setRenderHostEnv } from "./setRenderHost.js";

// Self-register this slice's co-located WORLD strand (CONVERTING.md): the bridge
// resolves ("render", "set-render") to set-render.word, its see-escapes wired by
// setRenderHost.js. Registered at module load (services.js imports this file at boot).
registerAbleWord("render", "set-render", new URL("./set-render.word", import.meta.url));

const VALID_KEYS = new Set([
  "model",
  "scale",
  "rotation",
  "animations",
  "sounds",
  "merge",
]);

// The set-render floor (a pure compute, NO fact): validate the target KIND + the render
// block, then shape the do:set-render fact params { field:"qualities.render", value, merge }
// the dispatcher lays (the SAME shape the retired JS handler's stampsFact carried, which
// applySetQualities folds unchanged). The .word reaches this as the `validate-render-block`
// see-op (the closed SEE_FLOOR allows that name); `kind` is the standard trigger's targetKind.
// THROWS IbpError on a bad kind or a malformed block — surfacing as the op's refusal. (Named
// validate-render-block since validation is its substance; it returns the fact params, not a
// bare block, so the word can `Return … factParams: $renderParams` with no second see-op.)
export function validateRenderBlock(input, kind = null) {
  if (kind != null && kind !== "matter" && kind !== "space" && kind !== "being") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `set-render: target must be matter, space, or being (got "${kind || "untyped"}")`,
    );
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "set-render: params must be an object");
  }

  // Reject unknown top-level keys. Future channels (effects, haptics)
  // extend VALID_KEYS here; until then, a typo or hallucinated channel
  // name fails loudly rather than silently dropping into the void.
  for (const key of Object.keys(input)) {
    if (!VALID_KEYS.has(key)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-render: unknown key "${key}". Allowed: ${[...VALID_KEYS].join(", ")}.`,
        { key },
      );
    }
  }

  const block = {};

  if (input.model !== undefined) {
    // Two model shapes:
    //   string — legacy extension-asset reference
    //            ("<ext>:<asset-name>" → /assets/<ext>/<file>)
    //   object — a model MATTER block { matterId, hash, url, name }
    //            (the canonical shape set-model writes; bytes live in
    //            the content store). Callers writing the object
    //            directly need at least one resolvable pointer.
    if (typeof input.model === "string" && input.model) {
      block.model = input.model;
    } else if (
      input.model && typeof input.model === "object" && !Array.isArray(input.model) &&
      (typeof input.model.matterId === "string" || typeof input.model.url === "string")
    ) {
      block.model = input.model;
    } else {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "set-render: model must be a non-empty string (asset ref) or an object with matterId/url (model matter; prefer the set-model op)",
      );
    }
  }

  if (input.scale !== undefined) {
    if (
      typeof input.scale !== "number" ||
      !Number.isFinite(input.scale) ||
      input.scale <= 0
    ) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "set-render: scale must be a positive finite number",
      );
    }
    block.scale = input.scale;
  }

  if (input.rotation !== undefined) {
    const r = input.rotation;
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "set-render: rotation must be an object {x, y, z}",
      );
    }
    for (const axis of ["x", "y", "z"]) {
      if (typeof r[axis] !== "number" || !Number.isFinite(r[axis])) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `set-render: rotation.${axis} must be a finite number`,
        );
      }
    }
    block.rotation = { x: r.x, y: r.y, z: r.z };
  }

  for (const channel of ["animations", "sounds"]) {
    if (input[channel] === undefined) continue;
    const m = input[channel];
    if (!m || typeof m !== "object" || Array.isArray(m)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-render: ${channel} must be an object of {factAction: name}`,
      );
    }
    const out = {};
    for (const [action, name] of Object.entries(m)) {
      if (!action || typeof action !== "string") {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `set-render: ${channel} keys must be non-empty strings`,
        );
      }
      if (!name || typeof name !== "string") {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `set-render: ${channel}["${action}"] must be a non-empty string`,
        );
      }
      out[action] = name;
    }
    block[channel] = out;
  }

  // Shape the do:set-render fact params: the validated block at qualities.render, merge
  // default true unless the caller passed merge:false (the SAME { field, value, merge }
  // the retired handler's stampsFact laid). `merge` is a control flag, never copied into
  // the block itself (it is not a render property).
  return { field: "qualities.render", value: block, merge: input?.merge !== false };
}

// WORD-SOURCED registration — no handler. do.js routes this through runOpWord, which
// runs set-render.word (CALLER mode) and promotes its word-authored factParams
// ({ field:"qualities.render", value, merge }) to the dispatcher's _factParams. The ONE
// auto-Fact path stamps the lone do:set-render fact (factAction defaults to "set-render"),
// and applySetQualities (set-render ∈ SET_ACTIONS) folds it onto the target.
//
// DYNAMIC TARGET KIND. set-render's fact lands on the DISPATCH target (a matter OR a space
// OR a being — of.kind must be the actual kind, since reels are keyed by of.kind:of.id and
// the fold queries the target's own kind). stampsWordFact would force of.kind = word.noun
// (one fixed kind), so the .word deliberately returns NO target id (no `factTarget`, and
// idFrom names a field it never returns): stampsWordFact then sets only _factParams and
// leaves _factTarget UNSET, so resolveAuditTarget (do.js) falls back to the typed
// call-target and the fact carries the real matter|space|being kind. DO NOT make the .word
// return `factTargetId` — that would pin every render fact to one kind and break the
// space/being fold.
registerOperation("set-render", {
  targets: ["matter", "space", "being"],
  ownerExtension: "seed",
  word: { noun: "matter", able: "render", idFrom: "factTargetId" },
  hostEnv: setRenderHostEnv,
});
