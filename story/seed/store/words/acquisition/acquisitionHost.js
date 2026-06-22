// acquisitionHost.js — host-escape glue for the acquisition ops (take-able, ask-able).
// Wires the SAME primitives the JS handlers call into ctx.env.host: the able-spec
// lookup, the take/asked policies, the already-holds check, the grant-record BUILD, and
// the queue-path owner summon. No reimplementation — only the env adapter the `.word`
// reaches through `see`/`host:` escapes. callHost invokes each as `fn({ args }, ctx)`.
//
// The grant no longer self-emits: `grant-internal` is a `see` builtin (a pure compute,
// NO fact) that BUILDS the grant record (buildInternalGrant — the SAME {able, anchor,
// grantedBy, grantedAt} the reducer folds, grantedAt at the wall-clock floor). The
// `.word` returns it as factParams and the dispatcher's ONE auto-Fact lays the caller-
// attributed do:grant-able. The queue path's owner summon stays a host escape (a SUMMON
// is a transport delivery, not a substrate fact).
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
    // {able, anchorSpaceId, anchorBeingId, grantedBy, grantedAt} the reducer folds
    // (grantedAt at the wall-clock floor), returned FLAT so the .word's Return reads
    // $granted.able / .anchorSpaceId / .anchorBeingId / .grantedBy / .grantedAt straight
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
