// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// role-manager ops. The DO operations the @role-manager delegate
// exposes for live role authoring.
//
// Three ops:
//
//   set-role     — create or replace a live role at
//                  `<story>/./roles/<name>`. Hot-registers it into
//                  the in-memory registry so the next moment-assign
//                  sees it without a restart. Origin tag: "live".
//
//   delete-role  — remove a live role. Refuses if any being's
//                  qualities.roleFlow references the role name (the
//                  flow would silently stop firing for that clause;
//                  surface this loudly at delete-time instead).
//
// (set-world-signal carved out to seed/store/words/set-world-signal/.)
//
// Versioning: replacing a role with the same name overwrites both the
// .roles mirror AND the in-memory registry. The old in-flight moments
// see the OLD spec (frozen at moment-open); the next moment-open sees
// the new spec.
//
// Live → live edits AND delete operations apply immediately. Reverting
// is "set-role with the previous body" or "set-role then restart to
// re-derive from extensions"; the chain is the audit trail either way.

import { registerOperation } from "../../../ibp/operations.js";
import { addManifestChild, removeManifestChild } from "../../manifest.js";
import { HEAVEN_SPACE } from "../../../materials/space/heavenSpaces.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { registerRole, unregisterRole, getRole } from "../registry.js";
import Being from "../../../materials/being/being.js";

export function registerRoleManagerOps() {
  // The actual registerOperation call lives at module load (side effect),
  // but we expose this function so genesis.js can import the module and
  // call this explicitly — mirrors registerLlmAssignerOps's shape so the
  // boot sequence reads uniformly.
}

// Same regex the role registry already enforces via name validation.
const ROLE_NAME_RE = /^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]+)?$/;

const VALID_COGNITION = new Set(["llm", "human", "scripted"]);

// Parse a textarea list — one entry per line, trim, drop blanks.
// Used for canSee/canDo/canSummon/canBe inputs.
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
// set-role
// ──────────────────────────────────────────────────────────────────

