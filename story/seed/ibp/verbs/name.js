// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// NAME — the fifth verb. The identity layer (outer worlds), not a world
// stance: you address it story-only (`<storyDomain>` — the story's
// I_AM, where a name is declared) or `<nameId>@<storyDomain>` (a specific
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
// Mirrors ibp/verbs/be.js (same _shared gates, same history resolution); it
// is simpler — no per-being routing, no bootstrap modes, no stance.

import { IbpError, IBP_ERR } from "../protocol.js";
import { getStoryDomain } from "../address.js";
import { I_AM } from "../../materials/being/seedBeings.js";
import { emitFact } from "../../past/fact/facts.js";
import { getNameOp } from "../nameOps.js";
import { resolveNameId } from "../../materials/name/registry.js";
import {
  assertVerbCaller,
  normalizeIdentity,
  refuseHistoricalWrite,
  resolveHistoryForFact,
} from "./_shared.js";

/**
 * Parse a NAME address into { story, nameId }. Two shapes, the only two
 * NAME accepts:
 *   "<storyDomain>"            -> { story, nameId: null }  (declare)
 *   "<nameId>@<storyDomain>"   -> { story, nameId }        (banish / see)
 * No `::`, `/`, `#` — NAME is not a stance, so a positional address is
 * refused. Null/empty address means "this story" (declare here).
 */
function parseNameAddress(address) {
  if (address == null || address === "") return { story: null, nameId: null };
  if (typeof address !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "name: address must be a string (<storyDomain> or <nameId>@<storyDomain>)");
  }
  if (/[:/#]/.test(address)) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `name: "${address}" is a positional address; NAME is the identity layer, address it ` +
        `<storyDomain> or <nameId>@<storyDomain>`,
    );
  }
  const at = address.indexOf("@");
  if (at === -1) return { story: address, nameId: null };
  return { story: address.slice(at + 1) || null, nameId: address.slice(0, at) || null };
}

/**
 * The NAME verb.
 *
 * @param {"declare"|"banish"} operation
 * @param {object} payload   op args (declare: { soulType? }; banish: {})
 * @param {object} opts      { address, identity, currentStory, currentHistory, moment }
 */
export async function nameVerb(operation, payload = {}, opts = {}) {
  if (typeof operation !== "string" || !operation.length) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "story.name requires an operation");
  }
  refuseHistoricalWrite("name", payload, opts);

  const {
    address        = null,
    currentStory = null,
    currentHistory  = null,
    moment      = null,
  } = opts;

  const history = resolveHistoryForFact(moment, currentHistory, "name");
  const storyDomain = currentStory || getStoryDomain();

  const { story, nameId: addressedToken } = parseNameAddress(address);
  // A name-address token can be a PUBKEY or a REAL-NAME; resolve it via the
  // registry to the nameId (the real-name -> pubkey auto-translation).
  const addressedNameId = addressedToken ? await resolveNameId(addressedToken) : null;
  if (story && story !== storyDomain) {
    throw new IbpError(
      IBP_ERR.SPACE_NOT_FOUND,
      `Story "${story}" is not served by this server`,
      { targetStory: story, serverStory: storyDomain },
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
    story: storyDomain,
    moment,
    history,
  });

  await writeNameFact({
    operation,
    identity,
    result,
    actId: moment?.actId || null,
    moment,
    history,
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
async function writeNameFact({ operation, identity, result, actId, moment, history }) {
  if (!actId) {
    throw new IbpError(
      IBP_ERR.INTERNAL,
      `name ${operation}: missing ambient actId. Thread moment from the caller's moment, ` +
        `or open one via withIAmAct(...) / withBeingAct(...).`,
    );
  }
  const actorBeingId = identity?.beingId || I_AM;
  const params = operation === "declare"
    ? { spec: result.spec }
    : { byActor: String(actorBeingId) };

  await emitFact({
    verb:    "name",
    act:     operation,            // "declare" | "banish"
    through: actorBeingId,
    of:      { kind: "name", id: String(result.nameId) },
    params,
    actId,
    history,
  }, moment);
}
