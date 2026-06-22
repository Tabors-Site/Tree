// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// llmMoment.js . one moment for an LLM being. Stateless. FORWARD by default.
//
// ────────────────────────────────────────────────────────────────────
// Orientation. The fold's contract per MODEL.md + INNER-FOLD.md:
//
//   forward (default):  Fold(b, R_scope) over R_b-as-world-history +
//                       spaces + matter. The act-chain A_b is NOT in
//                       scope. The being acts from the world it sees
//                       NOW, with no recollection of its own prior
//                       acts.
//
//   half:               world + recall(A_b). Recall is the braid-walk
//                       (INNER-FOLD §3) . past acts causally stitched
//                       to entities changing in the current face, NOT
//                       a recency window over the reel.
//
//   inward:             A_b alone, world dropped. Pure reflection.
//
// Orientation rides on the summon. Default is forward. A being only
// sees its own past when it has explicitly turned. The default-forward
// dancer wakes on the tick, sees the grid via its forward fold, and
// decides where to step . it does NOT remember its prior moves.
// Statelessness is the design. The dance is harmonic because each
// dancer reacts to the present grid, not to its own trajectory.
//
// half and inward are not built yet. The half-turn requires the
// braid-walk indexer; the inward turn requires the A_b-only
// serializer. When they land they slot in here at the marked seam.
// ────────────────────────────────────────────────────────────────────
//
// What this file does, per moment:
//
//   1. Snapshot ancestors (pinned for every resolution chain).
//   2. Resolve the LLM client at this position.
//   3. Build the prompt FRESH from the forward fold. The world face
//      lives in the system prompt (via able see-resolvers); the wake's
//      content lives in the user message. No past-messages array.
//   4. One provider call. Single shot. No buffer, no loop.
//   5. Parse the response into one of three outcomes (the cognition
//      speaks WORD — its content IS one Word, parsed + run via
//      runWordNativeOutput; there is no JSON tool call):
//        kind:"act"     . the Word laid at least one fact onto deltaF.
//                         The prose IS the closing utterance, sealed
//                         into the Act's content.
//        kind:"see"     . the no-act release. The Word parsed to
//                         nothing, or ran but laid no fact. No Act row,
//                         inbox row closes clean.
//        kind:"failure" . cognition broke (timeout, http-error, garbage,
//                         or the Word run refused / errored).
//
// What does NOT exist here:
//
//   . A past-messages slot lifted from the reel. Prior Acts do NOT
//     enter the prompt by default. The chat format's three slots
//     (system / past / user) do NOT map onto the model; only system
//     and user are used. The "past" slot does not correspond to any
//     concept in TreeOS doctrine.
//
//   . session.messages or any state carried across moments. Each
//     moment builds its own message array and throws it away.
//
//   . The multi-step loop. Multi-step cognition happens through
//     multiple MOMENTS, not multiple LLM calls in one moment. A able
//     that wants to keep stepping does so EXPLICITLY: its act emits
//     SUMMON(self) (with whatever orientation the next moment should
//     fold at) and the next moment fires from that summon. No hidden
//     selfContinue field; the able's act IS the loop signal. The
//     no-act release (a Word that lays no fact) is the natural exit:
//     the being signals "I have seen this moment's face and I am done."
//
// What is preserved:
//
//   . assemble.buildSystemPromptForAble         . prompt rendering
//   . connect.getClientForBeing + failover      . provider plumbing
//   . runWordNativeOutput (parse + runAbleWord)  . the Word path
//   . hooks (beforeLLMCall, afterLLMCall, enrichContext, beforeResponse)

import crypto from "crypto";
import log from "../../../seedStory/log.js";
import { hooks } from "../../../hooks.js";
import Space from "../../../materials/space/space.js";
import {
  snapshotAncestors,
} from "../../../materials/space/ancestorCache.js";
import {
  getRootIdFor,
  setCurrentSpace,
  getCurrentSpace,
} from "../../../materials/being/position.js";
import {
  cognitionSuccess,
  cognitionSee,
  cognitionFailure,
  isCognitionFailure,
} from "../cognitionResult.js";
import { buildSystemPromptForAble } from "./assemble.js";
import {
  getClientForBeing,
  getLlmTimeout,
} from "./connect.js";
import { resolveLlmConnectionChain } from "./resolution.js";
import { callWithFailover } from "./call.js";
import { presenceKeyFor } from "../../stamper/2-fold/reel.js";
import { computeIbpStampAddress } from "../../../ibp/address.js";

