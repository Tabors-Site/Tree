// historyManagerHost.js — the host env for history-manager.word's `host:` escapes (8.md §6/§7).
//
// The CONTROL strand (the gate chain: identity present, name valid, canonical valid,
// .histories space resolved) is the `.word`; the genuine computation + the heaven-routed
// reads + the lone WORLD write STAY host. This is the thin adapter that wires the SAME
// historyRegistry primitives the set-pointer JS handler imports into ctx.env.host, so the
// `.word` reaches the REAL logic with ZERO reimplementation — it calls the exact
// isPointerName / readPointers / findPointersSpaceId / doVerb the JS handler calls.
//
// Why these are host (the wall, 1.md): every space/being READ is a `see` and every WRITE
// is a do/be verb — EXCEPT (a) genuine computation: the pointer-name + canonical-path
// regex validation, the map merge; (b) reads the see-registry does not model yet: the
// pointer map and the .histories heaven-space id are HEAVEN reads (MAIN-pinned, routed
// through loadHeavenProjection / findHeavenSpace by the HISTORY enum), which no `see`
// QUERY/READ form can shape today (see blockers); (c) the lone WORLD write, kept host
// like take-able.word's grantInternal so it calls the SAME doVerb(set-space) the JS
// handler calls, reading ctx.moment to lay its fact into the live moment.
//
// callHost invokes each builtin as `fn({ args: [...] }, ctx)`. NONE lay a fact now: the
// validators + the map merge/prune are pure computes (see-ops), the pointer-map + .histories
// id are heaven reads (see-ops), and the WRITE is the .word's targeted `set/replace the
// space historiesSpace's qualities.pointers` (the one do:set-space).

import {
  isPointerName,
  POINTER_NAME_MAX_LENGTH,
  RESERVED_POINTERS,
  readPointers,
  findPointersSpaceId,
} from "../../../materials/history/historyRegistry.js";

// Mirrors CANONICAL_PATH_RE in ops.js (which mirrors HISTORY_RE in address.js). The
// set-pointer handler rejects structurally-invalid `canonical` arguments with it.
const CANONICAL_PATH_RE = /^(?:0|\d+(?:[a-z]+\d+)*(?:[a-z]+)?)$/;

// history the write rides: the moment's act history, else the eval ctx history, else main.
const historyOf = (ctx) =>
  ctx?.moment?.actorAct?.history || ctx?.history || "0";

export function historyManagerHostEnv() {
  return {
    // ── genuine computation: the two validation regexes (host:, not see) ──────────────
    // isPointerName(name) → the SAME historyRegistry grammar gate the JS handler calls.
    // Returns the normalized (lowercased + trimmed) name when valid, else null (the
    // `.word` reads `If no validName:` to refuse). Normalization rides here so the value
    // the .word writes is exactly what the JS handler wrote (`name.trim().toLowerCase()`).
    "valid-pointer-name": ({ args: [name] }) => {
      const n = String(name ?? "")
        .trim()
        .toLowerCase();
      return isPointerName(n) ? n : null;
    },
    // validCanonical(canonical) → the structural path check. Returns the trimmed path
    // when it matches CANONICAL_PATH_RE, else null (the `.word` refuses on absence).
    "valid-canonical": ({ args: [canonical] }) => {
      const c = String(canonical ?? "").trim();
      return CANONICAL_PATH_RE.test(c) ? c : null;
    },

    // ── heaven-routed reads the see-registry does not model yet (host:, see blockers) ──
    // readPointers() → the full pointer map from the `.histories` heaven space's
    // qualities.pointers (MAIN-pinned heaven read). The JS handler calls this verbatim.
    "read-pointers": async () => readPointers(),
    // findPointersSpaceId() → the `.histories` heaven space's id, or null when heaven
    // isn't planted (the `.word` refuses INTERNAL on absence, like the JS handler).
    "find-pointers-space-id": async () => findPointersSpaceId(),

    // ── the merge COMPUTE (a see-op; the WRITE is the .word's targeted set-space) ──────
    // set-pointer-map(current, name, canonical) → the next pointer map + the previous target
    // (current[name] || null). A pure perception of the updated map from inputs, NO fact;
    // the `.word` then stamps it with `replace the space historiesSpace's qualities.pointers`.
    "set-pointer-map": ({ args: [current, name, canonical] }) => {
      const map = current && typeof current === "object" ? current : {};
      const previous = Object.prototype.hasOwnProperty.call(map, name)
        ? map[name]
        : null;
      return { map: { ...map, [name]: canonical }, previous };
    },

    // ── delete-pointer's helpers ──────────────────────────────────────────────────────
    // isReservedPointer(name) → genuine computation: the reserved-list membership check
    // (the SAME RESERVED_POINTERS the JS handler tests), so the `.word` refuses #main etc.
    "is-reserved-pointer": ({ args: [name] }) =>
      RESERVED_POINTERS.includes(String(name)),

    // delete-pointer-map(current, name) → the PRUNED map when the name is present, else null
    // (the `.word` reads `If no outcome:` for the no-op, matching the JS early return). A pure
    // compute, NO fact; the `.word` stamps the pruned map with a targeted set-space.
    "delete-pointer-map": ({ args: [current, name] }) => {
      const map = current && typeof current === "object" ? current : {};
      if (!Object.prototype.hasOwnProperty.call(map, name)) return null;
      const next = { ...map };
      delete next[name];
      return { map: next };
    },
  };
}

export { POINTER_NAME_MAX_LENGTH };
