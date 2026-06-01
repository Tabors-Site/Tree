// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// role-manager ops. The DO operations the @role-manager delegate
// exposes for live role authoring.
//
// One op for now: `set-role`. Creates or replaces a live role at
// `<reality>/.roles/<name>` with `qualities.role.origin = "live"`.
// The boot-time live-role loader (genesis.js) walks .roles for
// origin:"live" entries and calls registerRole on each so the
// in-memory registry exposes them like any other role.
//
// Versioning: an existing role with origin:"seed" or extension-owned
// can be SHADOWED by a live entry under the same name (the boot
// loader runs after seed/extension registration and overwrites the
// registry map). Reverting is "delete the .roles/<name> child" and
// restart. Live → live edits also require restart in v1; the
// in-memory registry doesn't hot-reload.

import { registerOperation } from "../../../ibp/operations.js";
import { addManifestChild } from "../../manifest.js";
import { SEED_SPACE } from "../../../materials/space/seedSpaces.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";

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
    canSee:    { type: "multiline", label: "canSee — tool names, one per line",      required: false },
    canDo:     { type: "multiline", label: "canDo — DO action names, one per line",  required: false },
    canSummon: { type: "multiline", label: "canSummon — being shorthands",            required: false },
    canBe:     { type: "multiline", label: "canBe — BE op names",                     required: false },
    prompt:    { type: "multiline", label: "Prompt (system prompt body, LLM cognition)", required: false },
  },
  handler: async ({ params, summonCtx }) => {
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
    const canSummon = parseLines(params?.canSummon);
    const canBe     = parseLines(params?.canBe);
    const prompt    = typeof params?.prompt === "string" ? params.prompt : "";

    // Build the qualities.role payload. Same shape syncRolesToSubstrate
    // writes for seed/extension roles, plus origin:"live" so the boot
    // loader can pick this out from auto-synced mirror entries.
    const roleQualities = {
      cognition:         null,                                // live roles don't carry cognition (it's on the being)
      requiredCognition: requiredCognition || null,
      permissions: derivePermissions({ canSee, canDo, canSummon, canBe }),
      respondMode: "async",
      triggerOn:   ["message"],
      canSee, canDo, canSummon, canBe,
      see:         [],
      replyTo:     null,
      prompt,
      origin:      "live",
    };

    await addManifestChild({
      seedSpace: SEED_SPACE.ROLES,
      name,
      qualities: new Map([["role", roleQualities]]),
      itemType:  "resource",
      summonCtx,
    });

    return {
      written: true,
      name,
      origin:  "live",
      _factTarget: { kind: "space", id: name },  // surfaced for the audit Fact
    };
  },
});

// Mirror of registry.js's derivePermissions but inline so we don't
// drag the registry module into this op's hot path.
function derivePermissions({ canSee, canDo, canSummon, canBe }) {
  const verbs = new Set();
  if (canSee.length)    verbs.add("see");
  if (canDo.length)     verbs.add("do");
  if (canSummon.length) verbs.add("summon");
  if (canBe.length)     verbs.add("be");
  return [...verbs];
}