registerOperation("set-role", {
  targets: ["being", "space", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    name: { type: "text", label: "Role name (kebab-case)", required: true },
    requiredCognition: {
      type:    "select",
      label:   "Required cognition (optional)",
      enum:    ["", "llm", "human", "scripted"],
      required: false,
      default: "",
    },
    canSee:    { type: "multiline", label: "canSee — IBP addresses, one per line",   required: false },
    canDo:     { type: "multiline", label: "canDo — DO action names, one per line",  required: false },
    canSummon: { type: "multiline", label: "canSummon — being shorthands",            required: false },
    canBe:     { type: "multiline", label: "canBe — BE op names",                     required: false },
    prompt:    { type: "multiline", label: "Prompt (system prompt body, LLM cognition)", required: false },
  },
  handler: async ({ params, moment }) => {
    const name = String(params?.name || "").trim();
    if (!name || !ROLE_NAME_RE.test(name)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-role: name must be kebab-case (e.g. "judge" or "ext:role"); got "${name}"`,
      );
    }

    const requiredCognition = String(params?.requiredCognition || "").trim();
    if (requiredCognition && !VALID_COGNITION.has(requiredCognition)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `set-role: requiredCognition must be one of llm/human/scripted or empty; got "${requiredCognition}"`,
      );
    }

    const canSee    = parseLines(params?.canSee);
    const canDo     = parseLines(params?.canDo);
    // canSummon now accepts a pre-structured array (the role-manager
    // panel sends one entry per picker selection with an `as` tag),
    // OR a multiline string for legacy callers (parsed as strings,
    // which default to `as: "actor"` semantics at consumption).
    const canSummon = Array.isArray(params?.canSummon)
      ? params.canSummon
      : parseLines(params?.canSummon);
    const canBe     = parseLines(params?.canBe);
    const prompt    = typeof params?.prompt === "string" ? params.prompt : "";

    // Collapse the picker inputs into the canonical granted-word-set `can` — each picked word
    // carries its verb. The registry derives the canSee/canDo/canSummon/canBe views + permissions.
    const can = [
      ...canSee.map((w) => ({ verb: "see", word: w })),
      ...canDo.map((w) => ({ verb: "do", word: w })),
      ...canSummon.map((w) => (typeof w === "string" ? { verb: "call", word: w } : { verb: "call", ...w })),
      ...canBe.map((w) => ({ verb: "be", word: w })),
    ];

    const roleQualities = {
      cognition:         null,                                // live roles don't carry cognition (it's on the being)
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
      heavenSpace: HEAVEN_SPACE.ROLES,
      name,
      qualities: new Map([["role", roleQualities]]),
      itemType:  "resource",
      moment,
    });

    // Hot-register. The mirror write above persists across restarts
    // (boot's loadLiveRolesFromSubstrate rebuilds the registry from
    // it); this call makes the role available to the next moment-open
    // WITHOUT a restart. registerRole overwrites silently on name
    // collision, so set-role-as-update works the same path.
    try {
      registerRole(name, {
        description:       `Live role authored via @role-manager.`,
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
        `set-role: persisted to .roles but in-memory register failed: ${err.message}`,
      );
    }

    return {
      written: true,
      name,
      origin:  "live",
      hotRegistered: true,
      _factTarget: { kind: "space", id: name },
    };
  },
});

// ──────────────────────────────────────────────────────────────────
// delete-role
// ──────────────────────────────────────────────────────────────────

registerOperation("delete-role", {
  targets: ["being", "space", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
  args: {
    name: { type: "text", label: "Role name to delete", required: true },
    force: {
      type:    "bool",
      label:   "Force (delete even when beings reference this role)",
      required: false,
      default: false,
    },
  },
  handler: async ({ params, moment }) => {
    const name = String(params?.name || "").trim();
    if (!name) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "delete-role: `name` is required");
    }

    const existing = getRole(name);
    if (!existing) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, `delete-role: role "${name}" not registered`);
    }
    if (existing.origin && existing.origin !== "live") {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `delete-role: role "${name}" is ${existing.origin}-owned. ` +
        `Only live-authored roles can be deleted at runtime.`,
      );
    }

    // Reference safety. Walk every being's qualities.roleFlow for
    // clauses naming this role. Also check defaultRole. `force: true`
    // bypasses (operator decision); the next moment-assign on those
    // beings will skip the dangling clause silently.
    if (params?.force !== true) {
      const referrers = await findRoleReferences(name);
      if (referrers.length) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `delete-role: role "${name}" is referenced by ${referrers.length} being(s): ` +
          `${referrers.slice(0, 5).map((r) => `@${r.name}`).join(", ")}` +
          `${referrers.length > 5 ? ` (+${referrers.length - 5} more)` : ""}. ` +
          `Update those beings' roleFlows first, or pass force:true.`,
        );
      }
    }

    await removeManifestChild({
      heavenSpace: HEAVEN_SPACE.ROLES,
      name,
      itemType:  "resource",
      moment,
    });
    unregisterRole(name);

    return { deleted: true, name };
  },
});

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

// Walk every being's roleFlow + defaultRole for references to a role
// name. Used by delete-role's safety check.
async function findRoleReferences(name) {
  const rows = await Being
    .find({})
    .select("_id name defaultRole qualities")
    .lean();
  const hits = [];
  for (const row of rows) {
    if (row.defaultRole === name) {
      hits.push({ beingId: String(row._id), name: row.name, via: "defaultRole" });
      continue;
    }
    const quals = row.qualities;
    const flow = quals instanceof Map ? quals.get("roleFlow") : quals?.roleFlow;
    if (Array.isArray(flow)) {
      for (const clause of flow) {
        if (clause && clause.role === name) {
          hits.push({ beingId: String(row._id), name: row.name, via: "roleFlow" });
          break;
        }
      }
    }
  }
  return hits;
}
