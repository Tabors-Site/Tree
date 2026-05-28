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
//   2. `<reality>/.threads/<id>` → describeThread(id). Threads have no
//      persistent Space row, so the standard resolveStance walk would
//      fail; this branch handles them. SEE on the bare `/.threads`
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
import { assertVerbCaller } from "./_shared.js";

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

  const { identity = null, currentUser = null, currentReality = null, payload = null } = opts;
  const addressKind = opts.addressKind
    || (target && typeof target === "object" && target.kind)
    || inferAddressKind(addrString);

  const parseCtx = {
    currentReality: currentReality || getRealityDomain(),
    currentUser: currentUser || identity?.name || null,
  };
  const parsed   = parseWithContext(addrString, parseCtx);
  const expanded = expand(parsed, parseCtx);

  // Thread descriptor short-circuit. SEE on `<reality>/.threads/<id>`
  // returns the synthetic projection from describeThread instead of
  // routing through resolveStance + placeAtSpace (the thread has no
  // persistent space row). SEE on `<reality>/.threads` itself still
  // routes normally — placeAtSpace injects synthetic children for
  // that case. See materials/space/threads.js.
  const targetThreadId = threadIdFromPath(expanded.right?.path);
  if (targetThreadId) {
    const threadsSpaceId = await getThreadsSpaceId();
    const decision = await authorize({
      identity,
      verb: "see",
      target: { kind: "position", spaceId: threadsSpaceId, isDiscovery: false },
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
        path: `/.threads/${targetThreadId}`,
        being: null,
        spaceId: threadsSpaceId,
        beingId: null,
        chain: [],
        pathByNames: `/.threads/${targetThreadId}`,
        pathByIds: `/.threads/${targetThreadId}`,
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

  const resolved = await resolveStance(expanded.right);

  // Stance auth.
  const decision = await authorize({
    identity,
    verb: "see",
    target: {
      kind:        addressKind === "stance" ? "stance" : "position",
      spaceId:     resolved.spaceId,
      isDiscovery: false,
    },
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
