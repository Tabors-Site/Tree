// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// see.js — the SEE verb. Read a position and return its descriptor.
//
// SEE is the only verb a caller without identity may invoke — the
// `<reality>/.discovery` short-circuit returns the pre-identity surface
// every client reads on socket open before the assertVerbCaller gate
// fires. Every other path runs the gate.
//
// Two short-circuits before the normal descriptor flow:
//
//   1. `<reality>/.discovery` → buildDiscovery() (no auth, no parse).
//   2. `<reality>/./threads/<id>` → describeThread(id). Threads have no
//      persistent Space row, so the standard resolveStance walk would
//      fail; this branch handles them. SEE on the bare `/./threads`
//      folder still routes normally; placeAtSpace injects the
//      synthetic children for that case.
//
// Otherwise: parse the address, resolve the stance, gate through
// authorize, return the descriptor. SEE does NOT subscribe sockets;
// the wire layer reads descriptor.address.spaceId after return and
// attaches the live channel itself.

import { IbpError, IBP_ERR } from "../protocol.js";
import { parseWithContext, expand, getRealityDomain } from "../address.js";
import { resolveStance } from "../resolver.js";
import { buildPlaceDescriptor, buildDiscovery } from "../descriptor.js";
import { authorize } from "../authorize.js";
import {
  threadIdFromPath,
  getThreadsSpaceId,
  describeThread,
} from "../../materials/space/threads.js";
import { describeReel } from "../../past/fact/facts.js";
import { describeActChain } from "../../past/act/actChain.js";
import { describeBeingsCatalog } from "../../materials/being/beingsCatalog.js";
import { describeBranchesCatalog, describeMergeConflicts } from "../../materials/branch/branchesCatalog.js";
import {
  registerSeeOperation,
  unregisterSeeOperation,
  unregisterSeeOperationsFromExtension,
  getSeeOperation,
  listSeeOperations,
} from "../seeOps.js";
import {
  foldAt,
  NoSuchHistoricalState,
} from "../../present/beats/2-fold/foldAt.js";
// The historical SEE path routes most of its work through
// buildPlaceDescriptor with `until`, where descriptor.js's foldRead
// handles the foldAt / NoSuchHistoricalState boundary internally.
// foldAt is imported here only for the being-position follow-step:
// when the address carries an @qualifier, we fold the being to
// `until` and swap the descriptor target to wherever the being
// actually was at that point.

// Path matchers for synthetic explorer addresses.
//   `<reality>/.reel/<kind>/<id>` — facts targeting (kind, id).
//   `<reality>/.acts/<beingId>`   — acts authored by being.
// Both return non-stance descriptors (no persistent Space row); SEE
// short-circuits before resolveStance.
function reelTargetFromPath(path) {
  if (typeof path !== "string") return null;
  const m = path.match(/^\/?\.reel\/(space|matter|being)\/([^/]+)\/?$/);
  if (!m) return null;
  return { kind: m[1], id: decodeURIComponent(m[2]) };
}
function actChainTargetFromPath(path) {
  if (typeof path !== "string") return null;
  const m = path.match(/^\/?\.acts\/([^/]+)\/?$/);
  if (!m) return null;
  return decodeURIComponent(m[1]);
}
function isBeingsCatalogPath(path) {
  if (typeof path !== "string") return false;
  // Canonical path: `/./beings` (heaven child, branch-0-pinned like
  // every other heaven catalog). The earlier `/.beings` top-level
  // form was retired . it sat outside heaven and could fork into
  // branches, which the cross-branch being catalog isn't supposed to.
  return /^\/?\.\/beings\/?$/.test(path);
}
// Public id-to-name directory. `<reality>/.beings/<id>` and
// `<reality>/.spaces/<id>` return the named being or space without
// requiring auth — operator-controlled privacy filters (when added)
// gate per-id. The point: foreign substrates seeing an id in a
// cross-world descriptor can resolve the name without holding an
// identity here. Federation foundation. See protocols/ibp/FEDERATION.md
// "Public id-to-name directory."
function publicDirectoryTargetFromPath(path) {
  if (typeof path !== "string") return null;
  const m = path.match(/^\/?\.(beings|spaces)\/([^/]+)\/?$/);
  if (!m) return null;
  return { kind: m[1] === "beings" ? "being" : "space", id: decodeURIComponent(m[2]) };
}
// `.branches` / `.branches/<branchPath>` — branch tree catalog. Bare
// returns the root view (main + its children). With a path returns the
// lineage for that branch + its direct children. Read-only synthetic
// catalog; no Act/Fact, no scheduler involvement. Mirrors the
// .beings / .acts pattern.
//
// `.branches/<branchPath>/conflicts` — merge conflict catalog. Only
// meaningful when <branchPath> was created by merge-branches (has
// mergeSources set). Returns the per-reel conflict descriptors the
// merge-mediator role walks the operator through.
function branchesTargetFromPath(path) {
  if (typeof path !== "string") return null;
  const mConflicts = path.match(/^\/?\.branches\/([^/]+)\/conflicts\/?$/);
  if (mConflicts) {
    return { branchPath: decodeURIComponent(mConflicts[1]), kind: "conflicts" };
  }
  const m = path.match(/^\/?\.branches(?:\/([^/]+))?\/?$/);
  if (!m) return null;
  return { branchPath: m[1] ? decodeURIComponent(m[1]) : "0", kind: "tree" };
}

