// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// be.js — the BE verb. Identity operations on a being.
//
// Every being honors BE by default — register, claim, release, switch
// are the universal ones. Some beings add their own (auth's flows,
// llm-assigner's add-llm and slot ops, extension BE-beings like a
// court's convene / rule). The registry (materials/being/beRegistry.js)
// holds the per-being handlers; the seed pre-registers cherub and
// llm-assigner at module load below.
//
// operation:  "register" | "claim" | "release" | "switch" | <being-honored>
// payload:    operation-specific
//   register  { name, password, ... }
//   claim     { name, password }   (against the place's cherub)
//   claim     { }                  (re-claim a stance already held)
//   release   { }
//   switch    { from }             (target lives in opts.address)

import log from "../../seedReality/log.js";
import { emitFact } from "../../past/fact/facts.js";
import { IbpError, IBP_ERR } from "../protocol.js";
import { I_AM } from "../../materials/being/seedBeings.js";
import { getRealityDomain } from "../address.js";
import { authorize, getAuthConfig } from "../authorize.js";
import { cherubBeing } from "../../present/roles/cherub/role.js";
import { llmAssignerBeing } from "../../present/roles/llm-assigner/role.js";
import { registerBeHandler, getBeHandler } from "../../materials/being/beRegistry.js";
import { assertVerbCaller } from "./_shared.js";

// The two BE-honoring beings register at module load so the
// dispatcher below can find them. Extensions add their own through
// registerBeHandler.
registerBeHandler("cherub",       cherubBeing,       "seed");
registerBeHandler("llm-assigner", llmAssignerBeing,  "seed");

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

  // Register and claim are identity-acquisition: the caller is binding
  // to a being, so no being identity exists yet. Every other BE needs
  // an identified caller (or a scaffold flow). authorize() still
  // gates register/claim against the place-level flags below.
  if (operation !== "register" && operation !== "claim") {
    assertVerbCaller("be", opts);
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

  // Stance auth gates every BE call. register/claim from arrival is
  // the bootstrap exception — authorize permits it inherently.
  const decision = await authorize({
    identity,
    verb: "be",
    target: { kind: addressKind, value: address },
    operation,
  });
  if (!decision.ok) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      `BE denied for stance "${decision.stance}": ${decision.reason}`,
      { stance: decision.stance, operation },
    );
  }

  const ctx = { socket, address: { kind: addressKind, value: address }, identity, req, summonCtx };

  // All four canonical BE ops are session-binding, not being-method
  // dispatches. The address carries which identity is being bound /
  // unbound, not which being to talk to. They always run through the
  // cherub:
  //
  //   register  — admit a new identity, gated by register_enabled
  //   claim     — bind a session to an existing identity, gated by
  //               claim_enabled
  //   release   — drop the session's binding (stateless ack)
  //   switch    — confirm which identity the session now holds
  //
  // Without this routing, a client logging out as `<reality>/@tabor`
  // (or any non-cherub stance) would fall through to the "no being
  // handler for @tabor" rejection. release/switch don't care which
  // stance was addressed — they're about the session, not the being.
  if (
    operation === "register" ||
    operation === "claim" ||
    operation === "release" ||
    operation === "switch"
  ) {
    const authConfig = await getAuthConfig();
    if (operation === "register" && !authConfig.register_enabled) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "Registration is disabled on this reality", { operation });
    }
    if (operation === "claim" && !authConfig.claim_enabled) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "Claim is disabled on this reality", { operation });
    }
    let authResult;
    if (operation === "register") {
      authResult = await cherubBeing.register(payload, ctx);
    } else if (operation === "claim") {
      authResult = await runClaim({ kind: addressKind, value: address }, payload, ctx);
    } else if (operation === "release") {
      authResult = await cherubBeing.release(payload, ctx);
    } else {
      // switch — cherub.switch derives from/to from the address.
      const from = payload?.from;
      const to   = addressKind === "stance" ? address : null;
      authResult = await cherubBeing.switch({ from, to }, ctx);
    }
    await writeBeFact({
      operation,
      identity,
      authResult,
      payload,
      actId: summonCtx?.actId || null,
      summonCtx,
      scaffold: opts.scaffold === true,
    });
    return authResult;
  }

  // Everything else dispatches to the addressed being. Bare-place
  // addresses default to @cherub, the welcome character.
  const beingName = extractBeingFromAddress(address, addressKind) || "cherub";
  const role = getBeHandler(beingName);
  if (!role) {
    throw new IbpError(
      IBP_ERR.ROLE_UNAVAILABLE,
      `No being @${beingName} registered for BE operations on this reality`,
      { beingName },
    );
  }
  if (!role.honoredOperations.includes(operation)) {
    throw new IbpError(
      IBP_ERR.ACTION_NOT_SUPPORTED,
      `Being @${beingName} does not honor BE ${operation}`,
      { beingName, operation, honoredOperations: role.honoredOperations },
    );
  }

  // Auth's switch derives from/to from the address; everything else
  // dispatches via kebab-case op name → camelCase method on the role.
  let beResult;
  if (beingName === "cherub" && operation === "switch") {
    const from = payload.from;
    const to   = addressKind === "stance" ? address : null;
    beResult = await role.switch({ from, to }, ctx);
  } else {
    const methodName = kebabToCamel(operation);
    const method = role[methodName];
    if (typeof method !== "function") {
      throw new IbpError(
        IBP_ERR.INTERNAL,
        `Being @${beingName} declares BE "${operation}" but has no ${methodName}() handler`,
      );
    }
    beResult = await method.call(role, payload, ctx);
  }
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

/**
 * Two claim modes. Credentials: address is the place or
 * <reality>/@cherub, payload carries name + password. Token re-claim:
 * address is a stance already held by the session, identity carries a
 * valid token.
 */
async function runClaim(address, opPayload, ctx) {
  const isAuthBeingAddress =
    address.kind === "place" ||
    (address.kind === "stance" && /\/@cherub$/.test(address.value));

  if (isAuthBeingAddress) {
    return cherubBeing.claim(opPayload, ctx);
  }

  if (!ctx.identity) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "Token re-claim requires a still-valid identity token",
    );
  }
  const expectedStance = `${getRealityDomain()}/@${ctx.identity.name}`;
  if (address.value !== expectedStance) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      "Cannot re-claim a stance the session does not hold",
      { held: expectedStance, requested: address.value },
    );
  }
  return {
    identityToken: null,
    beingAddress:  expectedStance,
    note:          "already held",
  };
}

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
