// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// be.js . the BE verb. Identity operations on a being.
//
// BE is the closed three-op set: birth, connect, release. The static
// table BE_OPS in [ibp/beOps.js](../beOps.js) holds the schemas +
// handlers; this verb's job is to authorize, dispatch, and stamp the
// audit Fact. Cherub is the canonical handler.
//
// Dispatch flow:
//
//   1. Resolve the target being from the address (bare place defaults
//      to @cherub, the welcome character).
//   2. Look up the op in BE_OPS. Unknown op = ACTION_NOT_SUPPORTED.
//      . assertVerbCaller unless the op is `bootstrap: true`.
//      . place-level flags (birth_enabled / connect_enabled) gate
//        birth / connect.
//      . authorize() the BE call.
//      . run BE_OPS[op].handler(...).
//      . writeBeFact stamps a `be:<op>` Fact on the actor's reel.
//
// The branches above (birther's BE:birth, release on non-cherub,
// connect on non-cherub) all route through the same BE_OPS handlers
// once the auth gate runs. Cherub's handler discriminates on the
// address inside, so birther-as-target and arbitrary-being-as-target
// reach the same code path.

import log from "../../seedReality/log.js";
import Being from "../../materials/being/being.js";
import { emitFact } from "../../past/fact/facts.js";
import { IbpError, IBP_ERR } from "../protocol.js";
import { I_AM } from "../../materials/being/seedBeings.js";
import { getRealityDomain } from "../address.js";
import { authorize, getAuthConfig } from "../authorize.js";
import { BE_OPS, getBeOp } from "../beOps.js";
import { assertVerbCaller, refuseHistoricalWrite, resolveBranchForFact } from "./_shared.js";

/**
 * BE. Run an identity operation. Returns the operation's result
 * (typically `{ identityToken, beingAddress, ... }` for auth flows).
 *
 * opts:
 *   address      stance or place string the BE call addresses
 *   addressKind  "stance" | "place"
 *   identity     authenticated identity (required for release)
 *   socket       optional WS socket passed through to auth hooks
 *   req          optional Express req for HTTP-arrival flows
 *   currentReality  defaults to the current reality domain (getRealityDomain)
 *   summonCtx    moment context (so the audit Fact joins ctx.deltaF)
 *   scaffold     boot/scaffold bypass
 */
