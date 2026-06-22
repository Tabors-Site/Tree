// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// set-world-signal — carved store bundle.
//
//   set-world-signal
//                — write a world signal to story root's qualities at
//                  `qualities.world.<namespace>.<key>`. Beings whose
//                  flows read `world.<namespace>.<key>` see the new
//                  value at their next moment-open. The cleanest
//                  authoring surface for environmental / coordination
//                  patterns (drummer publishes tick.alive, dancers
//                  read it; "library" space stacks library_voice when
//                  ambient.tone is "quiet"; etc.).
//
// World signals live in the story root space's qualities under a
// `world` top-level namespace, then by publisher namespace and key
// path. Reading: `world.<namespace>.<key>` in a flow `when`
// resolves to `<story-root>.qualities.world.<namespace>.<key>`.
//
// Writing: this op is a thin wrapper around set-space that always
// targets story root and shapes the field path so authoring stays
// uniform. The WORLD strand runs through the co-located
// set-world-signal.word via the bridge; the JS below is the
// clean-miss fallback.

import { registerOperation } from "../../../ibp/operations.js";
import { stampsFact, stampsWordFact } from "../../../ibp/factResult.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { getSpaceRootId } from "../../../sprout.js";
import { registerAbleWord, resolveAbleWord, runAbleWord } from "../../../present/word/ableWordRegistry.js";

// Self-register this bundle's co-located `.word` slice (CONVERTING.md): importing
// index.js (at seed boot, or in a DRY harness) registers it so
// resolveAbleWord("able-manager", "set-world-signal") finds it. The able:op key
// STAYS able-manager/set-world-signal.
registerAbleWord("able-manager", "set-world-signal", new URL("./set-world-signal.word", import.meta.url));

// World-signal namespaces (extension-style). Keys can be nested dot-paths; we
// constrain each segment to the kebab-case convention so authoring stays
// predictable. The `.word` host glue (ableManagerHostEnv) validates against the
// SAME regex.
const NS_SEGMENT_RE = /^[a-z][a-z0-9-]*$/;

// ──────────────────────────────────────────────────────────────────
// .word host glue (formerly able-managerHost.js)
// ──────────────────────────────────────────────────────────────────
//
// Host-escape glue for the set-world-signal `.word` slice. Wires the SAME
// primitives the JS handler calls into ctx.env.host: the kebab-case validators,
// the value coercion, and the story-root set-space emit. NO reimplementation —
// only the env adapter the `.word` reaches. callHost invokes each as
// `fn({ args: [...] }, ctx)`. All are now pure computes / reads (NO fact): the
// kebab validators, the value coercion, the dynamic field-path, and the
// story-root id. The WORLD write is the `.word`'s targeted
// `set the space root's $field to $value` (the one do:set-space).
export function ableManagerHostEnv() {
  return {
    // namespace gate: a single kebab-case segment (the SAME NS_SEGMENT_RE the JS uses).
    "valid-namespace": ({ args: [namespace] }) => {
      const ns = String(namespace || "").trim();
      return !!ns && NS_SEGMENT_RE.test(ns);
    },
    // key gate: a dotted path, every segment kebab-case (the SAME check the JS does).
    "valid-key": ({ args: [key] }) => {
      const k = String(key || "").trim();
      if (!k) return false;
      return k.split(".").map((s) => s.trim()).every((p) => NS_SEGMENT_RE.test(p));
    },
    // value coercion: the SAME parseSignalValue (JSON / bare-number / true|false|null).
    "parse-signal-value": ({ args: [value] }) => parseSignalValue(value),
    // signal-field(ns, key) → the dynamic dotted field path qualities.world.<ns>.<key>,
    // a pure compute (NO fact). (Same path the JS handler built.)
    "signal-field": ({ args: [namespace, key] }) => {
      const ns = String(namespace || "").trim();
      const keyParts = String(key || "").split(".").map((s) => s.trim());
      return `qualities.world.${ns}.${keyParts.join(".")}`;
    },
    // signal-fact(ns, key, value) → the set-space fact params { field, value } the
    // dispatcher lays as the lone do:set-space WORLD fact. A pure compute (NO fact):
    // it shapes the SAME { field, value } the old `set the space root's $field to
    // $value` sentence carried, so the auto-emitted fact is byte-identical. The
    // `.word` returns this as `factParams`; the cut promotes it to _factParams.
    "signal-fact": ({ args: [namespace, key, value] }) => {
      const ns = String(namespace || "").trim();
      const keyParts = String(key || "").split(".").map((s) => s.trim());
      return { field: `qualities.world.${ns}.${keyParts.join(".")}`, value };
    },
    // story-root() → the story-root space id (a read), or null when it isn't planted
    // (the `.word` refuses INTERNAL on absence, mirroring the JS throw). The write itself
    // is the `.word`'s `set the space root's $field to $value`.
    "story-root": () => {
      const r = getSpaceRootId();
      return r ? String(r) : null;
    },
  };
}