// Orientations the fold supports. Default everywhere is "forward":
// fold the world, do NOT read the act-chain. half and inward both
// require the braid-walk indexer to land before they can be honored;
// today the assembler logs and downgrades them to forward so a
// misrouted summon never silently injects past.
const ORIENTATIONS = new Set(["forward", "half", "inward"]);

// Concurrency cap. The shared LLM pool retired (each being has its own
// LlmConnection), but a hard ceiling on simultaneous in-flight moments
// still matters as a rate-of-change guard against runaway fan-out.
let MAX_RUN_TURNS = 50;
let _activeRunTurns = 0;
export function setMaxRunTurns(n) {
  if (Number.isFinite(n) && n > 0) {
    MAX_RUN_TURNS = Math.max(1, Math.min(Math.floor(n), 10000));
  }
}
export function getActiveRunTurnCount() {
  return _activeRunTurns;
}

/**
 * Run one LLM moment for a being. Stateless across moments. Builds
 * its prompt fresh from the fold, makes one provider call, returns a
 * discriminated CognitionResult.
 *
 * @param {object} opts
 * @param {object} opts.being     . the acting Being row
 * @param {object} opts.envelope  . the SUMMON envelope (carries content,
 *                                  ibpAddress, actId, sessionId, ...)
 * @param {object} opts.able      . the active able spec
 * @param {AbortSignal} [opts.signal] . cancellation
 * @param {object} [opts.moment]   . ambient moment ctx (actId/sessionId)
 * @returns {Promise<CognitionResult>}
 */
// 14.md / oneWordMode — EVERY able is word-native, unconditionally: the cognition speaking Word IS
// the system (Tabor). The JSON envelope (executeTool / the seed tools) is DELETED (14.md §4.5); the
// transition flag died with it. There is no other response path — every being receives Word
// (vocabulary + inner face rendered as Word) and emits ONE Word.
//
// 14.md §4 step 2 — the word OUTPUT path. The being emitted WORD (its content); parse it to IR and
// run it through runAbleWord (the SAME executor cherub.word uses) onto THIS moment's deltaF, sealed
// like any act. The act signs BY a Name (moment.actorAct.by, the trueName) THROUGH a being (the
// vessel — beingId): the explicit `identity` makes through = beingId and by = the Name. env is
// minimal — do/be/call dispatch on identity+moment; host predicates (see-conditions) are a later
// wiring. Parse miss → see; run error → failure. One act → one stamp: facts laid = an act sealed;
// none = an inert read.
async function runWordNativeOutput(prose, { able, moment, history, beingId, username }) {
  if (!prose) return cognitionSee();
  let ir;
  try {
    const { parse } = await import("../../word/parser.js");
    ir = parse(prose);
  } catch (err) {
    log.info("Word", `${able?.name}: emitted Word did not parse (${err.message}); no act this moment`);
    return cognitionSee();
  }
  if (!ir || (Array.isArray(ir) && ir.length === 0)) return cognitionSee();
  const before = Array.isArray(moment?.deltaF) ? moment.deltaF.length : 0;
  try {
    const { runAbleWord } = await import("../../word/ableWordRegistry.js");
    await runAbleWord(ir, {
      moment,
      history,
      env: {},
      identity: { beingId: String(beingId), name: username || null },
    });
  } catch (err) {
    if (err?.__wordRefusal) return cognitionFailure(err.code || "refused", err.message);
    log.error("Word", `${able?.name}: runAbleWord failed: ${err.message}`);
    return cognitionFailure("internal", `word run failed: ${err.message}`);
  }
  const laid = (Array.isArray(moment?.deltaF) ? moment.deltaF.length : 0) > before;
  return laid ? cognitionSuccess(prose) : cognitionSee();
}