export async function beVerb(operation, payload = {}, opts = {}) {
  if (typeof operation !== "string" || !operation.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "reality.be requires an operation");
  }
  refuseHistoricalWrite("be", payload, opts);

  const {
    address     = null,
    addressKind = null,
    identity    = null,
    socket      = null,
    req         = null,
    currentReality = null,
    currentBranch  = null,
    summonCtx   = null,
  } = opts;

  // Resolve branch ONCE at the entry. summonCtx.branch wins when we're
  // inside an existing moment (continuation); otherwise the wire-
  // attached opts.currentBranch carries it. resolveBranchForFact throws
  // MISSING_BRANCH if both are absent — surfaces a perimeter threading
  // gap loud instead of silently defaulting to heaven. All downstream
  // sites (loadProjection lookups, writeBeFact emissions) use this
  // value rather than re-resolving from scope.
  const branch = resolveBranchForFact(summonCtx, currentBranch, "be");

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

  // Static-table dispatch. BE_OPS holds the canonical three ops
  // (birth/connect/release); if the operation name is in the table AND
  // cherub is the resolved being, dispatch through it. Future seed
  // change could license other beings for these ops, but cherub is the
  // only one today.
  const beOp = getBeOp(operation);

  // ── Birther path (BE:birth on @birther). ────────────────────────
  // Cherub serves unauthenticated arrival: someone with no identity
  // calls BE:birth on @cherub to register a fresh being on this
  // reality (parent = cherub or I-Am for the first registrant).
  //
  // Birther serves authenticated callers: an existing being calls
  // BE:birth on @birther to mint a CHILD. The new being's being-tree
  // parent is the caller, not birther. Same BE op, different target,
  // different parent semantics. See seed/present/roles/birther/role.js.
  if (operation === "birth" && beingName === "birther") {
    assertVerbCaller("be", opts);
    if (!identity?.beingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "BE:birth via @birther requires an authenticated caller");
    }
    const authConfig = await getAuthConfig();
    if (!authConfig.birth_enabled) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "Birth is disabled on this reality");
    }
    // Auth gate (the standard rule is be:create-being via the place-
    // root default, which admits all authenticated callers; per-position
    // rules can tighten).
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
        `BE:birth denied for stance "${decision.stance}": ${decision.reason}`,
        { stance: decision.stance },
      );
    }

    // Mint the child. Spec carries the caller-supplied name + optional
    // cognition/role/password; parentBeingId is the caller's beingId.
    //
    // Home policy: the child's homeSpace defaults to the CALLER's
    // homeSpace (move-in, no new space minted). Operators can move the
    // child later via set-being:homeSpace once a per-being-settings UI
    // lands. Override at mint-time via payload.homeSpace (existing
    // space) or payload.homeParent (mint a new sub-space).
    const childName = payload?.name;
    const childCognition = payload?.cognition || "llm";  // substrate default
    const childPassword  = payload?.password || null;
    const childRoleField = payload?.role || payload?.defaultRole || null;
    // Initial roleFlow: when the operator wants the child born with a
    // configured behavioral program (the spec's Step 5 birther flow:
    // "Set initial roleFlow. Set initial cognition."). Accepts either
    // a parsed array or a JSON string; createBeing's qualities
    // pipeline lands it at qualities.roleFlow.
    let childRoleFlow = null;
    if (Array.isArray(payload?.roleFlow)) {
      childRoleFlow = payload.roleFlow;
    } else if (typeof payload?.roleFlow === "string" && payload.roleFlow.trim()) {
      try { childRoleFlow = JSON.parse(payload.roleFlow); }
      catch (e) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `BE:birth: roleFlow must be a valid JSON array (parse error: ${e.message})`,
        );
      }
      if (!Array.isArray(childRoleFlow)) {
        throw new IbpError(IBP_ERR.INVALID_INPUT,
          "BE:birth: roleFlow must be an array of clauses");
      }
    }
    if (!childName || typeof childName !== "string") {
      throw new IbpError(IBP_ERR.INVALID_INPUT, "BE:birth requires payload.name");
    }

    let childHomeSpace  = payload?.homeSpace  || null;
    let childHomeParent = payload?.homeParent || null;
    if (!childHomeSpace && !childHomeParent) {
      // Default: move the child into the caller's home. No new space.
      const { loadProjection } = await import("../../materials/projections.js");
      const callerSlot = await loadProjection("being", identity.beingId, branch);
      childHomeSpace = callerSlot?.state?.homeSpace ? String(callerSlot.state.homeSpace) : null;
    }
    if (!childHomeSpace && !childHomeParent) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "BE:birth requires a homeSpace or homeParent (caller has no homeSpace to inherit)",
      );
    }

    const { birthBeing } = await import("../../materials/being/identity/birth.js");
    const childSpec = {
      name:          childName,
      cognition:     childCognition,
      password:      childPassword,
      parentBeingId: String(identity.beingId),
    };
    if (childHomeSpace)  childSpec.homeSpace  = childHomeSpace;
    if (childHomeParent) childSpec.homeParent = childHomeParent;
    if (childRoleField)  childSpec.role       = childRoleField;
    if (childRoleFlow)   childSpec.roleFlow   = childRoleFlow;

    const result = await birthBeing({
      spec: childSpec,
      identity,
      summonCtx,
      scaffold: opts.scaffold === true,
    });
    // ONE fact per birth. birthBeing already stamped `be:birth` on the
    // new being's reel with parentBeingId=<caller> in the spec. No
    // separate caller-side audit fact . the parent pointer lives on
    // the birth fact already, and findCreatorOf walks it. Mirrors the
    // be:summon-create collapse from 2026-06-03.
    return {
      beingId:      result.beingId,
      name:         result.name,
      beingAddress: `${getRealityDomain()}/@${result.name}`,
    };
  }

  // ── Release on a non-cherub being. ──────────────────────────────
  // The inheriter tab's pagehide fires BE:release on its own stance
  // (e.g. `<reality>/@puppet`) to clear inhabitedBy. Cherub's release
  // handler is a no-op (the token is a stateless JWT; the connection
  // reducer derives qualities.connection.inhabitedBy from the fact
  // stream). We route this through cherub's release handler so the
  // writeBeFact below stamps a be:release fact on the target's reel
  // and the connection-tracking reducer clears the inhabitedBy
  // projection. Without this branch the call would land in the
  // closed-set tail and throw ROLE_UNAVAILABLE.
  if (operation === "release" && beingName !== "cherub") {
    assertVerbCaller("be", opts);
    if (!identity?.beingId) {
      throw new IbpError(IBP_ERR.UNAUTHORIZED, "release requires an authenticated caller");
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
        `BE:release denied for stance "${decision.stance}": ${decision.reason}`,
        { stance: decision.stance },
      );
    }
    const cherubReleaseOp = getBeOp("release");
    const result = cherubReleaseOp
      ? await cherubReleaseOp.handler({ address, addressKind, payload, identity,
          ctx: { socket, address: { kind: addressKind, value: address }, identity, req, summonCtx },
          summonCtx })
      : { released: true };
    await writeBeFact({
      operation,
      identity,
      authResult: result,
      payload,
      beingName,
      actId: summonCtx?.actId || null,
      summonCtx,
      branch,
      scaffold: opts.scaffold === true,
    });
    return result;
  }

  // ── Inhabit-connect path. ───────────────────────────────────────
  // BE:connect on a non-cherub being. Cherub's handler implements the
  // inhabit auth path (Mode 3: caller is authenticated AND target is
  // a descendant on the being-tree → skip password, issue token for
  // the target). Dispatch order: birther's birth path is checked
  // above; here we route connect-to-any-being through cherub's handler
  // so Mode 3 is reachable. Cherub's handler discriminates on the
  // address (cherub vs other) and runs the right mode.
  if (operation === "connect" && beingName !== "cherub") {
    assertVerbCaller("be", opts);
    const authConfig = await getAuthConfig();
    if (!authConfig.connect_enabled) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "Connect is disabled on this reality");
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
        `BE:connect denied for stance "${decision.stance}": ${decision.reason}`,
        { stance: decision.stance },
      );
    }
    const cherubConnectOp = getBeOp("connect");
    if (!cherubConnectOp) {
      throw new IbpError(IBP_ERR.INTERNAL, "connect op not registered");
    }
    const result = await cherubConnectOp.handler({
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
      branch,
      scaffold: opts.scaffold === true,
    });
    return result;
  }

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
      branch,
      scaffold: opts.scaffold === true,
    });
    return result;
  }

  // No dispatch matched. BE is the closed birth/connect/release set;
  // unknown ops throw ACTION_NOT_SUPPORTED. Known ops against a being
  // that's neither cherub nor birther (and so didn't hit the branches
  // above) throw ROLE_UNAVAILABLE.
  if (!beOp) {
    throw new IbpError(
      IBP_ERR.ACTION_NOT_SUPPORTED,
      `BE op "${operation}" is not in the closed set (birth, connect, release)`,
      { operation, available: Object.keys(BE_OPS) },
    );
  }
  throw new IbpError(
    IBP_ERR.ROLE_UNAVAILABLE,
    `No being @${beingName} handles BE ${operation} on this reality`,
    { beingName, operation },
  );
}

