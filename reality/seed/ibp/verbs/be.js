// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// be.js . the BE verb. Identity operations on a being.
//
// BE is a closed four-op set: birth, use, release, switch. The static
// table BE_OPS in [[ibp/beOps.js]] holds the schemas + handlers; this
// verb's job is to authorize, dispatch, and stamp the audit Fact.
//
// Cherub is the canonical being that handles BE. llm-assigner has six
// historical "honored operations" (add-llm, assign-slot, ...) that
// belong on DO, not BE; until that migration lands, those still flow
// through the legacy `beRegistry.getBeHandler` path below.
//
// Dispatch flow:
//
//   1. Resolve the target being from the address (bare place defaults
//      to @cherub, the welcome character).
//   2. If the op name is in BE_OPS, dispatch through the static table.
//      - assertVerbCaller unless the op is `bootstrap: true`.
//      - place-level flags (birth_enabled / connect_enabled) gate
//        birth / connect.
//      - authorize() the BE call.
//      - run BE_OPS[op].handler(...).
//      - writeBeFact stamps a `be:<op>` Fact on the actor's reel.
//   3. Otherwise fall through to legacy per-being dispatch (llm-assigner).

import log from "../../seedReality/log.js";
import { emitFact } from "../../past/fact/facts.js";
import { IbpError, IBP_ERR } from "../protocol.js";
import { I_AM } from "../../materials/being/seedBeings.js";
import { getRealityDomain } from "../address.js";
import { authorize, getAuthConfig } from "../authorize.js";
import { BE_OPS, getBeOp } from "../beOps.js";
import { registerBeHandler, getBeHandler } from "../../materials/being/beRegistry.js";
import { assertVerbCaller } from "./_shared.js";

// llm-assigner has not yet migrated to DO ops; keep its legacy
// `honoredOperations` + per-being method dispatch through beRegistry.
// Cherub's static export (cherubBeing) is no longer needed here . its
// handlers live behind BE_OPS now.
import { llmAssignerBeing } from "../../present/roles/llm-assigner/role.js";

registerBeHandler("llm-assigner", llmAssignerBeing, "seed");

/**
 * BE. Run an identity operation. Returns the operation's result
 * (typically `{ identityToken, beingAddress, ... }` for auth flows).
 *
 * opts:
 *   address      stance or place string the BE call addresses
 *   addressKind  "stance" | "place"
 *   identity     authenticated identity (required for release/switch)
 *   socket       optional WS socket passed through to auth hooks
 *   req          optional Express req for HTTP-arrival flows
 *   currentReality  defaults to this place
 *   summonCtx    moment context (so the audit Fact joins ctx.deltaF)
 *   scaffold     boot/scaffold bypass
 */
export async function beVerb(operation, payload = {}, opts = {}) {
  if (typeof operation !== "string" || !operation.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "reality.be requires an operation");
  }

  const {
    address     = null,
    addressKind = null,
    identity    = null,
    socket      = null,
    req         = null,
    currentReality = null,
    summonCtx   = null,
  } = opts;

  const realityDomain = currentReality || getRealityDomain();

  // Address must point at this reality.
  const targetReality = extractRealityFromAddress(address, addressKind);
  if (targetReality && targetReality !== realityDomain) {
    throw new IbpError(
      IBP_ERR.SPACE_NOT_FOUND,
      `Reality "${targetReality}" is not served by this server`,
      { targetReality, serverReality: realityDomain },
    );
  }

  // Bare-place address defaults to @cherub, the welcome character.
  const beingName = extractBeingFromAddress(address, addressKind) || "cherub";

  // Static-table dispatch. BE_OPS holds the canonical four ops; if the
  // operation name is in the table AND cherub is the resolved being,
  // dispatch through it. Future seed change could license other beings
  // for these ops, but cherub is the only one today.
  const beOp = getBeOp(operation);

  if (beOp && beingName === "cherub") {
    // The op opts out of the verb-caller assertion when bootstrap is
    // true (birth/connect from a fresh arrival have no identity yet).
    if (!beOp.bootstrap) {
      assertVerbCaller("be", opts);
    }

    // Place-level flags gate birth and connect.
    if (operation === "birth" || operation === "connect") {
      const authConfig = await getAuthConfig();
      if (operation === "birth" && !authConfig.birth_enabled) {
        throw new IbpError(IBP_ERR.FORBIDDEN, "Registration is disabled on this reality", { operation });
      }
      if (operation === "connect" && !authConfig.connect_enabled) {
        throw new IbpError(IBP_ERR.FORBIDDEN, "Connect is disabled on this reality", { operation });
      }
    }

    const decision = await authorize({
      identity,
      verb: "be",
      target: { kind: addressKind, value: address },
      operation,
      summonCtx,
    });
    if (!decision.ok) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `BE denied for stance "${decision.stance}": ${decision.reason}`,
        { stance: decision.stance, operation },
      );
    }

    const result = await beOp.handler({
      address,
      addressKind,
      payload,
      identity,
      ctx: { socket, address: { kind: addressKind, value: address }, identity, req, summonCtx },
      summonCtx,
    });
    await writeBeFact({
      operation,
      identity,
      authResult: result,
      payload,
      beingName,
      actId: summonCtx?.actId || null,
      summonCtx,
      scaffold: opts.scaffold === true,
    });
    return result;
  }

  // ── Legacy per-being dispatch ──
  // Everything not yet migrated to the registry (currently
  // llm-assigner's six honored ops) still flows through
  // beRegistry.getBeHandler → method-on-role. This path retires when
  // llm-assigner migrates.

  assertVerbCaller("be", opts);

  const decision = await authorize({
    identity,
    verb: "be",
    target: { kind: addressKind, value: address },
    operation,
    summonCtx,
  });
  if (!decision.ok) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      `BE denied for stance "${decision.stance}": ${decision.reason}`,
      { stance: decision.stance, operation },
    );
  }

  const role = getBeHandler(beingName);
  if (!role) {
    throw new IbpError(
      IBP_ERR.ROLE_UNAVAILABLE,
      `No being @${beingName} registered for BE operations on this reality`,
      { beingName },
    );
  }
  if (!role.honoredOperations?.includes(operation)) {
    throw new IbpError(
      IBP_ERR.ACTION_NOT_SUPPORTED,
      `Being @${beingName} does not honor BE ${operation}`,
      { beingName, operation, honoredOperations: role.honoredOperations || [] },
    );
  }

  const ctx = { socket, address: { kind: addressKind, value: address }, identity, req, summonCtx };
  const methodName = kebabToCamel(operation);
  const method = role[methodName];
  if (typeof method !== "function") {
    throw new IbpError(
      IBP_ERR.INTERNAL,
      `Being @${beingName} declares BE "${operation}" but has no ${methodName}() handler`,
    );
  }
  const beResult = await method.call(role, payload, ctx);
  await writeBeFact({
    operation,
    identity,
    authResult: beResult,
    payload,
    beingName,
    actId: summonCtx?.actId || null,
    summonCtx,
    scaffold: opts.scaffold === true,
  });
  return beResult;
}

