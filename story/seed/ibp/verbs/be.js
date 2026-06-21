// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// be.js . the BE verb. Identity operations on a being.
//
// BE is the closed five-op set: birth, connect, release, switch, death. The static
// table BE_OPS in [ibp/beOps.js](../beOps.js) holds the schemas +
// handlers; this verb's job is to authorize, dispatch, and stamp the
// audit Fact. Cherub is the canonical handler.
//
// Dispatch flow:
//
//   1. Resolve the target being from the address (bare story defaults
//      to @cherub, the welcome character).
//   2. Look up the op in BE_OPS. Unknown op = ACTION_NOT_SUPPORTED.
//      . assertVerbCaller unless the op is `bootstrap: true`.
//      . story-level flags (birth_enabled / connect_enabled) gate
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

import log from "../../seedStory/log.js";
import Being from "../../materials/being/being.js";
import { emitFact } from "../../past/fact/facts.js";
import { IbpError, IBP_ERR } from "../protocol.js";
import { I_AM } from "../../materials/being/seedBeings.js";
import { getStoryDomain } from "../address.js";
import { authorize, getAuthConfig } from "../authorize.js";
import { BE_OPS, getBeOp } from "../beOps.js";
import {
  assertVerbCaller,
  refuseHistoricalWrite,
  resolveHistoryForFact,
} from "./_shared.js";

/**
 * BE. Run an identity operation. Returns the operation's result
 * (typically `{ identityToken, beingAddress, ... }` for auth flows).
 *
 * opts:
 *   address      stance or story string the BE call addresses
 *   addressKind  "stance" | "story"
 *   identity     authenticated identity (required for release)
 *   socket       optional WS socket passed through to auth hooks
 *   req          optional Express req for HTTP-arrival flows
 *   currentStory  defaults to the current story domain (getStoryDomain)
 *   moment    moment context (so the audit Fact joins ctx.deltaF)
 */
