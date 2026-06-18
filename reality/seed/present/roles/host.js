// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// host.js — make a space the HOST of a role.
//
// Per seed/RolesAreAuth.md "Final doctrine", every role-in-effect
// lives on a space's `qualities.roles[<name>]`. That's the host. The
// role naturally reaches the host + all descendants via qualities
// inheritance; the optional `reach` field adjusts that.
//
// `hostRoleAt(spaceId, name, spec, identity, moment)`
// emits a `do:set-space` fact targeting the space with
// field=`qualities.roles.<name>` and value=spec. The space reducer
// folds into qualities.roles.<name>.
//
// What gets hosted (data only — no function references):
//   - canSee, canDo, canSummon, canBe
//   - reach (optional path filter)
//   - description, requiredCognition, respondMode, triggerOn
//   - prompt — ONLY when it's a string (live-role authoring).
//     Function-shaped prompts (seed/extension roles) stay in the
//     in-memory REGISTRY and the frame builder reads them there.
//
// What stays in REGISTRY (and never persists):
//   - summon handler (the function called for scripted-cognition roles)
//   - prompt function (the LLM-frame builder)
//
// The two-layer split keeps the authorize path pure-data (replay-safe)
// while letting code-owned handlers live in code.

import { IbpError, IBP_ERR } from "../../ibp/protocol.js";

/**
 * Make `spaceId` the HOST of role `name`. Writes the role's data
 * fields into the space's qualities.roles[name] via one do:set-space
 * fact; the space reducer folds it.
 *
 * @param {string} spaceId   target space id (the host)
 * @param {string} name      role name
 * @param {object} spec      the role spec (data fields only — functions are stripped)
 * @param {object} identity  the actor stamping the host fact
 * @param {object} moment the surrounding act ctx (ride this moment's ΔF)
 * @returns {Promise<object>} the do:set-space result
 */
export async function hostRoleAt(spaceId, name, spec, identity, moment) {
  if (!spaceId || typeof spaceId !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "hostRoleAt: `spaceId` is required");
  }
  if (!name || typeof name !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "hostRoleAt: `name` is required");
  }
  if (!spec || typeof spec !== "object") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "hostRoleAt: `spec` is required");
  }

  const data = stripFunctions(spec);

  const { doVerb } = await import("../../ibp/verbs/do.js");
  return await doVerb(
    { kind: "space", id: String(spaceId) },
    "set-space",
    {
      field: `qualities.roles.${name}`,
      value: data,
      merge: false, // whole-spec replacement, not field-level merge
    },
    { identity, moment },
  );
}

/**
 * Return a shallow copy of the role spec with function-valued fields
 * removed. Required for persistence — Mongo can't serialize functions.
 * The remaining fields are the AUTH SPEC (data the role-walk gate uses).
 */
function stripFunctions(spec) {
  const out = {};
  for (const [k, v] of Object.entries(spec)) {
    if (typeof v === "function") continue;
    out[k] = v;
  }
  return out;
}
