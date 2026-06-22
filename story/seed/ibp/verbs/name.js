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
// caller identity (so the fact has an actor); there is no able-walk yet.
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
import { emitWordFact, stampsFact } from "../factResult.js";
import { resolveNameOpFromFold } from "../../present/word/wordStore.js";
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

  // Fold-ONLY: the NAME op resolves from the live word-fold (the coin facts seedFold declared at
  // genesis Step 1.5), NOT the NAME_OPS Map — which is now only the load-time registration buffer
  // declareNameOpsToFold reads. Mirrors do.js's resolveDoOpFromFold. I_AM's own bootstrap
  // name:declare (sprout.js) is a raw emitFact, never a nameVerb call, so it predates and grounds
  // this fold — only WORLD-driven NAME acts dispatch here.
  const nameOp = resolveNameOpFromFold(operation);
  if (!nameOp) {
    throw new IbpError(
      IBP_ERR.ACTION_NOT_SUPPORTED,
      `name: unknown operation "${operation}" (declare | connect | release | set-password | banish)`,
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

  // EVERY ACT MAKES A FACT — emitWordFact stamps the one name:<op> fact through the keystone (the
  // twin of the BE ops), reading the verb (name) + target NOUN (name) from the word's binding.
  // declareNameFact attaches the fact's params (declare → {spec}; banish/connect/release →
  // {byActor}) + the target name. The keystone's name-policy OMITS the result field entirely, so the
  // minted `reveal` cannot reach the chain — it rides ONLY the RETURN below to the asker.
  const { factResult, through } = declareNameFact(result, { operation, identity });
  await emitWordFact(
    nameOp,
    { through, actId: moment?.actId || null, history },
    factResult,
    moment,
  );

  // `reveal` (declare only) carries the freshly minted key ONCE for backup —
  // private key + 24 words + public key. It rides the handler return, never the
  // fact. Null for banish/connect/release and for imported keys.
  return { ok: true, operation, nameId: result.nameId, reveal: result.reveal || null };
}

/**
 * Declare the one name:<op> fact on a name-op result, for the dispatcher to stamp through the
 * keystone (emitWordFact) — the twin of be.js's declareConnectFact. The fact's TARGET is the name
 * acted on (the NEW name for declare — making its reel; the addressed name for banish). The params:
 * declare records the public spec; banish/connect/release record only `byActor`. The ACTOR
 * (`through`) is the caller's being, or I_AM for the pre-world ops (every being's trueName is i-am
 * today). The minted `reveal` (declare) is NOT touched here and never reaches the fact: the keystone
 * OMITS the result field for a name-op, so the key rides ONLY the verb's RETURN to the asker.
 */
function declareNameFact(result, { operation, identity }) {
  const actorBeingId = identity?.beingId || I_AM;
  const params =
    operation === "declare"
      ? { spec: result.spec }
      : { byActor: String(actorBeingId) };
  const factResult = stampsFact(result, params, {
    kind: "name",
    id: String(result.nameId),
  });
  return { factResult, through: String(actorBeingId) };
}