// ─────────────────────────────────────────────────────────────────────
// PRIVATE
// ─────────────────────────────────────────────────────────────────────

/**
 * One Fact per BE op, same as DO. The actor is the calling identity;
 * birth/connect from arrival has none, so the row names the newly-
 * bound being from authResult. The wire layer routes BE through
 * cherub-as-actor so the actId is always present; the only escape
 * is boot scaffolding, which sets scaffold=true. The guard throws
 * before emitFact runs — an act without a frame doesn't get a Fact,
 * and a BE without a Fact didn't happen.
 */
async function writeBeFact({ operation, identity, authResult, payload, beingName = "cherub", actId = null, summonCtx = null, branch, scaffold = false }) {
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

  // Target selection. BE = identity acting on itself; the fact's
  // target is always a being (the actor's own identity, or the
  // specific being whose identity is being changed). Stance targets
  // retired 2026-06-03 in favor of the runtime invariant
  // BEING_ONLY_TARGET_VERBS in facts.js.
  //
  //   connect: target = the being being connected to (authResult.beingId
  //            for cherub credential / inherit paths; identity.beingId
  //            for re-claim where the user re-asserts their own session).
  //   release: target = the being being released (identity.beingId — the
  //            caller IS the one releasing their own connection).
  //   birth / other: target = the actor's own being (self-act).
  //            authResult.beingAddress is recorded in `result` for
  //            audit, not as the target shape.
  let target;
  let connectionParams = null;
  if (operation === "connect") {
    const targetBeingId = authResult?.beingId || identity?.beingId || actorBeingId;
    target = { kind: "being", id: String(targetBeingId) };
    // inhabitedBy = the identity now driving this being. For
    // credential-connect (cherub binding fresh auth), this is the
    // being itself (self-connect). For inherit-connect, this is the
    // caller (parent driving child).
    const driverId = identity?.beingId
      ? String(identity.beingId)
      : String(targetBeingId);
    connectionParams = { inhabitedBy: driverId };
  } else if (operation === "release") {
    // The caller is releasing themselves. Target = caller's being so
    // the fact lands on that being's reel and clears inhabitedBy.
    const targetBeingId = identity?.beingId || actorBeingId;
    target = { kind: "being", id: String(targetBeingId) };
    connectionParams = { inhabitedBy: null };
  } else {
    // birth and any future BE op: identity-on-self. The actor's own
    // being is the target.
    target = { kind: "being", id: String(actorBeingId) };
  }

  const mergedParams = connectionParams
    ? { ...(safeParams || {}), ...connectionParams }
    : safeParams;

  await emitFact({
    verb:    "be",
    action:  operation,
    beingId: actorBeingId,
    target,
    params:  mergedParams,
    result:  safeResult,
    actId,
    // Branch the BE fact lands on, pre-resolved by beVerb at the
    // entry point. writeBeFact trusts the value rather than
    // re-resolving from a scope that may not have currentBranch
    // (this function ran as nested-helper-with-implicit-closure
    // before B perimeter hardening; missing-branch surfaced as a
    // ReferenceError only when an actual transport-act fired).
    branch,
  }, summonCtx);
}