// ─────────────────────────────────────────────────────────────────────
// PRIVATE
// ─────────────────────────────────────────────────────────────────────

/**
 * One Fact per BE op, same as DO. The actor is the calling identity;
 * register/claim from arrival has none, so the row names the newly-
 * bound being from authResult. The wire layer routes BE through
 * cherub-as-actor so the actId is always present; the only escape
 * is boot scaffolding, which sets scaffold=true. The guard throws
 * before emitFact runs — an act without a frame doesn't get a Fact,
 * and a BE without a Fact didn't happen.
 */
async function writeBeFact({ operation, identity, authResult, payload, beingName = "cherub", actId = null, summonCtx = null, scaffold = false }) {
  // Post-refactor: scaffold:true no longer implies "commit as a
  // singleton outside any moment." Callers must thread a summonCtx
  // (boot moment from withBootMoment, or a runtime moment). Without
  // an actId the Fact would orphan; throw rather than silently commit.
  if (!actId) {
    throw new IbpError(
      IBP_ERR.INTERNAL,
      `BE ${operation} @${beingName}: missing ambient actId. Thread summonCtx from the caller's moment (runtime), or open a boot moment via withBootMoment(...) (genesis). scaffold:true alone is no longer sufficient.`,
      { operation, beingName },
    );
  }
  let actorBeingId = identity?.beingId || null;
  if (!actorBeingId && authResult && typeof authResult === "object") {
    actorBeingId = authResult.userId || authResult.beingId || null;
  }
  if (!actorBeingId) actorBeingId = I_AM;

  const safeResult = authResult && typeof authResult === "object"
    ? { beingAddress: authResult.beingAddress || null, note: authResult.note || null }
    : null;

  const safeParams = payload && typeof payload === "object"
    ? { name: payload.name || null, from: payload.from || null }
    : null;

  await emitFact({
    verb:    "be",
    action:  operation,
    beingId: actorBeingId,
    target:  authResult?.beingAddress
      ? { kind: "stance", id: String(authResult.beingAddress) }
      : { kind: "being",  id: String(actorBeingId) },
    params:  safeParams,
    result:  safeResult,
    actId,
  }, summonCtx);
}

// (runClaim retired . both modes (credentials, token re-claim) now
//  live inside the `use` handler in cherub/role.js.)

// Pull the reality prefix off an address, if any. Lets beVerb refuse
// addresses pointing at a different reality before any auth runs.
function extractRealityFromAddress(address, addressKind) {
  if (typeof address !== "string" || !address.length) return null;
  if (addressKind === "place") return address;
  const slashIndex = address.indexOf("/");
  if (slashIndex === -1) return address;
  return address.slice(0, slashIndex);
}

// Pull the @qualifier off a stance address — the being-name beVerb
// dispatches to.
function extractBeingFromAddress(address, addressKind) {
  if (addressKind !== "stance" || typeof address !== "string") return null;
  const m = address.match(/@([a-z][a-z0-9-]*)$/i);
  return m ? m[1].toLowerCase() : null;
}

// kebab-case → camelCase for op → method name dispatch on the BE
// being's role. e.g. "add-llm-connection" → "addLlmConnection".
function kebabToCamel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