/**
 * SEE. Read a position and return its descriptor.
 *
 * `target` is a stance / position / place string
 * ("<reality>/<path>@<being>", "<reality>/<path>", "<place>") or a
 * pre-parsed `{ kind, value }` envelope.
 *
 * opts:
 *   identity         { beingId, name } | null — for role-walk gating
 *   addressKind      explicit "stance" | "position" | "place" (else inferred)
 *   currentUser      name for pronoun resolution (default identity.name)
 *   currentReality   place domain for relative addresses (default ours)
 *   payload          opaque pass-through for descriptor derivers
 */
export async function seeVerb(target, opts = {}) {
  if (target == null) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "reality.see requires a target");
  }

  // Discovery short-circuit — pre-identity surface, runs before the
  // caller gate.
  const addrString =
    typeof target === "string"
      ? target
      : target.value || target.address || null;
  if (typeof addrString === "string" && /\/\.discovery$/i.test(addrString)) {
    return buildDiscovery();
  }

  // Registered SEE op dispatch. The target is a bare op name (no
  // address sigils) AND it matches a registry entry → run the op's
  // handler instead of building a position descriptor. Same shape as
  // DO op dispatch; the difference is no Fact gets stamped.
  //
  // Op names: "place", "llm-chain", "<ext>:<name>". Addresses always
  // contain "/", "<", or "@" so the two surfaces don't collide.
  //
  // Args sourcing (in priority order):
  //   1. opts.args — in-process callers pass args directly
  //   2. opts.payload.args — wire callers pass args nested in payload
  //      (so existing payload fields like at/live/limit stay distinct)
  //   3. opts.payload — fallback: treat full payload as args
  //      (back-compat for wire callers that don't nest under .args)
  if (typeof addrString === "string" && /^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)?$/i.test(addrString)) {
    const { getSeeOperation } = await import("../seeOps.js");
    const op = getSeeOperation(addrString);
    if (op) {
      // Authorize the SEE op via the role-walk. Anonymous callers hit
      // the arrival floor (canSee: ["arrival-view"] only); authenticated
      // callers walk their granted roles. Op-handlers don't re-authorize
      // — the role-walk here is the gate. See seed/RolesAreAuth.md.
      const decision = await authorize({
        identity: opts.identity || null,
        verb: "see",
        target: { kind: "see-op", value: addrString },
        seeOp: addrString,
        summonCtx: opts.summonCtx || null,
      });
      if (!decision.ok) {
        throw new IbpError(
          opts.identity ? IBP_ERR.FORBIDDEN : IBP_ERR.UNAUTHORIZED,
          `SEE op "${addrString}" denied for actor "${decision.actor}": ${decision.reason}`,
          { actor: decision.actor, seeOp: addrString },
        );
      }
      const dispatchArgs = opts.args
        || (opts.payload && typeof opts.payload === "object" && opts.payload.args)
        || opts.payload
        || {};
      // Op handlers receive the resolved branch: either the caller's
      // currentBranch context, or the operator's `#main` pointer when
      // unset. Never literal "0" — the pointer is the source of truth.
      const { getDefaultBranch } = await import("../../materials/branch/branchRegistry.js");
      const handlerBranch = opts.currentBranch || await getDefaultBranch();
      return await op.handler({
        identity: opts.identity || null,
        args: dispatchArgs,
        ctx: opts.ctx || null,
        branch: handlerBranch,
      });
    }
  }

  // Raw-position SEE. Authorize is run downstream by buildPlaceDescriptor
  // (or the historical/follow-being/etc. branches below) which all
  // call authorize() before reading. For anonymous callers, the role-
  // walk's arrival floor (canSee: ["arrival-view"]) refuses raw-position
  // SEE because it lacks "*". No assertVerbCaller perimeter gate —
  // authorize is the single source of truth.

  const {
    identity = null,
    currentUser = null,
    currentReality = null,
    currentBranch = null,
    payload = null,
    summonCtx = null,
  } = opts;

  // Historical-read qualifier. When set, SEE returns the substrate's
  // state as of a past point via foldAt. Accepted on the wire as
  // either opts.at (verb-options shape) or target.at (envelope shape
  // when target is an object); both normalize to { atSeq?, atTimestamp? }.
  //
  // Slice B: the FULL descriptor builder threads `until` through every
  // internal fold call. Beings, matters, children, qualities, identity
  // — all rendered as they were at the past point. The shape stays the
  // same as live SEE; the data is historical. Top-level
  // `isHistorical: true` + `asOf: { atSeq?, atTimestamp? }` flags let
  // portal renderers branch cleanly.
  //
  // Doctrine: there is no globally-consistent "world snapshot" — each
  // reel resolves `until` to its own per-reel seq. For multi-reel
  // rewinds the caller passes `{atTimestamp}`; each reel's foldAt finds
  // its latest fact whose date <= timestamp and folds to that seq.
  const at = normalizeAtQualifier(opts.at, target);
  if (at) {
    return await seeAtTime({
      addrString,
      at,
      identity,
      currentReality,
      currentUser,
      currentBranch,
      payload,
      summonCtx,
      addressKind: opts.addressKind,
    });
  }

  const addressKind =
    opts.addressKind ||
    (target && typeof target === "object" && target.kind) ||
    inferAddressKind(addrString);

  const parseCtx = {
    currentReality: currentReality || getRealityDomain(),
    currentUser: currentUser || identity?.name || null,
    // No "0" hardcode — leave null when the caller didn't pass one.
    // parseStance falls through to branchPointer="main" which
    // resolveBranchPointers canonicalizes via the operator-controlled
    // registry (set-pointer can re-point main away from "0").
    currentBranch: currentBranch || null,
  };
  const parsed = parseWithContext(addrString, parseCtx);
  const { resolveBranchPointers } = await import("../address.js");
  const expanded = await resolveBranchPointers(expand(parsed, parseCtx), parseCtx);

  // Thread descriptor short-circuit. SEE on `<reality>/./threads/<id>`
  // returns the synthetic projection from describeThread instead of
  // routing through resolveStance + placeAtSpace (the thread has no
  // persistent space row). SEE on `<reality>/./threads` itself still
  // routes normally — placeAtSpace injects synthetic children for
  // that case. See materials/space/threads.js.
  const targetThreadId = threadIdFromPath(expanded.right?.path);
  if (targetThreadId) {
    const threadsSpaceId = await getThreadsSpaceId();
    const decision = await authorize({
      identity,
      verb: "see",
      target: { kind: "position", spaceId: threadsSpaceId, isDiscovery: false },
      summonCtx,
    });
    if (!decision.ok) {
      throw new IbpError(
        identity ? IBP_ERR.FORBIDDEN : IBP_ERR.UNAUTHORIZED,
        `SEE denied for actor "${decision.actor}": ${decision.reason}`,
        { actor: decision.actor },
      );
    }
    const desc = await describeThread(targetThreadId);
    if (!desc) {
      throw new IbpError(
        IBP_ERR.SPACE_NOT_FOUND,
        `No thread with id ${targetThreadId}`,
      );
    }
    return {
      address: {
        reality: getRealityDomain(),
        path: `/./threads/${targetThreadId}`,
        being: null,
        spaceId: threadsSpaceId,
        beingId: null,
        chain: [],
        pathByNames: `/./threads/${targetThreadId}`,
        pathByIds: `/./threads/${targetThreadId}`,
        leafName: targetThreadId,
        leafId: targetThreadId,
      },
      isSpaceRoot: false,
      isHomeRoot: false,
      isThread: true,
      thread: desc,
      children: [],
      matters: [],
      qualities: {},
    };
  }

  // Reel-explorer short-circuit. SEE on `<reality>/.reel/<kind>/<id>`
  // returns the fact-chain for that target. Used by client explorers
  // (flat-app) to surface the hash-chained history of a space, matter,
  // or being. Auth: any authenticated being can read any reel here —
  // operators can tighten via stance-auth on the reality root later.
  const reelTarget = reelTargetFromPath(expanded.right?.path);
  if (reelTarget) {
    const realityDomain = getRealityDomain();
    const reel = await describeReel(reelTarget.kind, reelTarget.id);
    return {
      address: {
        reality: realityDomain,
        path: `/.reel/${reelTarget.kind}/${reelTarget.id}`,
        being: null,
        spaceId: null,
        beingId: null,
        chain: [],
        pathByNames: `/.reel/${reelTarget.kind}/${reelTarget.id}`,
        pathByIds: `/.reel/${reelTarget.kind}/${reelTarget.id}`,
        leafName: reel.target.name || reelTarget.id,
        leafId: reelTarget.id,
      },
      isSpaceRoot: false,
      isHomeRoot: false,
      isReel: true,
      reel,
      children: [],
      matters: [],
      qualities: {},
    };
  }

  // Global being catalog short-circuit. SEE on `<reality>/./beings`
  // returns every Being row across the reality, regardless of home.
  // Mirrors `./operations` (catalog of registered DO ops). Per-position
  // beings still surface via normal SEE on a position; this is the
  // cross-position view for clients building global lists. Lives under
  // heaven so the catalog stays pinned to branch 0 like every other
  // heaven space — the cross-reality being view doesn't fork.
  if (isBeingsCatalogPath(expanded.right?.path)) {
    const realityDomain = getRealityDomain();
    const catalog = await describeBeingsCatalog();
    return {
      address: {
        reality: realityDomain,
        path: `/./beings`,
        being: null,
        spaceId: null,
        beingId: null,
        chain: [],
        pathByNames: `/./beings`,
        pathByIds: `/./beings`,
        leafName: "beings",
        leafId: null,
      },
      isSpaceRoot: false,
      isHomeRoot: false,
      isBeingsCatalog: true,
      beingsCatalog: catalog,
      children: [],
      matters: [],
      qualities: {},
    };
  }

  // Public id-to-name directory short-circuit. SEE on
  // `<reality>/.beings/<id>` or `<reality>/.spaces/<id>` returns the
  // named entity's public-safe surface (id + name + a small set of
  // qualities operators choose to expose). Unauth — foreign substrates
  // can resolve display info for ids appearing in cross-world
  // descriptors without holding an identity here. Private beings/spaces
  // (when the privacy flag lands) return 404. See FEDERATION.md
  // "Public id-to-name directory."
  const publicTarget = publicDirectoryTargetFromPath(expanded.right?.path);
  if (publicTarget) {
    const { loadOrFold } = await import("../../materials/projections.js");
    const realityDomain = getRealityDomain();
    const { getDefaultBranch: _gDB } = await import("../../materials/branch/branchRegistry.js");
    const branch = expanded.right?.branch || parseCtx.currentBranch || await _gDB();
    const slot = await loadOrFold(publicTarget.kind, publicTarget.id, branch);
    const notFoundCode = publicTarget.kind === "being"
      ? IBP_ERR.BEING_NOT_FOUND
      : IBP_ERR.SPACE_NOT_FOUND;
    if (!slot) {
      throw new IbpError(
        notFoundCode,
        `${publicTarget.kind} "${publicTarget.id}" not found on this reality`,
        { kind: publicTarget.kind, id: publicTarget.id },
      );
    }
    // Privacy gate. A future qualities.public = false marks the entity
    // as not surfacing through this directory; until that lands every
    // existing entity is treated as public. Operators wanting tight
    // federation can mark sensitive beings/spaces private now.
    if (slot.state?.qualities?.public === false) {
      throw new IbpError(
        notFoundCode,
        `${publicTarget.kind} "${publicTarget.id}" is private`,
        { kind: publicTarget.kind, id: publicTarget.id, private: true },
      );
    }
    return {
      address: {
        reality: realityDomain,
        path: `/.${publicTarget.kind === "being" ? "beings" : "spaces"}/${publicTarget.id}`,
        being: null,
        spaceId: null,
        beingId: publicTarget.kind === "being" ? publicTarget.id : null,
        chain: [],
        pathByNames: `/.${publicTarget.kind === "being" ? "beings" : "spaces"}/${publicTarget.id}`,
        pathByIds: `/.${publicTarget.kind === "being" ? "beings" : "spaces"}/${publicTarget.id}`,
        leafName: slot.state?.name || publicTarget.id,
        leafId: publicTarget.id,
      },
      publicDirectoryEntry: {
        kind: publicTarget.kind,
        id: publicTarget.id,
        name: slot.state?.name || null,
        // A curated subset of qualities operators publish openly.
        // Empty by default; extensions can opt in by writing to
        // qualities.publicSurface = {...}.
        public: slot.state?.qualities?.publicSurface || {},
      },
      isSpaceRoot: false,
      isHomeRoot: false,
      children: [],
      matters: [],
      qualities: {},
    };
  }

  // Branches catalog short-circuit. SEE on `<reality>/.branches` (or
  // `<reality>/.branches/<branchPath>`) returns the branch tree as a
  // read-only graph. No Act, no Fact, no scheduler — same posture as
  // .beings / .acts. The portal calls this on every navigate to draw
  // the branch chips; routing it through SEE keeps the chips out of
  // the rate-limit budget on the caller's being.
  const branchesTarget = branchesTargetFromPath(expanded.right?.path);
  if (branchesTarget) {
    const realityDomain = getRealityDomain();
    // Resolve named pointers to canonical paths. A request for
    // `.branches/main` should walk main's current canonical lineage;
    // re-pointing main later changes what this catalog returns
    // without needing per-caller updates. Canonical paths (digit
    // start) pass through untouched.
    let canonicalBranchPath = branchesTarget.branchPath;
    if (/^[a-z]/.test(canonicalBranchPath)) {
      try {
        const { resolvePointer, isPointerName } = await import("../../materials/branch/branchRegistry.js");
        if (isPointerName(canonicalBranchPath)) {
          const resolved = await resolvePointer(canonicalBranchPath);
          if (resolved) canonicalBranchPath = resolved;
        }
      } catch {
        // Pointer resolution unavailable (pre-bootstrap): fall through
        // with the literal string. describeBranchesCatalog throws if
        // it can't find a Branch row, surfacing the bad input.
      }
    }
    const isConflictsView = branchesTarget.kind === "conflicts";
    const pathSuffix = isConflictsView
      ? `/.branches/${branchesTarget.branchPath}/conflicts`
      : `/.branches/${branchesTarget.branchPath}`;
    const graph = isConflictsView
      ? null
      : await describeBranchesCatalog(canonicalBranchPath);
    const conflicts = isConflictsView
      ? await describeMergeConflicts(canonicalBranchPath)
      : null;
    return {
      address: {
        reality: realityDomain,
        path: pathSuffix,
        being: null,
        spaceId: null,
        beingId: null,
        chain: [],
        pathByNames: pathSuffix,
        pathByIds: pathSuffix,
        leafName: isConflictsView ? "conflicts" : ".branches",
        leafId: null,
        branch: branchesTarget.branchPath,
      },
      isSpaceRoot: false,
      isHomeRoot: false,
      isBranchesCatalog: !isConflictsView,
      isMergeConflictsCatalog: isConflictsView,
      branches: graph,
      conflicts,
      children: [],
      matters: [],
      qualities: {},
    };
  }

  // Act-chain explorer short-circuit. SEE on `<reality>/.acts/<beingId>`
  // returns the being's chain of moments on the address's branch
  // (newest-first), with branch lineage so a fresh branch sees its
  // parent's acts up to fork point.
  const actChainBeingId = actChainTargetFromPath(expanded.right?.path);
  if (actChainBeingId) {
    const realityDomain = getRealityDomain();
    // Allow callers (the 3D portal timeline) to bump the limit so a
    // long session of fine-grained acts doesn't truncate the visible
    // history window. describeActChain still caps at its MAX_LIMIT.
    const requestedLimit = Number(payload?.limit) || undefined;
    const { getDefaultBranch: _gDB } = await import("../../materials/branch/branchRegistry.js");
    const chainBranch = expanded.right?.branch || parseCtx.currentBranch || await _gDB();
    const chain = await describeActChain(actChainBeingId, {
      branch: chainBranch,
      ...(requestedLimit ? { limit: requestedLimit } : {}),
    });
    return {
      address: {
        reality: realityDomain,
        path: `/.acts/${actChainBeingId}`,
        being: null,
        spaceId: null,
        beingId: actChainBeingId,
        chain: [],
        pathByNames: `/.acts/${actChainBeingId}`,
        pathByIds: `/.acts/${actChainBeingId}`,
        leafName: chain.being.name || actChainBeingId,
        leafId: actChainBeingId,
      },
      isSpaceRoot: false,
      isHomeRoot: false,
      isActChain: true,
      actChain: chain,
      children: [],
      matters: [],
      qualities: {},
    };
  }

  const resolved = await resolveStance(expanded.right, { identity });

  // Stance auth. Branch threads via target.branch so authorize.js's
  // role-walk can fold the target's qualities at the right point. For
  // the wire-level SEE, branch comes from the parsed address or the
  // socket's tracked currentBranch.
  // resolveBranchPointers above canonicalizes expanded.right.branch
  // for both explicit-#branch and implicit-#main addresses. The
  // fallback chain below covers legacy callers that bypass parse;
  // the final fallback resolves the operator's `#main` pointer
  // through the registry — never literal "0".
  const { getDefaultBranch: _gDB } = await import("../../materials/branch/branchRegistry.js");
  const seeBranch =
    expanded.right?.branch ||
    currentBranch ||
    await _gDB();
  const decision = await authorize({
    identity,
    verb: "see",
    target: {
      kind: addressKind === "stance" ? "stance" : "position",
      spaceId: resolved.spaceId,
      branch:  seeBranch,
      isDiscovery: false,
    },
    summonCtx,
  });
  if (!decision.ok) {
    // Anonymous redirect (seed/RolesAreAuth.md "canSee semantics").
    // Arrival's canSee is ["arrival-view"] — raw position SEE refuses.
    // Rather than throwing UNAUTHORIZED (which would lock anonymous
    // visitors out of any landing surface), dispatch the arrival-view
    // SEE op. Visitors see the filtered root + cherub regardless of
    // which address they tried — the same view, accessible from any
    // entry point. Authenticated callers get the normal FORBIDDEN.
    //
    // The redirect fires for BOTH truly-anonymous identity (null
    // beingId) AND the @arrival being's identity (the wire binds
    // anonymous sockets to @arrival's beingId so verb dispatch has
    // an identity to ride; arrival's canSee = ["arrival-view"] then
    // refuses raw SEE and we land here to swap in the filtered view).
    const isAnonymous = !identity?.beingId || identity?.name === "arrival";
    if (isAnonymous) {
      const { getSeeOperation } = await import("../seeOps.js");
      const arrivalOp = getSeeOperation("arrival-view");
      if (arrivalOp) {
        // Resolve branch: prefer the moment's actorAct.branch, then
        // the wire-parsed currentBranch, then fall through to the
        // operator's `#main` pointer (never literal "0").
        const { getDefaultBranch } = await import("../../materials/branch/branchRegistry.js");
        const arrivalBranch =
          summonCtx?.actorAct?.branch ||
          currentBranch ||
          await getDefaultBranch();
        return await arrivalOp.handler({
          identity: identity || null,
          args: {},
          ctx: null,
          branch: arrivalBranch,
        });
      }
    }
    throw new IbpError(
      identity ? IBP_ERR.FORBIDDEN : IBP_ERR.UNAUTHORIZED,
      `SEE denied for actor "${decision.actor}": ${decision.reason}`,
      { actor: decision.actor },
    );
  }

  return buildPlaceDescriptor(resolved, { identity, payload });
}

