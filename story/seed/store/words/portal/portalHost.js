// portalHost.js — host-escape glue for portal.word (the form-portal DO op,
// portalOp.js). Wires the SAME primitives the JS handler imports into
// ctx.env.host so the `.word` reaches the real work with ZERO reimplementation;
// only the orchestration glue lives here, the strand the cut deletes.
//
// callHost invokes each builtin as `fn({ args: [...] }, ctx)` (the parser emits
// `host: fn(a, b) as c` -> params:{ args:["$a","$b"] }). hasAddress / validAddress
// are pure shape checks (no fact). resolveContainingSpace is a by-id matter load
// (the kind-dispatch the see-forms can't shape, no fact). createPortalMatter is
// the LONE WORLD fact: it content-addresses the row id from the birth spec with
// the SAME matterContentId, then lays the SAME do:create-matter fact the JS
// handler emits via the SAME emitFact. It attributes to the CALLER (the portal is
// born BY the actor; qualities.portal.createdBy = the actor) and lands on the real
// moment, so it reads ctx.moment rather than being a plain do-act the bridge
// would re-attribute to I_AM. See the cut-spec note.

import { emitFact } from "../../../past/fact/facts.js";
import { IBPA_RE } from "./portalOp.js";
import { matterContentId } from "../../../materials/matter/matterId.js";

const actHistoryOf = (ctx) => ctx?.moment?.actorAct?.history || ctx?.history || "0";
// The fact-landing history: same precedence the JS handler uses for the emit
// (targetHistory before the actor's history), so a cross-story inbound moment
// lands the portal on the target's history.
const factHistoryOf = (ctx) =>
  ctx?.moment?.targetHistory || ctx?.moment?.actorAct?.history || ctx?.history || "0";

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

    // createPortalMatter(caller, spaceId, foreignAddress, name) -> the LONE WORLD
    // fact. Builds the SAME create spec the JS handler builds (type "ibpa",
    // content {target}, qualities.portal provenance with createdBy = the actor),
    // content-addresses the row id from it with the SAME matterContentId, and lays
    // the SAME do:create-matter fact via the SAME emitFact. Attributes to the
    // CALLER (through = the actor), reads the real moment for actId + the
    // fact-landing history. Returns { matterId } the .word's §7 return surfaces.
    createPortalMatter: async ({ args: [caller, spaceId, foreignAddress, name] }, ctx) => {
      const sc = ctx?.moment || null;
      const actorBeingId = String(caller);
      const createSpec = {
        spaceId: String(spaceId),
        beingId: actorBeingId,
        type: "ibpa",
        content: { target: foreignAddress },
        name: name || `portal → ${foreignAddress}`,
        parentMatterId: null,
        qualities: {
          portal: {
            target: foreignAddress,
            createdBy: actorBeingId,
          },
        },
      };
      const matterId = matterContentId(createSpec);
      await emitFact(
        {
          verb: "do",
          act: "create-matter",
          through: actorBeingId,
          of: { kind: "matter", id: matterId },
          params: createSpec,
          actId: sc?.actId || null,
          history: factHistoryOf(ctx),
        },
        sc,
      );
      return { matterId, spaceId: String(spaceId), target: foreignAddress };
    },
  };
}