export async function beVerb(operation, payload = {}, opts = {}) {
  if (typeof operation !== "string" || !operation.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "story.be requires an operation");
  }
  refuseHistoricalWrite("be", payload, opts);

  const {
    address = null,
    addressKind = null,
    identity = null,
    // The connection's signed-in Name (server ground truth, threaded from the
    // wire's socket.nameId). Lets connect admit an OWNED being with no
    // password. NEVER sourced from the client payload.
    nameId = null,
    socket = null,
    req = null,
    currentStory = null,
    currentHistory = null,
    moment = null,
  } = opts;

  // Resolve history ONCE at the entry. Inside a moment the seated
  // histories win (moment.targetHistory, then actorAct.history);
  // opts.currentHistory covers pre-moment callers only.
  // resolveHistoryForFact throws MISSING_BRANCH if all are absent —
  // surfaces a perimeter threading gap loud instead of silently
  // defaulting to heaven. All downstream sites (loadProjection
  // lookups, writeBeFact emissions, birthBeing) use this value rather
  // than re-resolving from scope.
  const history = resolveHistoryForFact(moment, currentHistory, "be");

  const storyDomain = currentStory || getStoryDomain();

  // Address must point at this story.
  const targetStory = extractStoryFromAddress(address, addressKind);
  if (targetStory && targetStory !== storyDomain) {
    throw new IbpError(
      IBP_ERR.SPACE_NOT_FOUND,
      `Story "${targetStory}" is not served by this server`,
      { targetStory, serverStory: storyDomain },
    );
  }

  // Bare-story address defaults to @cherub, the welcome character.
  const beingName = extractBeingFromAddress(address, addressKind) || "cherub";

  // Static-table dispatch. BE_OPS holds the canonical five ops
  // (birth/connect/release/switch/death); if the operation name is in
  // the table AND cherub is the resolved being, dispatch through it.
  // Future seed change could license other beings for these ops, but
  // cherub is the only one today.
  const beOp = getBeOp(operation);

  // ── Self-birth path (BE:birth on your own stance). ──────────────
  // Per the federation doctrine, be:birth is the only birth verb;
  // the actor (left stance) becomes the mother. Solo birth — father
  // stays null. Surfaced from the 2D portal story-tab's "+ birth a
  // being" affordance. The doctrinal endgame is "BE:birth on self"
  // having literal semantics: target is the caller's own stance,
  // child has the caller as parent (mother). Same machinery as the
  // @birther path; the only difference is the target stance is your
  // own (no intermediary). See FEDERATION.md "be:birth is the only
  // birth verb".
  const isSelfTarget = !!(
    operation === "birth" &&
    identity?.beingId &&
    identity?.name &&
    beingName &&
    String(beingName).toLowerCase() === String(identity.name).toLowerCase()
  );
  if (isSelfTarget) {
    assertVerbCaller("be", opts);
    const authConfig = await getAuthConfig();
    if (!authConfig.birth_enabled) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "Birth is disabled on this story");
    }
    const decision = await authorize({
      identity,
      verb: "be",
      target: { kind: addressKind, value: address },
      operation,
      moment,
      actorHistory: currentHistory || null,
    });
    if (!decision.ok) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `BE:birth (self) denied for actor "${decision.actor}": ${decision.reason}`,
        { actor: decision.actor },
      );
    }
    const childName = payload?.name;
    if (!childName || typeof childName !== "string") {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "BE:birth requires payload.name",
      );
    }
    const childCognition = payload?.cognition || "llm";
    const childPassword = payload?.password || null;
    const childRoleField = payload?.role || payload?.defaultRole || null;
    let childHomeId = payload?.homeId || payload?.homeSpace || null;
    if (!childHomeId) {
      // Caller's own data reads from the caller's history; see the
      // birther path below for the doctrine.
      const { loadOrFold } = await import("../../materials/projections.js");
      const callerHistory = moment?.actorAct?.history || history;
      const callerSlot = await loadOrFold(
        "being",
        identity.beingId,
        callerHistory,
      );
      childHomeId = callerSlot?.state?.homeSpace || null;
    }
    if (!childHomeId) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "BE:birth (self) requires a homeId (caller has no homeSpace to inherit)",
      );
    }
    const { birthBeing } =
      await import("../../materials/being/identity/birth.js");
    const childSpec = {
      name: childName,
      cognition: childCognition,
      password: childPassword,
      parentBeingId: String(identity.beingId), // mother is the caller
      homeId: String(childHomeId),
    };
    if (childRoleField) childSpec.role = childRoleField;
    const result = await birthBeing({
      spec: childSpec,
      identity,
      moment,
      // The history this verb resolved at the perimeter. One law: the
      // verb resolves, the primitive receives. birthBeing must not
      // re-derive the history from scope.
      history,
    });
    return {
      beingId: result.beingId,
      name: result.name,
      beingAddress: `${getStoryDomain()}/@${result.name}`,
      selfBirth: true,
    };
  }

  // ── Birther path (BE:birth on @birther). ────────────────────────
  // Cherub serves unauthenticated arrival: someone with no identity
  // calls BE:birth on @cherub to register a fresh being on this
  // story (parent = cherub or I-Am for the first registrant).
  //
  // Birther serves authenticated callers: an existing being calls
  // BE:birth on @birther to mint a CHILD. The new being's being-tree
  // parent is the caller, not birther. Same BE op, different target,
  // different parent semantics. See seed/present/roles/birther/role.js.
  if (operation === "birth" && beingName === "birther") {
    assertVerbCaller("be", opts);
    if (!identity?.beingId) {
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "BE:birth via @birther requires an authenticated caller",
      );
    }
    const authConfig = await getAuthConfig();
    if (!authConfig.birth_enabled) {
      throw new IbpError(IBP_ERR.FORBIDDEN, "Birth is disabled on this story");
    }
    // Auth gate (the standard rule is be:create-being via the story-
    // root default, which admits all authenticated callers; per-position
    // rules can tighten).
    const decision = await authorize({
      identity,
      verb: "be",
      target: { kind: addressKind, value: address },
      operation,
      moment,
      actorHistory: currentHistory || null,
    });
    if (!decision.ok) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `BE:birth denied for actor "${decision.actor}": ${decision.reason}`,
        { actor: decision.actor },
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
    const childCognition = payload?.cognition || "llm"; // substrate default
    const childPassword = payload?.password || null;
    const childRoleField = payload?.role || payload?.defaultRole || null;
    // Initial roleFlow: when the operator wants the child born with a
    // configured behavioral program (the spec's Step 5 birther flow:
    // "Set initial roleFlow. Set initial cognition."). Accepts either
    // a parsed array or a JSON string; createBeing's qualities
    // pipeline lands it at qualities.roleFlow.
    let childRoleFlow = null;
    if (Array.isArray(payload?.roleFlow)) {
      childRoleFlow = payload.roleFlow;
    } else if (
      typeof payload?.roleFlow === "string" &&
      payload.roleFlow.trim()
    ) {
      try {
        childRoleFlow = JSON.parse(payload.roleFlow);
      } catch (e) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `BE:birth: roleFlow must be a valid JSON array (parse error: ${e.message})`,
        );
      }
      if (!Array.isArray(childRoleFlow)) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          "BE:birth: roleFlow must be an array of clauses",
        );
      }
    }
    if (!childName || typeof childName !== "string") {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "BE:birth requires payload.name",
      );
    }

    // Home resolution. The wire carries one of three shapes:
    //   payload.homeId      — existing space the child homes at
    //   payload.homeParent  — create a fresh child space under this
    //                         parent; that becomes the home
    //   (neither)           — default: inherit the caller's home
    //
    // The createBeingWithHome orchestrator that used to live inside
    // birth retired 2026-06-04; the homeParent path now inlines a
    // do:create-space here before calling birthBeing.
    let childHomeId = payload?.homeId || payload?.homeSpace || null; // homeSpace accepted as legacy alias during caller migration
    const childHomeParent = payload?.homeParent || null;
    if (!childHomeId && !childHomeParent) {
      // loadOrFold: a caller inherited from main onto a sub-history
      // resolves their homeSpace via lineage cold-fold. loadProjection
      // here would return null and the inheritance-fallback would
      // silently fail, making BE:birth refuse on sub-branches whenever
      // the caller hasn't explicitly diverged.
      //
      // The caller's OWN data reads from the caller's history
      // (actorAct.history), not the resolved target history — a
      // history-qualified birth address says where the child lands,
      // not where the mother lives.
      const { loadOrFold } = await import("../../materials/projections.js");
      const callerHistory = moment?.actorAct?.history || history;
      const callerSlot = await loadOrFold(
        "being",
        identity.beingId,
        callerHistory,
      );
      childHomeId = callerSlot?.state?.homeSpace || null;
    }
    if (!childHomeId && !childHomeParent) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "BE:birth requires a homeId or homeParent (caller has no homeSpace to inherit)",
      );
    }

    // Inline the home-creation step when the wire named a parent
    // rather than an existing space. Same shape the retired
    // createBeingWithHome used: default 100×100 grid, child's name
    // as the space name. Callers wanting a different shape emit
    // do:create-space themselves and pass homeId.
    if (!childHomeId && childHomeParent) {
      const { emitFact: _emitFact } = await import("../../past/fact/facts.js");
      const { randomUUID: _uuidv4 } = await import("node:crypto");
      const newHomeId = _uuidv4();
      await _emitFact(
        {
          verb: "do",
          act: "create-space",
          through: String(identity.beingId),
          of: { kind: "space", id: newHomeId },
          params: {
            name: childName,
            type: "child-home",
            parent: String(childHomeParent),
            // No initial owner class — set after the child being is
            // birthed (the child becomes their own home's owner).
            size: { x: 100, y: 100 },
            qualities: {},
          },
          actId: moment?.actId || null,
          // The child's home space lands on the same history as the
          // child's be:birth — the history this verb resolved.
          history,
        },
        moment,
      );
      childHomeId = newHomeId;
    }

    const { birthBeing } =
      await import("../../materials/being/identity/birth.js");
    const childSpec = {
      name: childName,
      cognition: childCognition,
      password: childPassword,
      parentBeingId: String(identity.beingId),
      homeId: String(childHomeId),
    };
    if (childRoleField) childSpec.role = childRoleField;
    if (childRoleFlow) childSpec.roleFlow = childRoleFlow;

    const result = await birthBeing({
      spec: childSpec,
      identity,
      moment,
      // Same law as the self-birth path: the verb resolves the
      // history once; the primitive receives it.
      history,
    });
    // ONE fact per birth. birthBeing already stamped `be:birth` on the
    // new being's reel with parentBeingId=<caller> in the spec. No
    // separate caller-side audit fact . the parent pointer lives on
    // the birth fact already, and findBeingParent walks it. Mirrors the
    // be:summon-create collapse from 2026-06-03.
    return {
      beingId: result.beingId,
      name: result.name,
      beingAddress: `${getStoryDomain()}/@${result.name}`,
    };
  }

  // ── Release on a non-cherub being. ──────────────────────────────
  // The inheriter tab's pagehide fires BE:release on its own stance
  // (e.g. `<story>/@puppet`) to clear inhabitedBy. Cherub's release
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
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "release requires an authenticated caller",
      );
    }
    const decision = await authorize({
      identity,
      verb: "be",
      target: { kind: addressKind, value: address },
      operation,
      moment,
      actorHistory: currentHistory || null,
    });
    if (!decision.ok) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `BE:release denied for actor "${decision.actor}": ${decision.reason}`,
        { actor: decision.actor },
      );
    }
    const cherubReleaseOp = getBeOp("release");
    const result = cherubReleaseOp
      ? await cherubReleaseOp.handler({
          address,
          addressKind,
          payload,
          identity,
          ctx: {
            socket,
            address: { kind: addressKind, value: address },
            identity,
            req,
            moment,
          },
          moment,
        })
      : { released: true };
    await writeBeFact({
      operation,
      identity,
      authResult: result,
      payload,
      beingName,
      actId: moment?.actId || null,
      moment,
      history,
    });
    return result;
  }

  // ── Death path. ─────────────────────────────────────────────────
  // ── Switch path. ────────────────────────────────────────────────
  // BE:switch is a per-session history change on the caller's own
  // being. Self-targeted (the actor is the target). Authorize
  // trivially — a being switching their own session's history; no role
  // gate beyond assertVerbCaller. The handler validates the
  // destination (history exists, live, and the caller folds to a
  // birthed state there) and returns the from/to summary; it never
  // touches the socket. writeBeFact stamps the be:switch audit fact
  // on the actor's reel on the NEW history (so the new history's view
  // of this being's biography records the switch-in). Stamp-then-
  // seat: the transport seats socket.currentHistory from
  // result.seatHistory only after the moment seals, so a refused
  // stamp leaves the session's history untouched.
  if (operation === "switch") {
    assertVerbCaller("be", opts);
    if (!identity?.beingId) {
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "switch requires an authenticated caller",
      );
    }
    const switchOp = getBeOp("switch");
    if (!switchOp) {
      throw new IbpError(IBP_ERR.INTERNAL, "switch op not registered");
    }
    const result = await switchOp.handler({
      address,
      addressKind,
      payload,
      identity,
      ctx: {
        socket,
        address: { kind: addressKind, value: address },
        identity,
        req,
        moment,
      },
      moment,
    });
    // Stamp the audit fact on the NEW history (result.toHistory) — the
    // post-switch history's view of this being records the switch-in.
    await writeBeFact({
      operation,
      identity,
      authResult: result,
      payload,
      beingName,
      actId: moment?.actId || null,
      moment,
      history: result.toHistory,
    });
    return result;
  }

  // BE:death targets the dying being directly (not cherub-on-itself).
  // Authorize via the role-walk (I_AM bypass admits I_AM; no role
  // today declares canBe:["death"], so every other actor refuses).
  // The handler returns a closing summary; writeBeFact stamps a
  // be:death fact on the target's reel. The reducer's applyDeath
  // marks qualities.death — the stamper's death gate (logFact) then
  // refuses any further facts riding this being.
  if (operation === "death") {
    assertVerbCaller("be", opts);
    if (!identity?.beingId) {
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "death requires an authenticated caller",
      );
    }
    if (!beingName) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "be:death requires an explicit target being in the address (e.g. <story>/@<being>)",
      );
    }
    // Resolve beingName → beingId on the target's history. The death
    // fact lands on THAT being's reel; the resolution must come from
    // the projection (the canonical source) on the operating history.
    const { findByName } = await import("../../materials/projections.js");
    const targetSlot = await findByName("being", beingName, history);
    if (!targetSlot) {
      throw new IbpError(
        IBP_ERR.BEING_NOT_FOUND,
        `be:death target @${beingName} not found on history #${history}`,
        { beingName, history },
      );
    }
    const targetBeingId = String(targetSlot.id);
    const decision = await authorize({
      identity,
      verb: "be",
      target: { kind: addressKind, value: address },
      operation,
      moment,
      actorHistory: currentHistory || null,
    });
    if (!decision.ok) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `BE:death denied for actor "${decision.actor}": ${decision.reason}`,
        { actor: decision.actor },
      );
    }
    const deathOp = getBeOp("death");
    if (!deathOp) {
      throw new IbpError(IBP_ERR.INTERNAL, "death op not registered");
    }
    const result = await deathOp.handler({
      address,
      addressKind,
      payload,
      identity,
      ctx: {
        socket,
        address: { kind: addressKind, value: address },
        identity,
        req,
        moment,
      },
      moment,
    });
    // Thread the resolved targetBeingId into writeBeFact so the
    // be:death fact lands on the dying being's reel (not the actor's).
    await writeBeFact({
      operation,
      identity,
      authResult: { ...result, targetBeingId },
      payload,
      beingName,
      actId: moment?.actId || null,
      moment,
      history,
    });
    return { ...result, targetBeingId };
  }

  // ── be:truename — hand a being to a (declared) Name. ────────────
  // Identity-level: re-point the target being's trueName at an EXISTING,
  // non-banished Name. OPEN for now (assertVerbCaller only, NO role-walk —
  // mirror the NAME verb); owner-only is a permission added later. The
  // be:truename fact lands on the TARGET being's reel; the new nameId rides
  // params.trueName (the fact target stays {kind:being}, satisfying
  // BEING_ONLY_TARGET_VERBS). The being's _id (its frozen birth-event hash)
  // is untouched, so its reel + chain stay intact across the transfer.
  if (operation === "truename") {
    assertVerbCaller("be", opts);
    if (!identity?.beingId) {
      throw new IbpError(
        IBP_ERR.UNAUTHORIZED,
        "be:truename requires an authenticated caller",
      );
    }
    if (!beingName) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "be:truename requires an explicit target being in the address (e.g. <story>/@<being>)",
      );
    }
    const trueNameToken = payload?.trueName;
    if (typeof trueNameToken !== "string" || !trueNameToken) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "be:truename requires payload.trueName (a Name pubkey or real-name)",
      );
    }
    // The target can be a pubkey OR a real-name; resolve via the registry.
    const { resolveNameId } = await import("../../materials/name/registry.js");
    const newTrueName = await resolveNameId(trueNameToken);
    if (!newTrueName) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `be:truename: no Name resolves for "${String(trueNameToken).slice(0, 16)}…" (pubkey or real-name)`,
      );
    }
    const { findByName, loadProjection } =
      await import("../../materials/projections.js");
    const targetSlot = await findByName("being", beingName, history);
    if (!targetSlot) {
      throw new IbpError(
        IBP_ERR.BEING_NOT_FOUND,
        `be:truename target @${beingName} not found on history #${history}`,
        { beingName, history },
      );
    }
    const targetBeingId = String(targetSlot.id);
    // The target Name must exist and not be banished. Names live on main
    // (identity is above the history timeline); isNameBanished returns false
    // for a MISSING name too, so assert existence separately.
    const nameSlot = await loadProjection("name", String(newTrueName), "0");
    if (!nameSlot?.state) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `be:truename: target Name "${String(newTrueName).slice(0, 12)}…" does not exist`,
        { trueName: newTrueName },
      );
    }
    const { isNameBanished } = await import("../../materials/name/closure.js");
    if (await isNameBanished(newTrueName)) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `be:truename: target Name "${String(newTrueName).slice(0, 12)}…" is banished`,
        { trueName: newTrueName },
      );
    }
    const truenameOp = getBeOp("truename");
    const result = await truenameOp.handler({
      address,
      addressKind,
      payload,
      identity,
      ctx: {
        socket,
        address: { kind: addressKind, value: address },
        identity,
        req,
        moment,
      },
      moment,
    });
    await writeBeFact({
      operation,
      identity,
      authResult: { ...result, targetBeingId, trueName: newTrueName },
      payload,
      beingName,
      actId: moment?.actId || null,
      moment,
      history,
    });
    return { ...result, targetBeingId };
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
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        "Connect is disabled on this story",
      );
    }
    const decision = await authorize({
      identity,
      verb: "be",
      target: { kind: addressKind, value: address },
      operation,
      moment,
      actorHistory: currentHistory || null,
    });
    if (!decision.ok) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `BE:connect denied for actor "${decision.actor}": ${decision.reason}`,
        { actor: decision.actor },
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
      ctx: {
        socket,
        address: { kind: addressKind, value: address },
        identity,
        req,
        moment,
        nameId,
      },
      moment,
    });
    await writeBeFact({
      operation,
      identity,
      authResult: result,
      payload,
      beingName,
      actId: moment?.actId || null,
      moment,
      history,
    });
    return result;
  }

  if (beOp && beingName === "cherub") {
    // The op opts out of the verb-caller assertion when bootstrap is
    // true (birth/connect from a fresh arrival have no identity yet).
    if (!beOp.bootstrap) {
      assertVerbCaller("be", opts);
    }

    // story-level flags gate birth and connect.
    if (operation === "birth" || operation === "connect") {
      const authConfig = await getAuthConfig();
      if (operation === "birth" && !authConfig.birth_enabled) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          "Registration is disabled on this story",
          { operation },
        );
      }
      if (operation === "connect" && !authConfig.connect_enabled) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          "Connect is disabled on this story",
          { operation },
        );
      }
    }

    const decision = await authorize({
      identity,
      verb: "be",
      target: { kind: addressKind, value: address },
      operation,
      moment,
      actorHistory: currentHistory || null,
    });
    if (!decision.ok) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `BE denied for actor "${decision.actor}": ${decision.reason}`,
        { actor: decision.actor, operation },
      );
    }

    // Top-level operation count (one-moment-one-act doctrine; sealAct
    // throws if it would seal >1 op from this moment).
    const _bCtx = moment;
    const _bWasInOp = !!(_bCtx && _bCtx._inOp);
    if (_bCtx && !_bWasInOp) {
      _bCtx._inOp = true;
      _bCtx._opCount = (_bCtx._opCount || 0) + 1;
    }
    let result;
    try {
      result = await beOp.handler({
        address,
        addressKind,
        payload,
        identity,
        ctx: {
          socket,
          address: { kind: addressKind, value: address },
          identity,
          req,
          moment,
          nameId,
        },
        moment,
      });
    } finally {
      if (_bCtx && !_bWasInOp) _bCtx._inOp = false;
    }
    // ONE fact per birth. cherub's birth handler delegates to
    // birthBeing, which already stamped `be:birth` on the new being's
    // reel with the full spec (homeSpace, defaultRole, parentBeingId,
    // qualities, …). A second writeBeFact("birth") here would emit a
    // duplicate be:birth with only `{ name, from }` in params; the
    // reducer reapplies the latest be:birth's params verbatim and
    // would clobber the freshly-set state (homeSpace → null,
    // defaultRole → null, parentBeingId → null), leaving the just-born
    // being homeless. The birther path above carries the same
    // discipline. Skip the audit fact for birth; connect / release
    // still need it (no upstream fact carries their state otherwise).
    if (operation !== "birth") {
      await writeBeFact({
        operation,
        identity,
        authResult: result,
        payload,
        beingName,
        actId: moment?.actId || null,
        moment,
        history,
      });
    }
    return result;
  }

  // No dispatch matched. BE is the closed birth/connect/release/
  // switch/death set; unknown ops throw ACTION_NOT_SUPPORTED. Known
  // ops against a being that's neither cherub nor birther (and so
  // didn't hit the branches above) throw ROLE_UNAVAILABLE.
  if (!beOp) {
    throw new IbpError(
      IBP_ERR.ACTION_NOT_SUPPORTED,
      `BE op "${operation}" is not in the closed set (${Object.keys(BE_OPS).join(", ")})`,
      { operation, available: Object.keys(BE_OPS) },
    );
  }
  throw new IbpError(
    IBP_ERR.ROLE_UNAVAILABLE,
    `No being @${beingName} handles BE ${operation} on this story`,
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
 * cherub-as-actor so the actId is always present. The guard throws
 * before emitFact runs — an act without a frame doesn't get a Fact,
 * and a BE without a Fact didn't happen.
 */
async function writeBeFact({
  operation,
  identity,
  authResult,
  payload,
  beingName = "cherub",
  actId = null,
  moment = null,
  history,
}) {
  if (!actId) {
    throw new IbpError(
      IBP_ERR.INTERNAL,
      `BE ${operation} @${beingName}: missing ambient actId. Thread moment from the caller's moment (runtime), or open one via withIAmAct(...) / withBeingAct(...).`,
      { operation, beingName },
    );
  }
  let actorBeingId = identity?.beingId || null;
  if (!actorBeingId && authResult && typeof authResult === "object") {
    actorBeingId = authResult.userId || authResult.beingId || null;
  }
  if (!actorBeingId) actorBeingId = I_AM;

  const safeResult =
    authResult && typeof authResult === "object"
      ? {
          beingAddress: authResult.beingAddress || null,
          note: authResult.note || null,
        }
      : null;

  const safeParams =
    payload && typeof payload === "object"
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
    const targetBeingId =
      authResult?.beingId || identity?.beingId || actorBeingId;
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
  } else if (operation === "death") {
    // The dying being is resolved by the death dispatch path above
    // (findByName on the address's beingName) and threaded here via
    // authResult.targetBeingId. The fact lands on THAT being's reel
    // — its final fact. The actor (caller) is recorded as
    // params.byActor so audit can see who performed the close. Today
    // only I_AM passes authorize, but the structural shape supports
    // future authority models.
    const targetBeingId = authResult?.targetBeingId;
    if (!targetBeingId) {
      throw new IbpError(
        IBP_ERR.INTERNAL,
        "be:death requires a resolved target being id (set by beVerb's death dispatch path).",
      );
    }
    target = { kind: "being", id: String(targetBeingId) };
    connectionParams = { byActor: String(actorBeingId) };
  } else if (operation === "truename") {
    // The being whose trueName changes was resolved in beVerb's truename
    // history and threaded via authResult.targetBeingId. The new Name id
    // rides params.trueName; the fact lands on that being's reel, and the
    // being reducer's applyTrueName folds it onto the row.
    const targetBeingId = authResult?.targetBeingId;
    if (!targetBeingId) {
      throw new IbpError(
        IBP_ERR.INTERNAL,
        "be:truename requires a resolved target being id (set by beVerb's truename branch).",
      );
    }
    target = { kind: "being", id: String(targetBeingId) };
    // The RESOLVED nameId (a pubkey), threaded from beVerb's truename branch
    // — NOT the raw payload token, which may be a real-name.
    connectionParams = { trueName: String(authResult?.trueName) };
  } else if (operation === "switch") {
    // Per-session history change on the caller's own being. Target =
    // the caller's being; params record from/to so the audit fact
    // surfaces the transition. The fact lands on the NEW history
    // (beVerb passed result.toHistory as `history`).
    target = { kind: "being", id: String(actorBeingId) };
    connectionParams = {
      fromHistory: authResult?.fromHistory || null,
      toHistory: authResult?.toHistory || null,
    };
  } else {
    // birth and any future BE op: identity-on-self. The actor's own
    // being is the target.
    target = { kind: "being", id: String(actorBeingId) };
  }

  const mergedParams = connectionParams
    ? { ...(safeParams || {}), ...connectionParams }
    : safeParams;

  await emitFact(
    {
      verb: "be",
      act: operation,
      through: actorBeingId,
      of: target,
      params: mergedParams,
      result: safeResult,
      actId,
      // History the BE fact lands on, pre-resolved by beVerb at the
      // entry point. writeBeFact trusts the value rather than
      // re-resolving from a scope that may not have currentHistory
      // (this function ran as nested-helper-with-implicit-closure
      // before B perimeter hardening; missing-history surfaced as a
      // ReferenceError only when an actual transport-act fired).
      history,
    },
    moment,
  );
}