/**
 * Infer the address shape when the caller doesn't say. `@` → stance;
 * `/` → position; otherwise → place. The verb's role-walk gate
 * relies on this to choose between stance-targeted and position-
 * targeted authorization rules.
 */
function inferAddressKind(addrString) {
  if (typeof addrString !== "string" || !addrString.length) return "place";
  if (addrString.includes("@")) return "stance";
  if (addrString.includes("/")) return "position";
  return "place";
}

// ──────────────────────────────────────────────────────────────────
// Historical SEE (Slice A — see/timeline.md)
// ──────────────────────────────────────────────────────────────────

/**
 * Accept the historical qualifier from either opts.at or target.at
 * and validate the shape. Returns null when no qualifier is present;
 * returns the normalized `{ atSeq?, atTimestamp? }` object otherwise.
 *
 * Wire shape forward-compat: caller may pass either atSeq or
 * atTimestamp (or both — atSeq wins). Substrate resolves timestamp
 * to seq internally before any fold work begins.
 */
function normalizeAtQualifier(optsAt, target) {
  const fromOpts = optsAt;
  const fromTarget = target && typeof target === "object" ? target.at : null;
  const at = fromOpts || fromTarget || null;
  if (at == null) return null;
  if (typeof at !== "object") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "SEE `at` qualifier must be an object: { atSeq?, atTimestamp? }",
    );
  }
  if (at.atSeq == null && at.atTimestamp == null) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "SEE `at` qualifier requires atSeq or atTimestamp",
    );
  }
  return at;
}

