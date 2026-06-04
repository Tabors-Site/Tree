// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seed's contribution to the refs registry.
//
// Every action handler the seed registers, and every qualities
// namespace the seed owns, gets one entry here. Encoded directly from
// REFS_MANIFEST.md so the inventory and the runtime registry stay in
// step. The seed calls `installSeedRefs()` once at boot (from
// genesis.js); extensions contribute their own entries via their
// manifest's `refs` field.
//
// See:
//   - REFS_MANIFEST.md for the human-readable inventory + rationale.
//   - refs.js for the registry mechanics.

import { registerRefs } from "./refs.js";

const SEED_OWNER = "seed";

const SEED_REFS = {
  ops: {
    // ── Materials — being ───────────────────────────────────────────
    //
    // set-being routes on `params.field`. Each schema-field branch
    // that carries an ID gets a `params.value` entry; the qualities
    // branch is covered separately under qualities below. We list
    // the union here . the graft layer filters by field at runtime.
    "set-being": {
      params: {
        // params.value when field is parentBeingId | homeSpace | position
        // (all three write a single string ID into params.value)
        "value": "being",   // when field === parentBeingId
        // homeSpace + position are also `params.value`, kind "space" —
        // the same path can't carry two kinds in this static manifest,
        // so the graft layer must inspect params.field at runtime. We
        // register the most common kind here and note the exception.
        // See _runtime-field-dispatch.md when it exists.
        "fromPosition": "space",
      },
    },
    "end-being": { params: {} },

    // ── Materials — space ───────────────────────────────────────────
    "create-space": {
      params: {
        "spec.parent":     "space",
        "spec.rootOwner":  "being",
        "spec.spaceId":    "space",
        "spec.position":   "space",
        "spec.parentBeingId": "being",
      },
    },
    "set-space": {
      params: {
        // params.value when field is "parent" → space
        //              when field is "rootOwner" → being
        // (same per-field-dispatch caveat as set-being)
        "value": "space",
      },
    },
    "end-space": { params: {} },

    // ── Materials — matter ──────────────────────────────────────────
    "create-matter": {
      params: {
        "spec.spaceId":        "space",
        "spec.parentMatterId": "matter",
        "spec.beingId":        "being",
      },
    },
    "set-matter": {
      params: {
        // params.value when field is parentSpace | parentMatterId
        // (same per-field-dispatch caveat as set-being)
        "value": "space",
      },
    },
    "end-matter": { params: {} },

    // ── Materials — move ────────────────────────────────────────────
    "move": {
      params: {
        "to":     "space",
        "target": "space",  // could also be matter; runtime dispatches
      },
    },

    // ── Materials — seeds / plant ───────────────────────────────────
    //
    // plant's target is a space; the spec is opaque to seed (per-seed
    // extensions declare their own refs for what's inside).
    "plant": {
      params: {},
    },

    // ── Materials — render ──────────────────────────────────────────
    "set-render": {
      params: {},
    },

    // ── Heaven — config ─────────────────────────────────────────────
    "set-config":    { params: {} },
    "delete-config": { params: {} },

    // ── Heaven — roles ──────────────────────────────────────────────
    "set-role": {
      params: {
        // role names are NEVER remapped — but listed as "name" so the
        // graft layer knows to leave them alone vs. treating as raw ID
        "name":      "name",
        "canSee":    "name",
        "canDo":     "name",
        "canSummon": "name",
      },
    },
    "delete-role": {
      params: { "name": "name" },
    },
    "set-world-signal": {
      params: {
        "namespace": "name",
        "key":       "name",
      },
    },
    "set-being-roleflow": {
      params: {
        "beingId": "being",
        // roleflow clause refs are name-keyed; not enumerated here
        // because the path varies with the clauses array structure.
        // The graft layer inspects clauses[*].role / clauses[*].when
        // and treats both as "name".
      },
    },

    // ── Heaven — branches ───────────────────────────────────────────
    //
    // These ops mutate Branch rows; they don't appear in replicate
    // bundles (replicates don't carry branch state). Empty entries are
    // listed so the registry knows the seed handles them.
    "create-branch":   { params: {} },
    "pause-branch":    { params: {} },
    "unpause-branch":  { params: {} },
    "delete-branch":   { params: {} },
    "undelete-branch": { params: {} },
    "merge-branches":  { params: {} },
    "set-pointer":     { params: {} },
    "delete-pointer":  { params: {} },

    // ── Credentials ─────────────────────────────────────────────────
    "credential-read":    { params: {} },
    "credential-reset":   { params: {} },
    "credential-detach":  { params: {} },
    "credential-attach": {
      params: {
        "beingId": "being",
      },
    },

    // ── LLM connections ─────────────────────────────────────────────
    //
    // Per-being connection keys are local; nothing to remap.
    "add-llm-connection":    { params: {} },
    "update-llm-connection": { params: {} },
    "delete-llm-connection": { params: {} },
    "assign-llm-slot":       { params: {} },
  },

  qualities: {
    // ── qualities.beings (on Space) ─────────────────────────────────
    "beings": {
      "*.beingId":       "being",
      "*.parentBeingId": "being",
      "*.homeSpace":     "space",
    },

    // ── qualities.connection (on Being or Space) ────────────────────
    "connection": {
      "inhabitedBy":       "being",
      "inhabitsHomeSpace": "space",
    },

    // ── qualities.wakes (on Being) ──────────────────────────────────
    //
    // Wake schedules. The graft layer re-anchors time fields; only the
    // ID fields are remapped here.
    "wakes": {
      "*.spaceId": "space",
      "*.beingId": "being",
    },

    // ── qualities.memory (on Being, per-role) ───────────────────────
    //
    // Sketched here as a convention; roles that use this namespace
    // can extend via their owning extension.
    "memory": {
      "partners.*.id": "being",
    },

    // ── qualities.cognition (on Being) ──────────────────────────────
    "cognition": {
      "defaultKind":        "name",
      "assignedConnection": "name",
    },

    // ── qualities.llmConnections (on Being) ─────────────────────────
    //
    // Per-being connection map. Payloads are secrets; NEVER included
    // in replicates. Listed for completeness (no remappable IDs).
    "llmConnections": {},

    // ── qualities.contributors (on Space) ───────────────────────────
    "contributors": {
      "*.beingId": "being",
    },

    // ── qualities.roleFlow (on Being) ───────────────────────────────
    //
    // Clauses reference roles + signals by name. The future ref-style
    // (qualities.roleFlow.ref = "name") is also name-keyed.
    "roleFlow": {
      "ref": "name",
      "clauses.*.role": "name",
      "clauses.*.when": "name",
    },

    // ── qualities.pointers (on .branches heaven space) ──────────────
    //
    // Pointer registry. Values are canonical branch paths (strings
    // like "0", "1a") — not aggregate IDs.
    "pointers": {},
  },
};

let _installed = false;

/**
 * Register the seed's refs contribution. Idempotent — calling twice
 * is a no-op the second time. Genesis calls this once at boot,
 * before any extension load fires.
 */
export function installSeedRefs() {
  if (_installed) return;
  registerRefs(SEED_REFS, SEED_OWNER);
  _installed = true;
}

export function _resetSeedRefsForTesting() {
  _installed = false;
}
