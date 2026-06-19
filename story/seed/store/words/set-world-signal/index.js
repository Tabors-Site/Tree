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
// path. Reading: `world.<namespace>.<key>` in a roleFlow `when`
// resolves to `<story-root>.qualities.world.<namespace>.<key>`.
//
// Writing: this op is a thin wrapper around set-space that always
// targets story root and shapes the field path so authoring stays
// uniform. The WORLD strand runs through the co-located
// set-world-signal.word via the bridge; the JS below is the
// clean-miss fallback.

import { registerOperation } from "../../../ibp/operations.js";
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { getSpaceRootId } from "../../../sprout.js";
import { doVerb } from "../../../ibp/verbs/do.js";
import { registerRoleWord, resolveRoleWord, runRoleWord } from "../../../present/word/roleWordRegistry.js";

// Self-register this bundle's co-located `.word` slice (CONVERTING.md): importing
// index.js (at seed boot, or in a DRY harness) registers it so
// resolveRoleWord("role-manager", "set-world-signal") finds it. The role:op key
// STAYS role-manager/set-world-signal.
registerRoleWord("role-manager", "set-world-signal", new URL("./set-world-signal.word", import.meta.url));

// World-signal namespaces (extension-style). Keys can be nested dot-paths; we
// constrain each segment to the kebab-case convention so authoring stays
// predictable. The `.word` host glue (roleManagerHostEnv) validates against the
// SAME regex.
const NS_SEGMENT_RE = /^[a-z][a-z0-9-]*$/;

// ──────────────────────────────────────────────────────────────────
// .word host glue (formerly role-managerHost.js)
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
export function roleManagerHostEnv() {
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
    // a pure compute (NO fact). The `.word` feeds it as the $-ref field of a targeted
    // set-space on the story root, so the dynamic path is a perceived value, not a host
    // write. (Same path the JS handler built.)
    "signal-field": ({ args: [namespace, key] }) => {
      const ns = String(namespace || "").trim();
      const keyParts = String(key || "").split(".").map((s) => s.trim());
      return `qualities.world.${ns}.${keyParts.join(".")}`;
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
// CALLER mode (no `through`): the signal-publish set-space attributes to the real
// publisher, not I_AM. Returns the {published,namespace,key,value} result, or null
// on a clean miss (not converted / no moment) so the JS body runs.
async function _setWorldSignalViaWord({ namespace, key, value, moment }) {
  if (!moment) return null;
  const ir = resolveRoleWord("role-manager", "set-world-signal", moment?.actorAct?.history);
  if (!ir) return null;
  const branch = moment?.actorAct?.history || "0";
  try {
    const { result } = await runRoleWord(ir, {
      moment, branch,
      trigger: { namespace, key, value, branch },
      env: { host: roleManagerHostEnv() },
    });
    return result || null;
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

registerOperation("set-world-signal", {
  targets: ["being", "space", "stance"],
  ownerExtension: "seed",
  skipAudit: false,
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

    const field = `qualities.world.${namespace}.${keyParts.join(".")}`;
    await doVerb(
      { kind: "space", id: String(rootId) },
      "set-space",
      { field, value },
      { identity, moment },
    );

    return { published: true, namespace, key, value };
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