/**
 * Historical SEE. Resolves and authorizes like live SEE, then routes
 * through the standard `buildrealityDescriptor` with `until` threaded
 * down into every internal fold call. Every reel that contributes to
 * the descriptor (the leaf space, neighboring beings, matters,
 * children, the asker's row) folds to its OWN per-reel seq derived
 * from `until` — so the whole view rewinds coherently.
 *
 * Returns the standard descriptor shape (same as live SEE) with two
 * additional top-level flags:
 *   isHistorical: true
 *   asOf:         { atSeq?, atTimestamp? }
 *
 * Portal renderers branch on isHistorical to surface visual cues and
 * disable action UIs; the shape is otherwise live-compatible so they
 * can reuse all existing render code.
 */
// Attach the SEE op registry methods to seeVerb so `reality.see` is
// both callable and carries the registry surface — mirrors the
// pattern doVerb uses for DO ops (do.js:206-210).
seeVerb.registerOperation = registerSeeOperation;
seeVerb.unregisterOperation = unregisterSeeOperation;
seeVerb.unregisterOperationsFromExtension = unregisterSeeOperationsFromExtension;
seeVerb.getOperation = getSeeOperation;
seeVerb.listOperations = listSeeOperations;

async function seeAtTime({
  addrString,
  at,
  identity,
  currentReality,
  currentUser,
  currentBranch,
  payload,
  summonCtx,
  addressKind: addressKindHint,
}) {
  // Reject the short-circuit surfaces. Historical-at doesn't compose
  // with discovery (pre-identity), threads (synthetic-now projection),
  // .reel/.acts (fact-history surfaces — themselves the substrate's
  // historical primitives), or .beings (reality-wide catalog). The
  // honest answer for any of these is "use the live form."
  if (typeof addrString === "string" && /\/\.discovery$/i.test(addrString)) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "SEE `at` is not supported on /.discovery (discovery is pre-identity, not a reel-bearing target)",
    );
  }

  const parseCtx = {
    currentReality: currentReality || getRealityDomain(),
    currentUser: currentUser || identity?.name || null,
    // No "0" hardcode — leave null when the caller didn't pass one.
    // parseStance falls through to branchPointer="main" which
    // resolveBranchPointers canonicalizes via the operator-controlled
    // registry (set-pointer can re-point main away from "0").
    currentBranch: currentBranch || null,
  };
  const parsed = parseWithContext(addrString, parseCtx);
  const { resolveBranchPointers } = await import("../address.js");
  const expanded = await resolveBranchPointers(expand(parsed, parseCtx), parseCtx);

  if (threadIdFromPath(expanded.right?.path)) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "SEE `at` is not supported on threads (threads are a live projection; use .reel for historical facts)",
    );
  }
  if (/^\/?\.reel\//.test(expanded.right?.path || "")) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "SEE `at` is not supported on /.reel/... (the reel surface IS the substrate's history primitive)",
    );
  }
  if (/^\/?\.acts\//.test(expanded.right?.path || "")) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "SEE `at` is not supported on /.acts/... (the act-chain surface IS the substrate's history primitive)",
    );
  }
  if (/^\/?\.\/beings\/?$/.test(expanded.right?.path || "")) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "SEE `at` is not supported on /./beings (reality-wide catalog; query per-being instead)",
    );
  }

  let resolved = await resolveStance(expanded.right, { identity });
  const addressKind =
    addressKindHint || (expanded.right?.being ? "stance" : "position");

  // Follow the historical PERSPECTIVE. Doctrine: a historical SEE
  // shows the world from the asker's being at that time. The being to
  // follow is:
  //   1. The explicit @qualifier on the address (resolved.beingId) if
  //      the user named one ("show me where @bob was at 3pm").
  //   2. The CALLER's own being (identity.beingId) when the address has
  //      no @qualifier ("show me where I was at 3pm" — the default for
  //      a portal timeline scrub).
  //
  // Fold that being to `until`, read state.position, swap the descriptor
  // target if it disagrees with the address-resolved one. Past states
  // are immutable; the new target's leafSpace folds at `until` too, so
  // the whole view rewinds coherently.
  //
  // Falls through (no swap) when:
  //   . the asker has no identity (arrival) AND the address carried no @
  //   . the being didn't exist yet at `until` (NoSuchHistoricalState)
  //   . the being's historical position matches the resolved space
  //   . the historical position resolves to a missing space row
  const followBeingId =
    resolved.beingId || (identity?.beingId ? String(identity.beingId) : null);
  if (followBeingId) {
    try {
      // Historical fold runs on the same branch the live SEE resolved
      // to. resolved.branch is populated by expand() from the wire's
      // currentBranch (seeVerb now threads it into parseCtx); foldAt's
      // assertBranchOrThrow surfaces any threading regression here
      // loud rather than silently defaulting to heaven.
      const { state: beingState } = await foldAt(
        "being",
        String(followBeingId),
        at,
        { branch: resolved.branch },
      );
      const histPosition = beingState?.position
        ? String(beingState.position)
        : null;
      if (histPosition && histPosition !== String(resolved.spaceId)) {
        const { loadProjection } =
          await import("../../materials/projections.js");
        const { getDefaultBranch: _gDB } = await import("../../materials/branch/branchRegistry.js");
        const _pSlot = await loadProjection(
          "space",
          histPosition,
          resolved.branch || await _gDB(),
        );
        const positionRow = _pSlot
          ? {
              _id: _pSlot.id,
              name: _pSlot.state?.name,
              parent: _pSlot.state?.parent,
            }
          : null;
        if (positionRow) {
          resolved = await _redirectResolvedToSpace(resolved, positionRow);
          // If the redirect came from caller identity (not an explicit
          // @qualifier), surface the caller's beingId on the resolved
          // stance so the descriptor's identityBlock keeps reading the
          // right being and the past-self's qualities show up.
          if (!resolved.beingId) resolved.beingId = followBeingId;
        }
      }
    } catch (err) {
      if (!(err instanceof NoSuchHistoricalState)) throw err;
      // Being didn't exist yet at the queried point; render the
      // address-resolved space anyway so the user sees something.
    }
  }

  const decision = await authorize({
    identity,
    verb: "see",
    target: {
      kind: addressKind === "stance" ? "stance" : "position",
      spaceId: resolved.spaceId,
      isDiscovery: false,
    },
    summonCtx,
  });
  if (!decision.ok) {
    throw new IbpError(
      identity ? IBP_ERR.FORBIDDEN : IBP_ERR.UNAUTHORIZED,
      `SEE denied for actor "${decision.actor}": ${decision.reason}`,
      { actor: decision.actor },
    );
  }

  // Route through the standard descriptor builder with `until`. Every
  // internal foldRead now uses foldAt under the hood; the descriptor
  // populates `beings[]`, `matters[]`, `children[]`, etc. with their
  // historical projections. `isHistorical: true` + `asOf` ride at the
  // top level (placeAtSpaceRoot / placeAtSpace add them).
  try {
    return await buildPlaceDescriptor(resolved, {
      identity,
      payload,
      until: at,
    });
  } catch (err) {
    // foldRead absorbs NoSuchHistoricalState internally (returns
    // null), so the descriptor degrades gracefully when individual
    // reels weren't yet at the queried point. If the WHOLE descriptor
    // fails for another reason, surface honestly.
    throw err;
  }
}

