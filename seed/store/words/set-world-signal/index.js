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
// WORD-SOURCED (handler-less, Tabor's no-mirror law): set-world-signal has NO JS
// handler. Its world strand is set-world-signal.word — the ONLY path. The op
// registers a `word` descriptor ({ noun:"space", idFrom:"rootId" }) + its `hostEnv`
// (ableManagerHostEnv); do.js's generic runOpWord resolves the .word, runs it with
// the standard trigger, and promotes the word-authored `factParams` ({ field, value })
// + the story-root target (rootId) via stampsWordFact. The op's WORLD effect is a
// do:set-space on the story root, so factAction is "set-space" (NOT set-world-signal)
// and the one auto-Fact lands on the story-root reel, caller-attributed. No
// `_setWorldSignalViaWord` adapter, no JS body — registration only.

import { registerOperation } from "../../../ibp/operations.js";
import { getSpaceRootId } from "../../../sprout.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";

// Self-register this bundle's co-located `.word` slice (CONVERTING.md): importing
// index.js (at seed boot, or in a DRY harness) registers it so
// resolveAbleWord("able-manager", "set-world-signal") finds it. The able:op key
// STAYS able-manager/set-world-signal.
registerAbleWord(
  "able-manager",
  "set-world-signal",
  new URL("./set-world-signal.word", import.meta.url),
);

// World-signal namespaces (extension-style). Keys can be nested dot-paths; we
// constrain each segment to the kebab-case convention so authoring stays
// predictable. The `.word` host glue (ableManagerHostEnv) validates against the
// SAME regex.
const NS_SEGMENT_RE = /^[a-z][a-z0-9-]*$/;

// ──────────────────────────────────────────────────────────────────
// .word host glue (the op's hostEnv) — the see-escapes set-world-signal.word reaches
// ──────────────────────────────────────────────────────────────────
//
// Host-escape glue for the set-world-signal `.word` slice. Wires the primitives the
// op needs into ctx.env.host: the kebab-case validators, the value coercion, the
// dynamic field-path, and the story-root id. callHost invokes each as
// `fn({ args: [...] }, ctx)`. All are pure computes / reads (NO fact): the kebab
// validators, the value coercion, the dynamic field-path, and the story-root id. The
// WORLD write is the dispatcher's one auto-Fact (do:set-space) from the `.word`'s
// `factParams` — the op self-emits nothing.
export function ableManagerHostEnv() {
  return {
    // namespace gate: a single kebab-case segment (the SAME NS_SEGMENT_RE).
    "valid-namespace": ({ args: [namespace] }) => {
      const ns = String(namespace || "").trim();
      return !!ns && NS_SEGMENT_RE.test(ns);
    },
    // key gate: a dotted path, every segment kebab-case.
    "valid-key": ({ args: [key] }) => {
      const k = String(key || "").trim();
      if (!k) return false;
      return k
        .split(".")
        .map((s) => s.trim())
        .every((p) => NS_SEGMENT_RE.test(p));
    },
    // value coercion: parseSignalValue (JSON / bare-number / true|false|null).
    "parse-signal-value": ({ args: [value] }) => parseSignalValue(value),
    // signal-field(ns, key) → the dynamic dotted field path qualities.world.<ns>.<key>,
    // a pure compute (NO fact).
    "signal-field": ({ args: [namespace, key] }) => {
      const ns = String(namespace || "").trim();
      const keyParts = String(key || "")
        .split(".")
        .map((s) => s.trim());
      return `qualities.world.${ns}.${keyParts.join(".")}`;
    },
    // signal-fact(ns, key, value) → the set-space fact params { field, value } the
    // dispatcher lays as the lone do:set-space WORLD fact. A pure compute (NO fact):
    // it shapes the { field, value } the auto-emitted fact carries. The `.word` returns
    // this as `factParams`; runOpWord promotes it to _factParams.
    "signal-fact": ({ args: [namespace, key, value] }) => {
      const ns = String(namespace || "").trim();
      const keyParts = String(key || "")
        .split(".")
        .map((s) => s.trim());
      return { field: `qualities.world.${ns}.${keyParts.join(".")}`, value };
    },
    // story-root() → the story-root space id (a read), or null when it isn't planted
    // (the `.word` refuses INTERNAL on absence).
    "story-root": () => {
      const r = getSpaceRootId();
      return r ? String(r) : null;
    },
  };
}

// WORD-SOURCED registration — no handler. do.js routes this through runOpWord, which
// runs set-world-signal.word (CALLER mode: no `through`, the signal attributes to the
// real publisher) and stamps the one do:set-space fact (factAction "set-space"),
// target forced to the story-root SPACE via idFrom ("rootId"). One emit path for every op.
registerOperation("set-world-signal", {
  targets: ["being", "space", "stance"],
  ownerExtension: "seed",
  factAction: "set-space",
  args: {
    namespace: {
      type: "text",
      label: 'Publisher namespace (e.g. "harmony")',
      required: true,
    },
    key: {
      type: "text",
      label: 'Key path (e.g. "tick.alive" or "weather")',
      required: true,
    },
    value: {
      type: "text",
      label: "Value (JSON for non-strings; bare for strings)",
      required: true,
    },
  },
  word: { noun: "space", able: "able-manager", idFrom: "rootId" },
  hostEnv: ableManagerHostEnv,
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
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isNaN(n)) return n;
  }
  // Try a JSON parse for explicit object/array literals.
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through */
    }
  }
  return raw;
}