// (runClaim retired . both modes (credentials, token re-claim) now
//  live inside the `use` handler in cherub/role.js.)

// Pull the reality prefix off an address, if any. Lets beVerb refuse
// addresses pointing at a different reality before any auth runs.
//
// Strips the optional `#<branch>` qualifier and any `@<being>` so the
// comparison against `getRealityDomain()` (just the DNS name) is
// apples-to-apples. Without stripping `#`, addresses like
// `treeos.ai#1/@cherub` would compare `"treeos.ai#1"` against
// `"treeos.ai"` and falsely report a cross-reality call.
function extractRealityFromAddress(address, addressKind) {
  if (typeof address !== "string" || !address.length) return null;
  // For "place" addresses there's no path-separator slash, but the
  // input may still carry a branch qualifier (e.g. "treeos.ai#1").
  // Fall through to the strip logic instead of returning whole.
  let head = address;
  if (addressKind === "stance") {
    const slashIndex = head.indexOf("/");
    if (slashIndex !== -1) head = head.slice(0, slashIndex);
  }
  const hashIndex = head.indexOf("#");
  if (hashIndex !== -1) head = head.slice(0, hashIndex);
  const atIndex = head.indexOf("@");
  if (atIndex !== -1) head = head.slice(0, atIndex);
  return head.length > 0 ? head : null;
}

// Pull the @qualifier off a stance address — the being-name beVerb
// dispatches to.
function extractBeingFromAddress(address, addressKind) {
  if (addressKind !== "stance" || typeof address !== "string") return null;
  const m = address.match(/@([a-z][a-z0-9-]*)$/i);
  return m ? m[1].toLowerCase() : null;
}