// set-world-signal's world strand is set-world-signal.word, run through the bridge.
// CALLER mode (no `through`): the lone do:set-space fact attributes to the real
// publisher, not I_AM. The op no longer self-emits — the `.word` lays no fact and
// returns the set-space params as `factParams`; here we promote them to the
// dispatcher's _factParams convention so the auto-emitted do:set-space fact carries
// { field, value }, and force the story-root SPACE target via _factTarget (the
// fact lands on the story-root reel, where the world-signal qualities fold). Returns
// the {published,namespace,key,value} result, or null on a clean miss (not converted
// / no moment) so the JS body runs.
async function _setWorldSignalViaWord({ namespace, key, value, moment }) {
  if (!moment) return null;
  const ir = resolveAbleWord("able-manager", "set-world-signal", moment?.actorAct?.history);
  if (!ir) return null;
  const history = moment?.actorAct?.history || "0";
  try {
    const { result } = await runAbleWord(ir, {
      moment, history,
      trigger: { namespace, key, value, branch: history },
      env: { host: ableManagerHostEnv() },
    });
    if (!result) return null;
    // The .word authored { field, value } as `factParams`; land it as the one
    // caller-attributed do:set-space fact, targeting the story-root space (rootId).
    return stampsWordFact(result, "space", "rootId");
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

registerOperation("set-world-signal", {
  targets: ["being", "space", "stance"],
  ownerExtension: "seed",
  // The op's WORLD effect is a do:set-space on the story root — so the dispatcher's
  // one auto-Fact path stamps `do:set-space` (NOT do:set-world-signal), caller-
  // attributed, of: the story-root reel. No self-emit, no skipAudit: the `.word`
  // (and the JS fallback) return the set-space params as _factParams + the story-root
  // _factTarget, and do.js lays the single fact. One emit path for every op.
  factAction: "set-space",
  args: {
    namespace: { type: "text", label: "Publisher namespace (e.g. \"harmony\")",     required: true },
    key:       { type: "text", label: "Key path (e.g. \"tick.alive\" or \"weather\")", required: true },
    value:     { type: "text", label: "Value (JSON for non-strings; bare for strings)", required: true },
  },
  handler: async ({ params, identity, moment }) => {
    // THE CONVERSION: set-world-signal's world strand is set-world-signal.word, run through
    // the bridge in CALLER mode (no `through` — the signal attributes to the publisher).
    // The JS below is the clean-miss fallback.
    const viaWord = await _setWorldSignalViaWord({ namespace: params?.namespace, key: params?.key, value: params?.value, moment });
    if (viaWord) return viaWord;

    const namespace = String(params?.namespace || "").trim();
    const key       = String(params?.key       || "").trim();
    if (!namespace || !NS_SEGMENT_RE.test(namespace)) {
      throw new IbpError(IBP_ERR.INVALID_INPUT,
        `set-world-signal: namespace must be kebab-case; got "${namespace}"`);
    }
    if (!key) {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "set-world-signal: `key` is required");
    }
    const keyParts = key.split(".").map((s) => s.trim());
    if (!keyParts.every((p) => NS_SEGMENT_RE.test(p))) {
      throw new IbpError(IBP_ERR.INVALID_INPUT,
        `set-world-signal: key segments must be kebab-case; got "${key}"`);
    }

    // Parse value. Strings come through as-is; JSON for objects/numbers/
    // booleans/null. Bare numeric / boolean / null tokens are also
    // accepted so authoring "alive" with value "true" doesn't have to
    // mean JSON quotes.
    const value = parseSignalValue(params?.value);

    const rootId = getSpaceRootId();
    if (!rootId) {
      throw new IbpError(IBP_ERR.INTERNAL, "set-world-signal: story root not initialized");
    }

    // No self-emit: the act lays { field, value } as the do:set-space fact, targeting the
    // story root (byte-identical to the old `set the space root's $field to $value` write).
    // The story root's reducer folds qualities.world.<ns>.<key> from it.
    const field = `qualities.world.${namespace}.${keyParts.join(".")}`;
    return stampsFact(
      { published: true, namespace, key, value },
      { field, value },
      { kind: "space", id: rootId },
    );
  },
});

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

// Coerce a UI-provided value string into a JSON-shaped value. Strings
// like "true"/"false"/"null" map to their literal counterparts; bare
// numbers parse as numbers; anything else is a string. Objects/arrays
// are passed through if the caller already handed us a parsed value.
export function parseSignalValue(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return raw; // already a JSON shape
  const trimmed = raw.trim();
  if (trimmed === "true")  return true;
  if (trimmed === "false") return false;
  if (trimmed === "null")  return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isNaN(n)) return n;
  }
  // Try a JSON parse for explicit object/array literals.
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("\"") && trimmed.endsWith("\""))) {
    try { return JSON.parse(trimmed); } catch { /* fall through */ }
  }
  return raw;
}