// (runClaim retired . both modes (credentials, token re-claim) now
//  live inside the `use` handler in cherub/role.js.)

// Pull the story prefix off an address, if any. Lets beVerb refuse
// addresses pointing at a different story before any auth runs.
//
// Strips the optional `#<branch>` qualifier and any `@<being>` so the
// comparison against `getStoryDomain()` (just the DNS name) is
// apples-to-apples. Without stripping `#`, addresses like
// `treeos.ai#1/@cherub` would compare `"treeos.ai#1"` against
// `"treeos.ai"` and falsely report a cross-story call.
function extractStoryFromAddress(address, addressKind) {
  if (typeof address !== "string" || !address.length) return null;
  // Stance pair: the TARGET is the right side. Without this split a
  // bridge address (`left :: right`) would yield the LEFT stance's
  // story — the actor's, not the target's — and a cross-story
  // right side could slip past the "is it served here" gate. Same
  // right-side rule canopy's extractTargetStory applies.
  let head = address.includes("::")
    ? address.split("::").pop().trim()
    : address;
  // For "story" addresses there's no path-separator slash, but the
  // input may still carry a history qualifier (e.g. "treeos.ai#1").
  // Fall through to the strip logic instead of returning whole.
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
// dispatches to. The $-anchored match naturally reads the RIGHT
// stance of a bridge pair (the target side).
function extractBeingFromAddress(address, addressKind) {
  if (addressKind !== "stance" || typeof address !== "string") return null;
  const m = address.match(/@([a-z][a-z0-9-]*)$/i);
  return m ? m[1].toLowerCase() : null;
}
