// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// able-manager ops. The DO operations the @able-manager delegate
// exposes for live able authoring.
//
// Three ops:
//
//   set-able     — create or replace a live able at
//                  `<story>/./ables/<name>`. Hot-registers it into
//                  the in-memory registry so the next moment-assign
//                  sees it without a restart. Origin tag: "live".
//
//   delete-able  — remove a live able. Refuses if any being's
//                  qualities.flow references the able name (the
//                  flow would silently stop firing for that clause;
//                  surface this loudly at delete-time instead).
//
// (set-world-signal carved out to seed/store/words/set-world-signal/.)
//
// Versioning: replacing a able with the same name overwrites both the
// .ables mirror AND the in-memory registry. The old in-flight moments
// see the OLD spec (frozen at moment-open); the next moment-open sees
// the new spec.
//
// Live → live edits AND delete operations apply immediately. Reverting
// is "set-able with the previous body" or "set-able then restart to
// re-derive from extensions"; the chain is the audit trail either way.

import { registerOperation } from "../../../ibp/operations.js";
import { addManifestChild, removeManifestChild } from "../../manifest.js";
import { HEAVEN_SPACE } from "../../../materials/space/heavenSpaces.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { registerAble, unregisterAble, getAble } from "../registry.js";
import Being from "../../../materials/being/being.js";
import { targetsFact } from "../../../ibp/factResult.js";

export function registerAbleManagerOps() {
  // The actual registerOperation call lives at module load (side effect),
  // but we expose this function so genesis.js can import the module and
  // call this explicitly — mirrors registerLlmAssignerOps's shape so the
  // boot sequence reads uniformly.
}

// Same regex the able registry already enforces via name validation.
const ABLE_NAME_RE = /^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]+)?$/;

const VALID_COGNITION = new Set(["llm", "human", "scripted"]);

