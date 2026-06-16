// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// NAME — the fifth verb. The identity layer (outer worlds), not a world
// stance: you address it reality-only (`<realityDomain>` — the reality's
// I_AM, where a name is declared) or `<nameId>@<realityDomain>` (a specific
// name, to banish or see it). It rides the same IBPA but never resolves a
// position; the portal gives it its own views (create a name, see a name's
// data / all its acts).
//
// Two ops, a closed set (ibp/nameOps.js): declare, banish.
//
// PERMISSIONS (for now): anyone can call NAME. The verb only requires a
// caller identity (so the fact has an actor); there is no role-walk yet.
// declare's actor resolves to I_AM today (every being's trueName is i-am),
// so I_AM mints the new name as its facet, and the name:declare fact lands
// on the NEW name's reel — making it. "declare is open, banish is self-only,
// and a real authorize()" come later.
//
// Mirrors ibp/verbs/be.js (same _shared gates, same branch resolution); it
// is simpler — no per-being routing, no bootstrap modes, no stance.

import { IbpError, IBP_ERR } from "../protocol.js";
import { getRealityDomain } from "../address.js";
import { I_AM } from "../../materials/being/seedBeings.js";
import { emitFact } from "../../past/fact/facts.js";
import { getNameOp } from "../nameOps.js";
import { resolveNameId } from "../../materials/name/registry.js";
import {
  assertVerbCaller,
  normalizeIdentity,
  refuseHistoricalWrite,
  resolveBranchForFact,
} from "./_shared.js";

/**
 * Parse a NAME address into { reality, nameId }. Two shapes, the only two
 * NAME accepts:
 *   "<realityDomain>"            -> { reality, nameId: null }  (declare)
 *   "<nameId>@<realityDomain>"   -> { reality, nameId }        (banish / see)
 * No `::`, `/`, `#` — NAME is not a stance, so a positional address is
 * refused. Null/empty address means "this reality" (declare here).
 */
function parseNameAddress(address) {
  if (address == null || address === "") return { reality: null, nameId: null };
  if (typeof address !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "name: address must be a string (<realityDomain> or <nameId>@<realityDomain>)");
  }
  if (/[:/#]/.test(address)) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `name: "${address}" is a positional address; NAME is the identity layer, address it ` +
        `<realityDomain> or <nameId>@<realityDomain>`,
    );
  }
  const at = address.indexOf("@");
  if (at === -1) return { reality: address, nameId: null };
  return { reality: address.slice(at + 1) || null, nameId: address.slice(0, at) || null };
}

/**
 * The NAME verb.
 *
 * @param {"declare"|"banish"} operation
 * @param {object} payload   op args (declare: { soulType? }; banish: {})
 * @param {object} opts      { address, identity, currentReality, currentBranch, summonCtx }
 */
export async function nameVerb(operation, payload = {}, opts = {}) {
  if (typeof operation !== "string" || !operation.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "reality.name requires an operation");
  }
  refuseHistoricalWrite("name", payload, opts);

  const {
    address        = null,
    currentReality = null,
    currentBranch  = null,
    summonCtx      = null,
  } = opts;

  const branch = resolveBranchForFact(summonCtx, currentBranch, "name");
  const realityDomain = currentReality || getRealityDomain();

  const { reality, nameId: addressedToken } = parseNameAddress(address);
  // A name-address token can be a PUBKEY or a REAL-NAME; resolve it via the
  // registry to the nameId (the real-name -> pubkey auto-translation).
  const addressedNameId = addressedToken ? await resolveNameId(addressedToken) : null;
  if (reality && reality !== realityDomain) {
    throw new IbpError(
      IBP_ERR.SPACE_NOT_FOUND,
      `Reality "${reality}" is not served by this server`,
      { targetReality: reality, serverReality: realityDomain },
    );
  }

  const nameOp = getNameOp(operation);
  if (!nameOp) {
    throw new IbpError(
      IBP_ERR.ACTION_NOT_SUPPORTED,
      `name: unknown operation "${operation}" (declare | banish)`,
    );
  }

  // PRE-WORLD ops (declare / connect / release) are callable with NO being
  // identity — they ARE the front door, before you have a name or a being
  // (the Name Form): declare mints, connect/release bind/unbind the session,
  // all with the fact's actor resolving to I_AM. (connect is gated by the
  // password proof in the session channel + the already-connected reel gate;
  // release by the not-connected gate.) banish (and later ops) require a
  // caller. Anyone may call any of them for now (real permissions land later).
  if (operation === "banish") assertVerbCaller("name", opts);
  const identity = normalizeIdentity(opts.identity);

  const result = await nameOp.handler({
    payload,
    identity,
    addressedNameId,
    reality: realityDomain,
    summonCtx,
    branch,
  });

  await writeNameFact({
    operation,
    identity,
    result,
    actId: summonCtx?.actId || null,
    summonCtx,
    branch,
  });

  // `reveal` (declare only) carries the freshly minted key ONCE for backup —
  // private key + 24 words + public key. It rode the handler return, never the
  // fact. Null for banish/connect/release and for imported keys.
  return { ok: true, operation, nameId: result.nameId, reveal: result.reveal || null };
}

/**
 * Stamp the name:<op> fact. The fact's TARGET is the name acted on (the
 * NEW name for declare — making its reel; the addressed name for banish).
 * The ACTOR (fact.nameId) is filled by emitFact from the moment's act —
 * I_AM today. Mirrors writeBeFact.
 */
async function writeNameFact({ operation, identity, result, actId, summonCtx, branch }) {
  if (!actId) {
    throw new IbpError(
      IBP_ERR.INTERNAL,
      `name ${operation}: missing ambient actId. Thread summonCtx from the caller's moment, ` +
        `or open one via withIAmAct(...) / withBeingAct(...).`,
    );
  }
  const actorBeingId = identity?.beingId || I_AM;
  const params = operation === "declare"
    ? { spec: result.spec }
    : { byActor: String(actorBeingId) };

  await emitFact({
    verb:    "name",
    action:  operation,            // "declare" | "banish"
    beingId: actorBeingId,
    target:  { kind: "name", id: String(result.nameId) },
    params,
    actId,
    branch,
  }, summonCtx);
}