export async function runLlmMoment({ being, envelope, able, signal, moment } = {}) {
  if (!being || !able || !envelope) {
    return cognitionFailure("internal", "runLlmMoment requires being, able, envelope");
  }
  if (_activeRunTurns >= MAX_RUN_TURNS) {
    return cognitionFailure("internal", `too many concurrent moments (cap=${MAX_RUN_TURNS})`);
  }

  _activeRunTurns++;
  try {
    return await runLlmMomentInner({ being, envelope, able, signal, moment });
  } finally {
    _activeRunTurns--;
  }
}

async function runLlmMomentInner({ being, envelope, able, signal, moment }) {
  const beingId = String(being._id);
  const username = being.name || null;

  // The history this moment runs on. The wire layer attaches it to the
  // envelope from the parsed address; moment carries it forward
  // through every internal call. No default . if history is missing,
  // assertHistory in the projection layer will throw and the moment
  // fails loud rather than silently folding on main.
  // (envelope.branch is the wire-contract key the protocols layer
  // still attaches; the local is history.)
  const history = moment?.actorAct?.history || envelope?.branch;

  // The conversation lane. IBPA when both stances are resolvable; else
  // an ephemeral pipeline key. The reel fold reads this; the system
  // prompt's "presenceKey" lookup writes through it. History-scoped:
  // the same pair on a different history is a different lane.
  const beingOut = envelope.beingOut || envelope.toBeingId || null;
  const isPresentist = able?.presentist === true;
  const _ibpAddress = (isPresentist || !beingOut)
    ? null
    : await computeIbpStampAddress({
        askerBeingId: beingId,
        askerPosition: getCurrentSpace(beingId) || null,
        addresseeBeingId: beingOut,
        ...(history ? { history } : {}),
      });
  const presenceKey = _ibpAddress
    || envelope.ibpAddress
    || moment?.ibpAddress
    || `pipeline:ephemeral:${crypto.randomUUID()}`;

  // 1. Plant the being at its space. rootId derives from setCurrentSpace.
  const spaceId =
    being.currentPositionId || being.homePositionId || null;
  if (spaceId) await setCurrentSpace(beingId, spaceId, moment);
  const currentSpace = getCurrentSpace(beingId);
  const rootId = getRootIdFor(beingId);

  // 2. Ancestor snapshot pinned for this moment. Every resolution
  // chain (scope, tools, LLM, config) reads from this memo.
  const snapshotNodeId = currentSpace || rootId || null;
  const ancestorSnapshot = snapshotNodeId
    ? await snapshotAncestors(snapshotNodeId, history)
    : [];

  // Tree circuit breaker. If the owning root is tripped, return a
  // brief act explaining the dormancy. `owner` set on the ancestor
  // marks the ownership boundary.
  const rootAncestor = ancestorSnapshot.find((a) => !!a.owner);
  if (rootAncestor?.qualities?.circuit?.tripped) {
    return cognitionSuccess(
      "This tree is dormant. It exceeded health thresholds and its circuit breaker tripped.",
    );
  }

  // 3. LLM client resolution — the 7-step chain (auth.jpg).
  //
  // Receiver = this being. Actor = the being who summoned this moment
  // (from the planned act). The able name carried by `activeAble`
  // drives per-able slot lookups at every level (steps 0/1/2/3/4/5/6).
  //
  // The chain returns an ordered list; chain[0].connectionId is the
  // primary, the rest feed the failover loop in call.js. Empty chain
  // means no connection is available — surface noLlm.
  const askerBeingId =
    moment?.plannedAct?.through ||
    envelope.fromBeingId ||
    envelope.askerBeingId ||
    null;
  const askerSpaceId =
    moment?.plannedAct?.askerPosition ||
    envelope.askerSpaceId ||
    null;
  const chainResult = await resolveLlmConnectionChain({
    receiver: { beingId, spaceId: currentSpace || rootId || null, storyDomain: null },
    actor: askerBeingId
      ? { beingId: askerBeingId, spaceId: askerSpaceId, storyDomain: null }
      : null,
    able: able?.llmSlot || able?.name || "main",
    history,
  });
  const ableConnectionId = chainResult.chain.length > 0
    ? chainResult.chain[0].connectionId
    : null;
  const clientEntry = await getClientForBeing(beingId, null, ableConnectionId, history);
  if (clientEntry.noLlm) {
    return cognitionSuccess(
      "No LLM connection configured. Set one up at /setup to use AI features.",
    );
  }
  const { model, isCustom, connectionId } = clientEntry;

  // 4. Build the prompt FRESH for this moment. Forward fold (the
  // default and the only mode honored today):
  //   . enrichContext gathers per-position extension contributions
  //   . buildSystemPromptForAble renders the able's body + position
  //     block + see-resolver content (the world face)
  //   . the user message is the wake's content . the moment's "what
  //     just landed in front of you" signal
  //
  // NO past-messages array. The act-chain A_b is not in scope on a
  // forward fold (MODEL.md). The being acts from the world it sees
  // NOW, with no recollection of its own prior acts. The dance is
  // harmonic because each dancer reacts to the present grid; a being
  // that secretly carries its own history every tick is a quietly
  // ruminating contemplative, not a forward voice.
  //
  // ORIENTATION (INNER-FOLD §2). The three turns, all folded into the
  // canonical face's BLOCKS by buildInnerFace (one rasterize, source by
  // orientation — no separate past-face render):
  //   forward — world only. The face blocks are the able's canSee reels.
  //   inward  — A_b alone. The face blocks ARE the being's act-chain
  //             (foldPlace returns it in act-order); the world drops out
  //             (enrichedContext also stays empty).
  //   half    — world + braid-walk recall. The face blocks are the canSee
  //             reels PLUS the recalled subset surfaced by causal adjacency.
  // Orientation rides on the summon (INNER-FOLD §4). A being only
  // turns by self-summoning with a new ω; external callers always
  // arrive forward. The pickOrientation helper enforces the
  // precedence chain envelope > moment > able default > forward.
  const orientation = pickOrientation(envelope, able, moment);

  // Beat 2 (runFoldBeat in moment.js) already ran foldPlace at this
  // orientation and stashed both the spatial fold and the canonical
  // inner face on moment. We just read moment.innerFace through. The
  // past-face is no longer rendered here: buildInnerFace folds the
  // orientation's source INTO the face's blocks (inward = the being's
  // act-chain, half = world + the braid-walked recall), so the inner
  // face already carries it — one face-fold, source by orientation, no
  // separate past-face codepath.

  // Inward drops the world. Skip enrichContext (it gathers per-space
  // extension surface) so the world-data path stays empty. Half and
  // forward both keep enrichContext.
  const enrichedContext = orientation === "inward"
    ? null
    : await gatherEnrichedContext({
        beingId,
        currentSpace,
        rootId,
        presenceKey,
        message: envelope.content,
      });

  // promptCtx flows into buildSystemPromptForAble + resolveBare-
  // Capabilities. The inner face (built at beat 2) already carries the
  // orientation's blocks, so there is no pastFaceBlock / suppressCanSee
  // to thread — buildPrompt just renders ctx.innerFace.
  // History-aware aggregate reader for see-resolvers and prompt builders.
  // Same shape as ctx.read on moment (see 1-assign.js baseCtx): hides
  // loadOrFold + history threading behind one call. SEE-resolvers run
  // inside the prompt-build phase BEFORE the summon dispatch — they
  // don't get a moment, only this promptCtx — so the reader has to
  // live here too.
  const _summonHistory = moment?.actorAct?.history || "0";
  const promptCtx = {
    name: username,
    beingId,
    presenceKey,
    rootId,
    currentSpace,
    enrichedContext,
    being,
    orientation,
    // The canonical inner face built at beat 2 already carries the
    // orientation's blocks (forward = world, inward = act-chain, half =
    // both). assemble.js reads ctx.innerFace.blocks via innerFaceFormat to
    // render the face section; no per-soul rebuild, no separate past-face.
    innerFace: moment?.innerFace || null,
    history: _summonHistory,
    read: async (kind, id) => {
      if (!id) return null;
      const { loadOrFold } = await import("../../../materials/projections.js");
      const slot = await loadOrFold(kind, String(id), _summonHistory);
      if (!slot) return null;
      return { _id: slot.id, position: slot.position, ...(slot.state || {}) };
    },
  };
  const systemPrompt = await buildSystemPromptForAble(able, promptCtx);

  // The canonical inner face was built once at beat 2 (runFoldBeat)
  // and lives on moment.innerFace. The seal carries it onto the
  // Act in moment.js's seal branch. No per-soul rebuild here.
  //
  // Snapshot doctrine: the LLM reads moment.innerFace ONCE here at
  // moment open and never re-reads. No reactive subscription. Reels
  // referenced by the face's weave may change mid-moment; the seal
  // path trusts the existing chain CAS + reel-head locks to surface
  // any real conflict at sealAct time. On conflict the moment fails,
  // its inbox row stays open, the scheduler re-picks it up, the next
  // pass rebuilds innerFace fresh (with a fresh weave) and retries.
  // No new conflict-check machinery here . the doctrine is snapshot
  // at fold, retry via existing refold path if seal fails.
  const userTurn = {
    able: "user",
    content:
      typeof envelope.content === "string"
        ? envelope.content
        : JSON.stringify(envelope.content),
  };
  // The SYSTEM message is the being's stable state (identity + ables +
  // face); the USER message is the per-moment wake. Keeping the system
  // message byte-deterministic for a given fold lets the endpoint's prefix
  // cache carry it across moments (26.md) — the fold rides the KV cache;
  // per-moment volatile stays in the user turn.
  const messages = [
    { able: "system", content: systemPrompt },
    userTurn,
  ];

  // 5. The single provider call.
  // The cognition speaks WORD (14.md): it emits its one Word as message
  // content, parsed below via the word parser → runAbleWord. There are
  // NO tool schemas — the JSON envelope retired (§4.5). reqParams is
  // exactly { model, messages }; nothing else.
  const reqParams = { model, messages };

  // Conduit-boundary deadline. Owned here so a hung provider releases
  // the moment on time regardless of SDK behavior.
  const deadlineMs =
    (Number.isFinite(able?.timeoutMs) && able.timeoutMs) || getLlmTimeout();
  const deadlineCtrl = new AbortController();
  if (signal) {
    if (signal.aborted) deadlineCtrl.abort();
    else signal.addEventListener("abort", () => deadlineCtrl.abort(), { once: true });
  }
  const reqOpts = { signal: deadlineCtrl.signal };

  const llmHookData = {
    beingId,
    rootId,
    able: able.name,
    model,
    messageCount: messages.length,
    hasTools: false,
    messages,
    spaceId: currentSpace || rootId || null,
    actId: moment?.actId || envelope.actId || null,
    sessionId: moment?.sessionId || null,
    parentActId: null,
  };
  const beforeRes = await hooks.run("beforeLLMCall", llmHookData);
  if (beforeRes.cancelled) {
    return cognitionFailure("internal", beforeRes.reason || "beforeLLMCall cancelled");
  }

  let response;
  let deadlineTimer = null;
  try {
    const DEADLINE = Symbol("deadline");
    const deadline = new Promise((r) => {
      deadlineTimer = setTimeout(() => r(DEADLINE), deadlineMs);
    });
    const callPromise = callWithFailover(
      (cli, mdl) => cli.chat.completions.create({ ...reqParams, model: mdl }, reqOpts),
      clientEntry,
      beingId,
      rootId,
      // Pass the 7-step chain so failover walks our resolver's
      // candidates (with force flags + per-able slots already
      // applied) instead of falling back to the legacy resolver.
      // History threads through so failover reads see the moment's
      // effective view (sub-branch deletions, etc.).
      { chain: chainResult.chain, history },
    );
    let winner;
    try {
      winner = await Promise.race([callPromise, deadline]);
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
    if (winner === DEADLINE) {
      deadlineCtrl.abort();
      callPromise.catch(() => {});
      return cognitionFailure("timeout", `LLM call exceeded ${deadlineMs}ms`);
    }
    response = winner.response;
    if (winner.usedClient && winner.usedClient !== clientEntry) {
      Object.assign(clientEntry, winner.usedClient);
    }
  } catch (err) {
    if (signal?.aborted) return cognitionFailure("aborted", err.message);
    if (isCognitionFailure(err)) return cognitionFailure(err.shape, err.reason);
    log.warn("LLM", `provider call failed: ${err.message}`);
    return cognitionFailure("http-error", err.message || "unknown HTTP failure");
  }

  hooks
    .run("afterLLMCall", {
      beingId,
      rootId,
      able: able.name,
      model,
      usage: response?.usage || null,
      hasToolCalls: false,
      actId: moment?.actId || envelope.actId || null,
      sessionId: moment?.sessionId || null,
      responseText: response?.choices?.[0]?.message?.content || null,
    })
    .catch(() => {});

  // 6. Parse the response. The cognition spoke WORD — its content IS
  // one Word. Run it through the word path (parse → runAbleWord) onto
  // this moment's deltaF, sealed like any act. The act signs BY a Name
  // (moment.actorAct.by, the trueName) THROUGH a being (the vessel —
  // beingId). A Word that lays a fact → act; one that parses to nothing
  // or lays no fact → see; a refusal / run error → failure.
  const choice = response?.choices?.[0];
  if (!choice?.message) {
    return cognitionFailure("garbage", "no choice/message in provider response");
  }
  const assistant = choice.message;
  const proseRaw = typeof assistant.content === "string" ? assistant.content : "";
  const prose = proseRaw.trim();

  return await runWordNativeOutput(prose, { able, moment, history, beingId, username });
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Pick the moment's orientation. Order of precedence:
 *   1. envelope.orientation . the summon that opened this moment
 *      explicitly named one (the canonical channel per INNER-FOLD §4)
 *   2. moment.orientation . threaded by the caller
 *   3. able.defaultOrientation . the able's standing posture
 *   4. "forward" . the substrate's default
 *
 * All three (forward / half / inward) are honored. Per INNER-FOLD §2
 * the orientation determines what R_scope reaches:
 *   forward — world only (b's reel + space + matter), no A_b
 *   inward  — A_b only, world drops out
 *   half    — world + braid-walked recalled subset of A_b
 * Unknown values fall back to forward with a warn log so an
 * envelope-shape regression can never silently inject the past.
 */
function pickOrientation(envelope, able, moment) {
  const raw =
    envelope?.orientation ||
    moment?.orientation ||
    able?.defaultOrientation ||
    "forward";
  if (!ORIENTATIONS.has(raw)) {
    log.warn("LLM", `unknown orientation "${raw}"; treating as forward`);
    return "forward";
  }
  return raw;
}

/**
 * Gather extension context via the enrichContext hook. Returns a
 * dictionary the able's prompt builder can read; an empty object on
 * miss. Skips silently when no space context resolves.
 */
async function gatherEnrichedContext({ beingId, currentSpace, rootId, presenceKey, message }) {
  let enrichedContext = null;
  try {
    const posNodeId = currentSpace || rootId || null;
    if (!posNodeId) return null;
    const { loadProjection } = await import("../../../materials/projections.js");
    const _pSlot = await loadProjection("space", posNodeId, "0");
    if (!_pSlot) return null;
    const posSpace = { _id: _pSlot.id, ...(_pSlot.state || {}) };
    const meta =
      posSpace.qualities instanceof Map
        ? Object.fromEntries(posSpace.qualities)
        : posSpace.qualities || {};
    enrichedContext = {};
    await hooks.run("enrichContext", {
      context: enrichedContext,
      space: posSpace,
      meta,
      spaceId: posNodeId,
      beingId,
      sessionId: presenceKey,
      message: message || null,
      dumpMode: true,
    });
  } catch (err) {
    log.debug("LLM", `enrichContext gather skipped: ${err.message}`);
    return null;
  }
  return enrichedContext;
}
