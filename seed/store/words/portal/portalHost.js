// portalHost.js — the floor reads behind portal.word's `see` ops. These are the
// irreducible SEE escapes (a read consults the host; it lays no fact). The WORLD
// write is no longer here: portal.word COMPOSES `do create-matter`, so the matter
// is born by create-matter's own clean path and the dispatcher lays the one fact.
//
// Each see-op is invoked as `fn({ args: [...] }, ctx)` (the parser emits
// `see fn(a, b) as c` -> params:{ args:["$a","$b"] }). hasAddress / validAddress are
// pure IBPA-shape checks (the IBPA_RE bounded regex). resolveContainingSpace is a
// by-id matter load (the kind-dispatch the see-forms can't yet shape) — null when a
// matter has no space. No fact is laid in this file.

import { IBPA_RE } from "./portalOp.js";

const actHistoryOf = (ctx) => ctx?.moment?.actorAct?.history || ctx?.history || "0";

export function portalHostEnv() {
  return {
    // hasAddress(foreignAddress) -> the non-empty-string gate (the JS
    // `typeof foreignAddress !== "string" || !foreignAddress.length` refusal).
    "has-address": ({ args: [foreignAddress] }) =>
      typeof foreignAddress === "string" && foreignAddress.length > 0,

    // validAddress(foreignAddress) -> the foreign-IBPA shape match (the SAME
    // IBPA_RE the JS handler tests). Bounded compute; lays no fact.
    "valid-address": ({ args: [foreignAddress] }) =>
      typeof foreignAddress === "string" && IBPA_RE.test(foreignAddress),

    // resolveContainingSpace(target) -> the space the portal forms in: a space
    // target IS its own containing space; a matter target's containing space is
    // the matter's spaceId, read fresh via the SAME loadOrFold the JS handler
    // calls (a by-id matter load the see-forms can't yet shape). Returns null
    // when the matter has no space (the JS SPACE_NOT_FOUND refusal) or the target
    // is neither kind (the JS INVALID_INPUT refusal — both surface as the .word's
    // "cannot determine containing space" refuse, the INVALID_INPUT code shared).
    "resolve-containing-space": async ({ args: [target] }, ctx) => {
      const t = target && typeof target === "object" ? target : null;
      const kind = t?.kind;
      const id = t?.id != null ? String(t.id) : null;
      if (kind === "space") return id;
      if (kind === "matter") {
        const { loadOrFold } = await import("../../../materials/projections.js");
        const matterSlot = await loadOrFold("matter", id, actHistoryOf(ctx));
        return matterSlot?.state?.spaceId || null;
      }
      return null;
    },
  };
}
