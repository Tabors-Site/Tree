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
// Implementation: sugar over set-<kind>(field="qualities.render", value).
// set-render itself is skipAudit; the inner set-<kind> stamps the
// fact with action="set-<kind>" and field="qualities.render", which the
// existing applySetQualities reducer handles unchanged. ONE fact per
// set-render, rides the calling moment's deltaF normally.

import { registerOperation } from "./operations.js";
import { IbpError, IBP_ERR } from "./protocol.js";
import { detectTargetKind } from "../materials/_targetShape.js";

const VALID_KEYS = new Set([
  "model",
  "scale",
  "rotation",
  "animations",
  "sounds",
  "merge",
]);

function validateRenderBlock(input) {
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
    if (typeof input.model !== "string" || !input.model) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "set-render: model must be a non-empty string",
      );
    }
    block.model = input.model;
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

  return block;
}

async function setRenderHandler(ctx) {
  const { target, params, identity, summonCtx } = ctx;
  const kind = detectTargetKind(target);
  if (kind !== "matter" && kind !== "space" && kind !== "being") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `set-render: target must be matter, space, or being (got "${kind || "untyped"}")`,
    );
  }

  const block = validateRenderBlock(params);
  const merge = params?.merge !== false;

  // Sugar over set-<kind> with field locked to qualities.render. The
  // inner doVerb runs through the normal DO dispatch (auth, audit,
  // reducer-friendly fact shape). summonCtx threads through so the
  // inner fact joins the caller's moment's deltaF and rides the
  // same actId. set-render itself is skipAudit so we don't stamp two
  // facts for one logical write.
  const { doVerb } = await import("./verbs/do.js");
  const innerOp = `set-${kind}`;
  return doVerb(
    target,
    innerOp,
    { field: "qualities.render", value: block, merge },
    { identity, summonCtx },
  );
}

registerOperation("set-render", {
  targets: ["matter", "space", "being"],
  ownerExtension: "seed",
  skipAudit: true,
  handler: setRenderHandler,
});