// Parse a textarea list — one entry per line, trim, drop blanks.
// Used for canSee/canDo/canCall/canBe inputs.
function parseLines(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  return value
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ──────────────────────────────────────────────────────────────────
// set-able
// ──────────────────────────────────────────────────────────────────

registerOperation("set-able", {
  targets: ["being", "space", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    name: { type: "text", label: "Able name (kebab-case)", required: true },
    requiredCognition: {
      type:    "select",
      label:   "Required cognition (optional)",
      enum:    ["", "llm", "human", "scripted"],
      required: false,
      default: "",
    },
    canSee:    { type: "multiline", label: "canSee — IBP addresses, one per line",   required: false },
    canDo:     { type: "multiline", label: "canDo — DO action names, one per line",  required: false },
    canCall: { type: "multiline", label: "canCall — being shorthands",            required: false },
    canBe:     { type: "multiline", label: "canBe — BE op names",                     required: false },
    prompt:    { type: "multiline", label: "Prompt (system prompt body, LLM cognition)", required: false },
  },
  handler: async ({ params, moment }) => {
    const name = String(params?.name || "").trim();
    if (!name || !ABLE_NAME_RE.test(name)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-able: name must be kebab-case (e.g. "judge" or "ext:able"); got "${name}"`,
      );
    }

    const requiredCognition = String(params?.requiredCognition || "").trim();
    if (requiredCognition && !VALID_COGNITION.has(requiredCognition)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-able: requiredCognition must be one of llm/human/scripted or empty; got "${requiredCognition}"`,
      );
    }

    const canSee    = parseLines(params?.canSee);
    const canDo     = parseLines(params?.canDo);
    // canCall now accepts a pre-structured array (the able-manager
    // panel sends one entry per picker selection with an `as` tag),
    // OR a multiline string for legacy callers (parsed as strings,
    // which default to `as: "actor"` semantics at consumption).
    const canCall = Array.isArray(params?.canCall)
      ? params.canCall
      : parseLines(params?.canCall);
    const canBe     = parseLines(params?.canBe);
    const prompt    = typeof params?.prompt === "string" ? params.prompt : "";

    // Collapse the picker inputs into the canonical granted-word-set `can` — each picked word
    // carries its verb. The registry derives the canSee/canDo/canCall/canBe views + permissions.
    const can = [
      ...canSee.map((w) => ({ verb: "see", word: w })),
      ...canDo.map((w) => ({ verb: "do", word: w })),
      ...canCall.map((w) => (typeof w === "string" ? { verb: "call", word: w } : { verb: "call", ...w })),
      ...canBe.map((w) => ({ verb: "be", word: w })),
    ];

    const ableQualities = {
      cognition:         null,                                // live ables don't carry cognition (it's on the being)
      requiredCognition: requiredCognition || null,
      permissions: [...new Set(can.map((e) => e.verb))],
      respondMode: "async",
      triggerOn:   ["message"],
      can,
      replyTo:     null,
      prompt,
      origin:      "live",
    };

    await addManifestChild({
      heavenSpace: HEAVEN_SPACE.ABLES,
      name,
      qualities: new Map([["able", ableQualities]]),
      itemType:  "resource",
      moment,
    });

    // Hot-register. The mirror write above persists across restarts
    // (boot's loadLiveAblesFromSubstrate rebuilds the registry from
    // it); this call makes the able available to the next moment-open
    // WITHOUT a restart. registerAble overwrites silently on name
    // collision, so set-able-as-update works the same path.
    try {
      registerAble(name, {
        description:       `Live able authored via @able-manager.`,
        requiredCognition: requiredCognition || null,
        can,
        replyTo:           null,
        prompt:            () => prompt,
      }, "live");
    } catch (err) {
      // Mirror write succeeded; in-memory failed. Boot will rebuild it
      // from the mirror. Surface but don't fail the op.
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-able: persisted to .ables but in-memory register failed: ${err.message}`,
      );
    }

    return targetsFact({
      written: true,
      name,
      origin:  "live",
      hotRegistered: true,
    }, { kind: "space", id: name });
  },
});

// ──────────────────────────────────────────────────────────────────
// delete-able
// ──────────────────────────────────────────────────────────────────

registerOperation("delete-able", {
  targets: ["being", "space", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    name: { type: "text", label: "Able name to delete", required: true },
    force: {
      type:    "bool",
      label:   "Force (delete even when beings reference this able)",
      required: false,
      default: false,
    },
  },
  handler: async ({ params, moment }) => {
    const name = String(params?.name || "").trim();
    if (!name) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "delete-able: `name` is required");
    }

    const existing = getAble(name);
    if (!existing) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, `delete-able: able "${name}" not registered`);
    }
    if (existing.origin && existing.origin !== "live") {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `delete-able: able "${name}" is ${existing.origin}-owned. ` +
        `Only live-authored ables can be deleted at runtime.`,
      );
    }

    // Reference safety. Walk every being's qualities.flow for
    // clauses naming this able. Also check defaultAble. `force: true`
    // bypasses (operator decision); the next moment-assign on those
    // beings will skip the dangling clause silently.
    if (params?.force !== true) {
      const referrers = await findAbleReferences(name);
      if (referrers.length) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `delete-able: able "${name}" is referenced by ${referrers.length} being(s): ` +
          `${referrers.slice(0, 5).map((r) => `@${r.name}`).join(", ")}` +
          `${referrers.length > 5 ? ` (+${referrers.length - 5} more)` : ""}. ` +
          `Update those beings' flows first, or pass force:true.`,
        );
      }
    }

    await removeManifestChild({
      heavenSpace: HEAVEN_SPACE.ABLES,
      name,
      itemType:  "resource",
      moment,
    });
    unregisterAble(name);

    // Cross-reel re-target (23.md [C]): the able's lifecycle facts live on its OWN reel —
    // set-able wrote the .ables/<name> space reel; delete-able's tombstone lands there too,
    // not on the caller's target. Same `targetsFact({kind:"space", id:name})` shape as set-able,
    // so the able's reel reads set→delete in order and the registry fold derives "gone."
    return targetsFact({ deleted: true, name }, { kind: "space", id: name });
  },
});

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

// Walk every being's flow + defaultAble for references to a able
// name. Used by delete-able's safety check.
async function findAbleReferences(name) {
  const rows = await Being
    .find({})
    .select("_id name defaultAble qualities")
    .lean();
  const hits = [];
  for (const row of rows) {
    if (row.defaultAble === name) {
      hits.push({ beingId: String(row._id), name: row.name, via: "defaultAble" });
      continue;
    }
    const quals = row.qualities;
    const flow = quals instanceof Map ? quals.get("flow") : quals?.flow;
    if (Array.isArray(flow)) {
      for (const clause of flow) {
        if (clause && clause.able === name) {
          hits.push({ beingId: String(row._id), name: row.name, via: "flow" });
          break;
        }
      }
    }
  }
  return hits;
}