// Build a new `resolved` object pointing at the given Space, walking
// its ancestor chain so chain/leafName/leafId match what placeAtSpace
// expects. Preserves the being qualifier from the original resolution
// so the descriptor still attributes to the right stance.
async function _redirectResolvedToSpace(resolved, positionRow) {
  const Space = (await import("../../materials/space/space.js")).default;
  // Walk parents to build the chain. Stop at the place root (parent
  // === null). The chain rendered into the descriptor's `pathByNames`
  // / `pathByIds` mirrors the live resolver's output.
  const chain = [];
  let cursor = positionRow;
  while (cursor) {
    chain.unshift({ name: cursor.name, id: cursor._id });
    if (!cursor.parent) break;
    const { loadProjection: _lP } =
      await import("../../materials/projections.js");
    const _cSlot = await _lP("space", cursor.parent, "0");
    cursor = _cSlot
      ? {
          _id: _cSlot.id,
          name: _cSlot.state?.name,
          parent: _cSlot.state?.parent,
        }
      : null;
    if (!cursor) break;
  }
  const isSpaceRoot = !positionRow.parent;
  return {
    ...resolved,
    spaceId: String(positionRow._id),
    leafSpace: positionRow,
    leafName: positionRow.name,
    leafId: String(positionRow._id),
    chain,
    isSpaceRoot,
  };
}
