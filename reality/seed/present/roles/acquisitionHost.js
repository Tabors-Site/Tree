// acquisitionHost.js — host-escape glue for the acquisition ops (take-role, ask-role).
// Wires the SAME primitives the JS handlers call into ctx.env.host: the role-spec
// lookup, the take/asked policies, the already-holds check, the grant-role emit, and
// the queue-path owner summon. No reimplementation — only the env adapter the `.word`
// reaches through `host:` escapes (the strand the cut deletes). callHost invokes each as
// `fn({ args }, ctx)`; the write op reads ctx.summonCtx to lay its fact into the live
// moment.
import { getRoleSpecForGrant } from "./spaceLookup.js";
import { normalizeAcquisition, alreadyHoldsRole } from "./acquisition.js";
import { loadOrFold } from "../../materials/projections.js";
import { emitInternalGrant } from "./acquisitionOps.js";

const branchOf = (ctx) => ctx?.summonCtx?.actorAct?.branch || ctx?.branch || "0";

export function acquisitionHostEnv() {
  return {
    // the role spec + the anchor space where it was found, or null when not installed.
    "role-spec-for-grant": async ({ args: [role, space] }, ctx) => {
      const { spec, hostSpaceId } = await getRoleSpecForGrant(
        { role: String(role || "").trim(), anchorSpaceId: String(space || "").trim() },
        branchOf(ctx),
      );
      return spec ? { spec, anchor: hostSpaceId, role: String(role).trim() } : null;
    },
    // the take policy: is the role walk-in acquirable (acquisition.grabbed)?
    "is-grabbable": ({ args: [found] }) => !!normalizeAcquisition(found?.spec).grabbed,
    // the asked policy: the raw asked value ("auto" | "queue" | false) the §9 Match
    // dispatches on. false flows back to the .word as a falsy flag -> "not ask-acquirable".
    "asked-policy": ({ args: [found] }) => normalizeAcquisition(found?.spec).asked,
    // does the caller already hold this role at this anchor? (idempotency)
    "already-holds": async ({ args: [caller, role, found] }, ctx) => {
      const slot = await loadOrFold("being", String(caller), branchOf(ctx));
      const existing = slot?.state?.qualities?.rolesGranted || [];
      return alreadyHoldsRole(existing, String(role), found?.anchor);
    },
    // the lone WORLD fact (auto path): the internal grant-role emit into the live moment.
    grantInternal: async ({ args: [caller, role, found] }, ctx) => {
      await emitInternalGrant({
        granteeBeingId: String(caller),
        role:           String(role),
        anchorSpaceId:  found?.anchor,
        grantedBy:      String(caller),
        summonCtx:      ctx?.summonCtx || null,
        branch:         branchOf(ctx),
      });
      return true;
    },
    // the queue path: summon the host's owner with intent "role-request" so they
    // approve by hand. The SAME loadOrFold / summonVerb / getRealityDomain the JS
    // handler calls — no reimplementation. A SUMMON is a transport delivery, not a
    // substrate fact, so it stays a host: escape (like cherub-connect's session ops).
    // Returns { message } the .word's §7 return surfaces (the no-owner / send-failure /
    // requested cases each carry their own message, verbatim from the JS handler).
    // owner-of(found) -> the OWNER BEING of the role's anchor space (a read; the queue
    // path reaches them). null when the anchor space has no owner.
    "owner-of": async ({ args: [found] }, ctx) => {
      const branch = branchOf(ctx);
      const hostSlot = await loadOrFold("space", String(found?.anchor), branch);
      const ownerId = hostSlot?.state?.owner;
      if (!ownerId) return null;
      return await loadOrFold("being", String(ownerId), branch);
    },
    // role-request(role, found, caller) -> the request payload the owner's inbox receives
    // (a pure compute, no fact). Byte-identical to the prior content build, so the asker
    // stays identified in the content even when the call envelope's `from` is ctx.identity.
    "role-request": async ({ args: [role, found, caller] }, ctx) => {
      const branch = branchOf(ctx);
      const askerSlot = await loadOrFold("being", String(caller), branch);
      return {
        role:          String(role),
        anchorSpaceId: found?.anchor,
        askerBeingId:  String(caller),
        askerName:     askerSlot?.state?.name,
        reason:        null,
      };
    },
  };
}
