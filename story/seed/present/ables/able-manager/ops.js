// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// able-manager ops. The DO operations the @able-manager delegate
// exposes for live able authoring.
//
// Two ops:
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
// WORD-SOLE (handler-less, Tabor's no-mirror law): neither op has a JS handler. Each op's world
// strand is its co-located `.word` — set-able.word / delete-able.word, the ONLY path (do.js runOpWord
// runs it). These are MANIFEST-ORCHESTRATION ops: the genuine EFFECT (write the .ables/<name> manifest
// child + hot-register / unregister the able) lives in ableManagerHost.js (author-live-able /
// remove-live-able), reusing the SAME addManifestChild / registerAble / removeManifestChild /
// unregisterAble the JS handlers called — zero reimplementation. The .word is the control strand + the
// audit return; the do:set-able / do:delete-able audit fact lands on the able's pseudo-reel
// {space, name} (each word surfaces `spaceId: name` so resolveAuditTarget targets it, the shape the
// handlers' targetsFact produced). Versioning: replacing a able with the same name overwrites both the
// .ables mirror AND the in-memory registry (old in-flight moments see the OLD spec, frozen at
// moment-open; the next moment-open sees the new spec).

import { registerOperation } from "../../../ibp/operations.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { ableManagerHostEnv } from "./ableManagerHost.js";

// Self-register the co-located world strands so resolveAbleWord("able-manager", <op>) finds them.
registerAbleWord("able-manager", "set-able", new URL("./set-able.word", import.meta.url));
registerAbleWord("able-manager", "delete-able", new URL("./delete-able.word", import.meta.url));

export function registerAbleManagerOps() {
  // The actual registerOperation call lives at module load (side effect),
  // but we expose this function so genesis.js can import the module and
  // call this explicitly — mirrors registerLlmAssignerOps's shape so the
  // boot sequence reads uniformly.
}

// ──────────────────────────────────────────────────────────────────
// set-able — WORD-SOURCED, no handler. do.js routes through runOpWord → set-able.word →
// author-live-able (the manifest write + hot-register). The audit fact lands on {space, name}.
// ──────────────────────────────────────────────────────────────────
registerOperation("set-able", {
  targets: ["being", "space", "stance"],
  ownerExtension: "seed",
  factAction: "set-able",
  args: {
    name: { type: "text", label: "Able name (kebab-case)", required: true },
    requiredCognition: {
      type: "select",
      label: "Required cognition (optional)",
      enum: ["", "llm", "human", "scripted"],
      required: false,
      default: "",
    },
    canSee: { type: "multiline", label: "canSee — IBP addresses, one per line", required: false },
    canDo: { type: "multiline", label: "canDo — DO action names, one per line", required: false },
    canCall: { type: "multiline", label: "canCall — being shorthands", required: false },
    canBe: { type: "multiline", label: "canBe — BE op names", required: false },
    prompt: { type: "multiline", label: "Prompt (system prompt body, LLM cognition)", required: false },
  },
  word: { noun: "space", able: "able-manager" },
  hostEnv: ableManagerHostEnv,
});

// ──────────────────────────────────────────────────────────────────
// delete-able — WORD-SOURCED, no handler. do.js routes through runOpWord → delete-able.word →
// remove-live-able (origin + reference-safety gates, then manifest remove + unregister).
// ──────────────────────────────────────────────────────────────────
registerOperation("delete-able", {
  targets: ["being", "space", "stance"],
  ownerExtension: "seed",
  factAction: "delete-able",
  args: {
    name: { type: "text", label: "Able name to delete", required: true },
    force: {
      type: "bool",
      label: "Force (delete even when beings reference this able)",
      required: false,
      default: false,
    },
  },
  word: { noun: "space", able: "able-manager" },
  hostEnv: ableManagerHostEnv,
});
