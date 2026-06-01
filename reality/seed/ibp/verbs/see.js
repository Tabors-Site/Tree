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
import { threadIdFromPath, getThreadsSpaceId, describeThread } from "../../materials/space/threads.js";
import { describeReel } from "../../past/fact/facts.js";
import { describeActChain } from "../../past/act/actChain.js";
import { describeBeingsCatalog } from "../../materials/being/beingsCatalog.js";
import { assertVerbCaller } from "./_shared.js";

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
  return /^\/?\.beings\/?$/.test(path);
}

/**
 * SEE. Read a position and return its descriptor.
 *
 * `target` is a stance / position / place string
 * ("<reality>/<path>@<being>", "<reality>/<path>", "<place>") or a
 * pre-parsed `{ kind, value }` envelope.
 *
 * opts:
 *   identity         { beingId, name } | null — for stance-auth gating
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
  const addrString = typeof target === "string" ? target : (target.value || target.address || null);
  if (typeof addrString === "string" && /\/\.discovery$/i.test(addrString)) {
    return buildDiscovery();
  }

  assertVerbCaller("see", opts);

  const { identity = null, currentUser = null, currentReality = null, payload = null, summonCtx = null } = opts;
  const addressKind = opts.addressKind
    || (target && typeof target === "object" && target.kind)
    || inferAddressKind(addrString);

  const parseCtx = {
    currentReality: currentReality || getRealityDomain(),
    currentUser: currentUser || identity?.name || null,
  };
  const parsed   = parseWithContext(addrString, parseCtx);
  const expanded = expand(parsed, parseCtx);

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
        `SEE denied for stance "${decision.stance}": ${decision.reason}`,
        { stance: decision.stance },
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
      isHomeRoot:  false,
      isThread:    true,
      thread:      desc,
      children:    [],
      matters:     [],
      qualities:   {},
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
        reality:     realityDomain,
        path:        `/.reel/${reelTarget.kind}/${reelTarget.id}`,
        being:       null,
        spaceId:     null,
        beingId:     null,
        chain:       [],
        pathByNames: `/.reel/${reelTarget.kind}/${reelTarget.id}`,
        pathByIds:   `/.reel/${reelTarget.kind}/${reelTarget.id}`,
        leafName:    reel.target.name || reelTarget.id,
        leafId:      reelTarget.id,
      },
      isSpaceRoot: false,
      isHomeRoot:  false,
      isReel:      true,
      reel,
      children:    [],
      matters:     [],
      qualities:   {},
    };
  }

  // Global being catalog short-circuit. SEE on `<reality>/.beings`
  // returns every Being row across the reality, regardless of home.
  // Mirrors `.operations` (catalog of registered DO ops). Per-position
  // beings still surface via normal SEE on a position; this is the
  // cross-position view for clients building global lists.
  if (isBeingsCatalogPath(expanded.right?.path)) {
    const realityDomain = getRealityDomain();
    const catalog = await describeBeingsCatalog();
    return {
      address: {
        reality:     realityDomain,
        path:        `/.beings`,
        being:       null,
        spaceId:     null,
        beingId:     null,
        chain:       [],
        pathByNames: `/.beings`,
        pathByIds:   `/.beings`,
        leafName:    ".beings",
        leafId:      null,
      },
      isSpaceRoot:   false,
      isHomeRoot:    false,
      isBeingsCatalog: true,
      beingsCatalog: catalog,
      children:      [],
      matters:       [],
      qualities:     {},
    };
  }

  // Act-chain explorer short-circuit. SEE on `<reality>/.acts/<beingId>`
  // returns the being's chain of moments (newest-first). Same auth
  // posture as .reel for the first cut.
  const actChainBeingId = actChainTargetFromPath(expanded.right?.path);
  if (actChainBeingId) {
    const realityDomain = getRealityDomain();
    const chain = await describeActChain(actChainBeingId);
    return {
      address: {
        reality:     realityDomain,
        path:        `/.acts/${actChainBeingId}`,
        being:       null,
        spaceId:     null,
        beingId:     actChainBeingId,
        chain:       [],
        pathByNames: `/.acts/${actChainBeingId}`,
        pathByIds:   `/.acts/${actChainBeingId}`,
        leafName:    chain.being.name || actChainBeingId,
        leafId:      actChainBeingId,
      },
      isSpaceRoot: false,
      isHomeRoot:  false,
      isActChain:  true,
      actChain:    chain,
      children:    [],
      matters:     [],
      qualities:   {},
    };
  }

  const resolved = await resolveStance(expanded.right, { identity });

  // Stance auth.
  const decision = await authorize({
    identity,
    verb: "see",
    target: {
      kind:        addressKind === "stance" ? "stance" : "position",
      spaceId:     resolved.spaceId,
      isDiscovery: false,
    },
    summonCtx,
  });
  if (!decision.ok) {
    throw new IbpError(
      identity ? IBP_ERR.FORBIDDEN : IBP_ERR.UNAUTHORIZED,
      `SEE denied for stance "${decision.stance}": ${decision.reason}`,
      { stance: decision.stance },
    );
  }

  return buildPlaceDescriptor(resolved, { identity, payload });
}

/**
 * Infer the address shape when the caller doesn't say. `@` → stance;
 * `/` → position; otherwise → place. The verb's stance-auth gate
 * relies on this to choose between stance-targeted and position-
 * targeted authorization rules.
 */
function inferAddressKind(addrString) {
  if (typeof addrString !== "string" || !addrString.length) return "place";
  if (addrString.includes("@")) return "stance";
  if (addrString.includes("/")) return "position";
  return "place";
}
