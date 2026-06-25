// acquisitionHost.js — host-escape glue for the acquisition ops (take-able, ask-able).
// Wires the floor primitives into ctx.env.host: the able-spec lookup, the take/asked
// policies, the already-holds check, the grant-record BUILD, and the queue-path owner read.
// No reimplementation — only the env adapter the `.word` reaches through `see` escapes.
// callHost invokes each as `fn({ args }, ctx)`.
//
// Both ops are WORD-SOLE (handler-less; do.js's runOpWord runs their `.word`). take-able runs
// CALLER-mode (the taker IS the actor). ask-able declares `word.through:true` — HOST-FACILITATED:
// its queue path `call`s the host owner with intent "able-request", and that summon must come FROM
// i-am (I-authority), because a fresh asker holds no able permitting a summon and would be
// correctly denied. through-mode runs ask-able.word THROUGH the caller (being-mode, identity name
// = i-am), so the `call` authorizes as I; the asker rides in the inbox CONTENT (able-request), not
// the call's `from`. The op's own auth and the do:ask-able attribution still use the real caller.
//
// The grant does NOT self-emit: `grant-internal` is a `see` (a pure compute, NO fact) that
// BUILDS the grant record (buildInternalGrant: the SAME {able, anchor, grantedBy} the reducer
// folds). No grantedAt: a grant's when is the chain position of its fact (seq), not a clock.
// The `.word` returns it as factParams
// and the dispatcher's ONE auto-Fact lays the caller-attributed do:ask-able / do:take-able.
import { getAbleSpecForGrant } from "../../../present/ables/spaceLookup.js";
import { normalizeAcquisition, alreadyHoldsAble } from "../../../present/ables/acquisition.js";
import { loadOrFold } from "../../../materials/projections.js";
import { buildInternalGrant } from "../../../present/ables/internalGrant.js";

const historyOf = (ctx) => ctx?.moment?.actorAct?.history || ctx?.history || "0";

export function acquisitionHostEnv() {
  return {
    // the able spec + the anchor space where it was found, or null when not installed.
    "able-spec-for-grant": async ({ args: [able, space] }, ctx) => {
      const { spec, hostSpaceId } = await getAbleSpecForGrant(
        { able: String(able || "").trim(), anchorSpaceId: String(space || "").trim() },
        historyOf(ctx),
      );
      return spec ? { spec, anchor: hostSpaceId, able: String(able).trim() } : null;
    },
    // the take policy: is the able walk-in acquirable (acquisition.grabbed)?
    "is-grabbable": ({ args: [found] }) => !!normalizeAcquisition(found?.spec).grabbed,
    // the asked policy: the raw asked value ("auto" | "queue" | false) the §9 Match
    // dispatches on. false flows back to the .word as a falsy flag -> "not ask-acquirable".
    "asked-policy": ({ args: [found] }) => normalizeAcquisition(found?.spec).asked,
    // does the caller already hold this able at this anchor? (idempotency)
    "already-holds": async ({ args: [caller, able, found] }, ctx) => {
      const slot = await loadOrFold("being", String(caller), historyOf(ctx));
      const existing = slot?.state?.qualities?.ablesGranted || [];
      return alreadyHoldsAble(existing, String(able), found?.anchor);
    },
    // the grant record (auto / grabbed path): a pure compute, NO fact. Builds the SAME
    // {able, anchorSpaceId, anchorBeingId, grantedBy} the reducer folds (no grantedAt: the
    // grant's when is its fact's chain seq, not a clock), returned FLAT so the .word's Return
    // reads $granted.able / .anchorSpaceId / .anchorBeingId / .grantedBy straight
    // into factParams. The dispatcher's ONE auto-Fact lays the caller-attributed
    // do:grant-able from those params — the op no longer self-emits.
    "grant-internal": ({ args: [caller, able, found] }) => {
      const { granteeBeingId, grant } = buildInternalGrant({
        granteeBeingId: String(caller),
        able:           String(able),
        anchorSpaceId:  found?.anchor,
        grantedBy:      String(caller),
      });
      return { granteeBeingId, ...grant };
    },
    // the queue path: summon the host's owner with intent "able-request" so they
    // approve by hand. The SAME loadOrFold / callVerb / getStoryDomain the JS
    // handler calls — no reimplementation. A SUMMON is a transport delivery, not a
    // substrate fact, so it stays a host: escape (like cherub-connect's session ops).
    // Returns { message } the .word's §7 return surfaces (the no-owner / send-failure /
    // requested cases each carry their own message, verbatim from the JS handler).
    // owner-of(found) -> the OWNER BEING of the able's anchor space (a read; the queue
    // path reaches them). null when the anchor space has no owner.
    "owner-of": async ({ args: [found] }, ctx) => {
      const history = historyOf(ctx);
      const hostSlot = await loadOrFold("space", String(found?.anchor), history);
      const ownerId = hostSlot?.state?.owner;
      if (!ownerId) return null;
      return await loadOrFold("being", String(ownerId), history);
    },
    // able-request(able, found, caller) -> the request payload the owner's inbox receives
    // (a pure compute, no fact). Byte-identical to the prior content build, so the asker
    // stays identified in the content even when the call envelope's `from` is ctx.identity.
    "able-request": async ({ args: [able, found, caller] }, ctx) => {
      const history = historyOf(ctx);
      const askerSlot = await loadOrFold("being", String(caller), history);
      return {
        able:          String(able),
        anchorSpaceId: found?.anchor,
        askerBeingId:  String(caller),
        askerName:     askerSlot?.state?.name,
        reason:        null,
      };
    },
  };
}
