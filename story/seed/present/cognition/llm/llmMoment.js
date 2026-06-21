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
//   2. Resolve the LLM client + tools at this position.
//   3. Build the prompt FRESH from the forward fold. The world face
//      lives in the system prompt (via role see-resolvers); the wake's
//      content lives in the user message. No past-messages array.
//   4. One provider call. Single shot. No buffer, no loop.
//   5. Parse the response into one of three outcomes:
//        kind:"act"     . the LLM dispatched a do / summon / be tool.
//                         Prose alongside is narration of the act and
//                         rides in the Act's content.
//        kind:"see"     . the no-act release. Two routes produce it:
//                         (a) the LLM called end-turn — the explicit
//                             "I have seen, I will not act" tool;
//                         (b) the LLM emitted no tool call at all.
//                         Both mean the same downstream: no Act row,
//                         inbox row closes clean. Prose without a
//                         dispatched verb-tool is logged but does not
//                         enter the act-chain (speech is an act, acts
//                         go through tools).
//        kind:"failure" . cognition broke (timeout, http-error, garbage)
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
//     multiple MOMENTS, not multiple LLM calls in one moment. A role
//     that wants to keep stepping does so EXPLICITLY: its act emits
//     SUMMON(self) (with whatever orientation the next moment should
//     fold at) and the next moment fires from that summon. No hidden
//     selfContinue field; the role's act IS the loop signal. The
//     no-act release (end-turn OR no tool call) is the natural exit:
//     the LLM signals "I have seen this moment's face and I am done."
//
//   . Tool_call/tool_result pairing across moments. One call, one
//     response. The next moment is a new prompt that folds the new
//     world (including this moment's sealed Fact, if any).
//
// What is preserved:
//
//   . assemble.buildSystemPromptForRole         . prompt rendering
//   . connect.getClientForBeing + failover      . provider plumbing
//   . tools.resolveToolsForPosition + executeTool . tool surface + dispatch
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
import { buildSystemPromptForRole } from "./assemble.js";
import { renderInwardPastFace, renderHalfPastFace } from "./pastFaceRender.js";
import {
  resolveToolsForPosition,
  executeTool,
  getToolVerb,
} from "./tools.js";
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
 * @param {object} opts.role      . the active role spec
 * @param {AbortSignal} [opts.signal] . cancellation
 * @param {object} [opts.moment]   . ambient moment ctx (actId/sessionId)
 * @returns {Promise<CognitionResult>}
 */
export async function runLlmMoment({ being, envelope, role, signal, moment } = {}) {
  if (!being || !role || !envelope) {
    return cognitionFailure("internal", "runLlmMoment requires being, role, envelope");
  }
  if (_activeRunTurns >= MAX_RUN_TURNS) {
    return cognitionFailure("internal", `too many concurrent moments (cap=${MAX_RUN_TURNS})`);
  }

  _activeRunTurns++;
  try {
    return await runLlmMomentInner({ being, envelope, role, signal, moment });
  } finally {
    _activeRunTurns--;
  }
}

async function runLlmMomentInner({ being, envelope, role, signal, moment }) {
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
  const isPresentist = role?.presentist === true;
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
  // (from the planned act). The role name carried by `activeRole`
  // drives per-role slot lookups at every level (steps 0/1/2/3/4/5/6).
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
    role: role?.llmSlot || role?.name || "main",
    history,
  });
  const roleConnectionId = chainResult.chain.length > 0
    ? chainResult.chain[0].connectionId
    : null;
  const clientEntry = await getClientForBeing(beingId, null, roleConnectionId, history);
  if (clientEntry.noLlm) {
    return cognitionSuccess(
      "No LLM connection configured. Set one up at /setup to use AI features.",
    );
  }
  const { model, isCustom, connectionId } = clientEntry;

  // 4. Build the prompt FRESH for this moment. Forward fold (the
  // default and the only mode honored today):
  //   . enrichContext gathers per-position extension contributions
  //   . buildSystemPromptForRole renders the role's body + position
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
  // ORIENTATION (INNER-FOLD §2). The three turns honored here:
  //   forward — world only. The forward face (preloaded canSee
  //             blocks via the role) carries the perception. The
  //             past-face block is empty.
  //   inward  — A_b alone. foldPlace(beingId, "inward") returns the
  //             act-chain in act-order; renderInwardPastFace turns
  //             it into the past-face block. The world drops out:
  //             ctx.enrichedContext stays empty and the canSee
  //             preload is skipped (the world block is absent).
  //   half    — world + braid-walk recall. The forward canSee
  //             preload still runs (world stays); the past-face
  //             block holds the recalled subset surfaced by causal
  //             adjacency (foldPlace's recall walks stitches on
  //             entities present in the forward face).
  // Orientation rides on the summon (INNER-FOLD §4). A being only
  // turns by self-summoning with a new ω; external callers always
  // arrive forward. The pickOrientation helper enforces the
  // precedence chain envelope > moment > role default > forward.
  const orientation = pickOrientation(envelope, role, moment);

  // Beat 2 (runFoldBeat in moment.js) already ran foldPlace at this
  // orientation and stashed both the spatial fold and the canonical
  // inner face on moment. We just read them through. Inward and
  // half synthesize a past-face prompt block from the foldedFace's
  // past axis (actChain / recalled); forward leaves it empty.
  const foldedFace = moment?.foldedFace || null;
  let pastFaceBlock = "";
  try {
    if (orientation === "inward") {
      pastFaceBlock = renderInwardPastFace(foldedFace?.actChain);
    } else if (orientation === "half") {
      pastFaceBlock = renderHalfPastFace(foldedFace?.recalled);
    }
  } catch (faceErr) {
    log.warn("LLM", `past-face render(${orientation}) failed for being=${beingId.slice(0, 8)}: ${faceErr.message}`);
    if (orientation === "inward") {
      pastFaceBlock = "[Inward fold]\n(act-chain unavailable this moment)";
    }
  }

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

  // promptCtx flows into buildSystemPromptForRole + resolveBare-
  // Capabilities. The pastFaceBlock rides through into buildPrompt's
  // assembly; suppressCanSee tells the assembler to skip the role's
  // preloaded canSee blocks on inward (world drops out).
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
    pastFaceBlock,
    // The canonical inner face built at beat 2. assemble.js reads
    // ctx.innerFace.blocks via innerFaceFormat to render the canSee
    // section of the prompt; no per-soul rebuild.
    innerFace: moment?.innerFace || null,
    suppressCanSee: orientation === "inward",
    history: _summonHistory,
    read: async (kind, id) => {
      if (!id) return null;
      const { loadOrFold } = await import("../../../materials/projections.js");
      const slot = await loadOrFold(kind, String(id), _summonHistory);
      if (!slot) return null;
      return { _id: slot.id, position: slot.position, ...(slot.state || {}) };
    },
  };
  const systemPrompt = await buildSystemPromptForRole(role, promptCtx);

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
    role: "user",
    content:
      typeof envelope.content === "string"
        ? envelope.content
        : JSON.stringify(envelope.content),
  };
  const messages = [
    { role: "system", content: systemPrompt },
    userTurn,
  ];

  // 5. Tools at this position. resolveToolsForPosition reads
  // session.role and session._ancestorSnapshot from a facade; we hand
  // it a throwaway object. The facade also covers executeTool's
  // legacy `session.messages.push` and circuit-breaker writes; the
  // facade is discarded at end of moment so the state never carries.
  const sessionFacade = {
    role,
    _ancestorSnapshot: ancestorSnapshot,
    _nodeLlmConfig: {},
    messages: [],
    _toolFailures: {},
  };
  let { tools } = await resolveToolsForPosition(
    sessionFacade,
    beingId,
    Array.isArray(role.permissions) ? role.permissions : null,
    history,
  );
  if (envelope.readOnly) {
    tools = tools.filter((t) => {
      const name = t.function?.name || t.name;
      return name && getToolVerb(name) === "see";
    });
  }

  // 6. The single provider call.
  const reqParams = { model, messages };
  if (tools.length > 0) {
    reqParams.tools = tools;
    // Roles whose every wake should produce exactly one act declare
    // `forceToolCall: true` on their spec. The provider is told "call
    // a tool, no other option" and the model picks one immediately
    // instead of deliberating in prose. Conversational beings (cherub,
    // story-manager) keep the default `auto` so they can answer in
    // text when that's the right response.
    reqParams.tool_choice = role?.forceToolCall ? "required" : "auto";
  }

  // Conduit-boundary deadline. Owned here so a hung provider releases
  // the moment on time regardless of SDK behavior.
  const deadlineMs =
    (Number.isFinite(role?.timeoutMs) && role.timeoutMs) || getLlmTimeout();
  const deadlineCtrl = new AbortController();
  if (signal) {
    if (signal.aborted) deadlineCtrl.abort();
    else signal.addEventListener("abort", () => deadlineCtrl.abort(), { once: true });
  }
  const reqOpts = { signal: deadlineCtrl.signal };

  const llmHookData = {
    beingId,
    rootId,
    role: role.name,
    model,
    messageCount: messages.length,
    hasTools: tools.length > 0,
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
      // candidates (with force flags + per-role slots already
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
      role: role.name,
      model,
      usage: response?.usage || null,
      hasToolCalls: !!response?.choices?.[0]?.message?.tool_calls?.length,
      actId: moment?.actId || envelope.actId || null,
      sessionId: moment?.sessionId || null,
      responseText: response?.choices?.[0]?.message?.content || null,
    })
    .catch(() => {});

  // 7. Parse the response into one of three outcomes.
  const choice = response?.choices?.[0];
  if (!choice?.message) {
    return cognitionFailure("garbage", "no choice/message in provider response");
  }
  const assistant = choice.message;
  let toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
  const proseRaw = typeof assistant.content === "string" ? assistant.content : "";
  let prose = proseRaw.trim();

  // Open-weight models (Qwen, Hermes, Llama, Mistral via Ollama / vLLM
  // / llama.cpp / OpenRouter) emit tool calls as TEXT inside
  // message.content rather than as structured message.tool_calls.
  // Hosted models (OpenAI, Anthropic, Gemini) populate tool_calls
  // natively and this branch is a no-op. The parser handles the
  // common open-weight syntaxes and lifts a matched tool call into
  // the OpenAI tool_calls shape so the existing dispatch path below
  // works unchanged.
  if (toolCalls.length === 0 && prose.length > 0) {
    const parsed = _parseTextualToolCalls(prose);
    if (parsed && parsed.length > 0) {
      toolCalls = parsed;
      // The tool call IS the act . the prose is the chat-template
      // wrapper around it, not narration to keep. Drop it so the
      // moment seals on the tool result, not the textual call.
      prose = "";
    }
  }

  // One moment, one act. Extras are dropped before they become
  // anything . the next moment's fresh fold will see whatever this
  // act changed, and the LLM can choose its next step from there.
  if (toolCalls.length > 0) {
    if (toolCalls.length > 1) {
      log.info(
        "LLM",
        `received ${toolCalls.length} tool calls, took 1 (one moment one act)`,
      );
    }
    const firstCall = toolCalls[0];
    const deltaFBefore = Array.isArray(moment?.deltaF)
      ? moment.deltaF.length
      : 0;
    let toolResult;
    try {
      toolResult = await executeTool(
        firstCall,
        sessionFacade,
        {
          beingId,
          rootId,
          currentSpace,
          actId: moment?.actId || envelope.actId || null,
          sessionId: moment?.sessionId || null,
          rootActId: moment?.rootActId || moment?.actId || envelope.actId || null,
          signal,
          username,
          // Wake context. The summon tool (and any other tool that
          // wants to reply-thread) reads these off callCtx.moment
          // to default `target` to the asker and `inReplyTo` to the
          // wake's correlation. The LLM doesn't have to track
          // correlations . a bare `summon({content:"..."})` is a
          // reply to whoever opened this moment.
          wakeFrom: envelope?.from || null,
          wakeCorrelation: envelope?.correlation || null,
          // The live moment ctx, threaded UNMODIFIED. This is the
          // deltaF/foldedSeqs/afterSeal-bearing object the seal drains.
          // executeTool hands it to the tool handler as callCtx.moment
          // so a tool that delegates to doVerb/callVerb/beVerb pushes
          // its Fact onto THIS moment's ΔF and seals atomically with the
          // Act. Dropping it self-seals the Fact and orphans the Act.
          moment,
        },
        presenceKey,
      );
    } catch (err) {
      if (signal?.aborted) return cognitionFailure("aborted", err.message);
      return cognitionFailure("internal", `tool dispatch failed: ${err.message}`);
    }

    // Honor the dispatch outcome. executeTool catches handler errors
    // INTERNALLY and returns { success:false, error } rather than
    // throwing, so the try/catch above almost never fires. A failed
    // tool emitted no Fact; returning a successful empty act here is
    // what drove the orphan-seal refusal (no content, no Facts). A
    // failed tool is a failed cognition: surface the real reason so
    // it shows in the log instead of being masked as an orphan Act.
    if (toolResult && toolResult.success === false) {
      const why = toolResult.error || "unknown tool error";
      log.warn(
        "LLM",
        `${role.name} tool "${toolResult.tool || firstCall.function?.name}" ` +
          `failed; releasing as failure: ${String(why).slice(0, 200)}`,
      );
      return cognitionFailure("internal", `tool ${toolResult.tool}: ${why}`);
    }

    // end-turn is the explicit no-act call. The LLM dispatched the
    // moment-control tool that says "I have seen, I will not act."
    // Route straight to cognitionSee regardless of accompanying prose
    // (the prose is the LLM's reasoning about why it released; the
    // act-chain carries no record of this moment per the SEE-seals-
    // nothing rule). The implicit no-tool-call path below produces
    // the same outcome; end-turn just lets the LLM declare it.
    const calledToolName = firstCall.function?.name || toolResult?.tool || null;
    if (calledToolName === "end-turn") {
      log.info("LLM", `${role.name} called end-turn; releasing without an Act.`);
      return cognitionSee();
    }

    // A tool that succeeded but emitted no Fact AND left no prose is a
    // read / no-op (the canonical SEE shape): the being looked through
    // a tool and changed nothing. Release without sealing rather than
    // orphan an empty Act. With this guard the orphan gate at sealAct
    // becomes unreachable from the LLM path.
    const emittedFact =
      (Array.isArray(moment?.deltaF) ? moment.deltaF.length : 0) >
      deltaFBefore;
    const hasProse = typeof prose === "string" && prose.trim().length > 0;
    if (!emittedFact && !hasProse) {
      log.info(
        "LLM",
        `${role.name} tool "${toolResult?.tool || firstCall.function?.name}" ` +
          `succeeded but emitted no Fact and no prose; treating as SEE.`,
      );
      return cognitionSee();
    }

    // The tool dispatch IS the act . its handler emitted a Fact that
    // will commit with this moment's Act. content is the prose, if
    // any, that the LLM said alongside the tool call (the being's
    // narration of what it just did, kept in the Act's content).
    return await shapedAct(prose, role, beingId, rootId);
  }

  // No tool call . the implicit no-act release. The rule is uniform:
  // every act in the system goes through a declared tool. Speech is
  // an act. A being that should speak declares a speech tool
  // (`canDo: ["respond"]`, `canDo: ["say"]`, whatever the role
  // conventions choose) and the tool dispatches the speech-act. A
  // being that has no speech tool doesn't speak; if its LLM emits
  // prose without calling any tool, the LLM did not act.
  //
  // This implicit path is equivalent to the LLM calling end-turn:
  // both produce cognitionSee, both release the moment with no Act.
  // The explicit end-turn tool exists to give the LLM permission to
  // do nothing deliberately (especially valuable when the prompt has
  // a forward / inward / half face that begs for a response); this
  // branch catches the cases where the LLM didn't bother to call any
  // tool at all.
  //
  // No proseIsAct flag, no chat-shape vs structured-shape role
  // distinction. There are only beings with tools. The shape of a
  // being is its toolset. If a being should narrate, give it a
  // narrate tool. The LLM is always picking a tool or releasing.
  //
  // Prose without a tool call is logged so a misfire is visible
  // without polluting the act-chain.
  if (prose.length > 0) {
    log.info(
      "LLM",
      `${role.name} emitted prose with no tool call; treating as the no-act release. ` +
        `prose="${prose.slice(0, 120).replace(/\s+/g, " ")}"`,
    );
  }

  // The being looked and chose not to act. This is the no-act
  // release (cognitionSee), not failure.
  return cognitionSee();
}

// ────────────────────────────────────────────────────────────────────
// Textual tool-call parsing for open-weight providers.
//
// Open-weight chat models trained with Hermes / ChatML / Mistral tool
// templates emit tool calls as text tokens in message.content rather
// than as a structured message.tool_calls field. The exact wrappers
// vary by training data but the inner JSON is consistent:
// `{name, arguments}`. The handful of patterns below catch the common
// cases; the dispatched-as-text JSON inside each pattern is parsed and
// re-shaped into the OpenAI tool_calls form so the downstream
// executeTool path works against any provider.
//
// Patterns handled:
//   1. <tool_call>{...}</tool_call>            . Hermes / Qwen-Coder
//   2. {...} </tool_call>                       . Qwen-2.5/3 (open tag eaten by template)
//   3. [{...}] </tool_call>                     . Same, array shape (multiple calls)
//   4. <|tool_calls_begin|>{...}<|tool_calls_end|>  . Llama-3.1 prompt template
//   5. [TOOL_CALLS] [{...}]                     . Mistral-tool-use
//   6. Bare top-level JSON `{name, arguments}` or `[{...}, ...]`
//
// Hosted providers (OpenAI / Anthropic / Gemini) populate the
// structured tool_calls field directly and this parser never fires.
// ────────────────────────────────────────────────────────────────────

const _TOOL_CALL_PATTERNS = [
  /<tool_call>\s*([\s\S]+?)\s*<\/tool_call>/,
  /<\|tool[_▁▃]*calls[_▁▃]*begin\|>\s*([\s\S]+?)\s*<\|tool[_▁▃]*calls[_▁▃]*end\|>/,
  /\[TOOL_CALLS\]\s*([\s\S]+?)(?:\[\/TOOL_CALLS\]|$)/,
  // Bare JSON followed by a closing </tool_call> (the chat template ate
  // the opening tag). The inner group is greedy up to the closer.
  /([\[{][\s\S]+?[\]}])\s*<\/tool_call>/,
];

function _safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function _normalizeToolCallJson(parsed) {
  if (!parsed) return null;
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  const out = [];
  for (const c of calls) {
    if (!c || typeof c !== "object") continue;
    // Hermes / Qwen / Mistral shape: { name, arguments }
    // arguments may be an object or a JSON-encoded string; OpenAI
    // always wants the stringified form.
    const name = typeof c.name === "string" ? c.name : null;
    if (!name) continue;
    let args = c.arguments;
    if (args === undefined && c.parameters) args = c.parameters;
    if (args === undefined) args = {};
    if (typeof args !== "string") {
      try { args = JSON.stringify(args); } catch { args = "{}"; }
    }
    out.push({
      id: `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      type: "function",
      function: { name, arguments: args },
    });
  }
  return out.length > 0 ? out : null;
}

function _parseTextualToolCalls(content) {
  if (typeof content !== "string" || !content) return null;

  // Try each wrapped pattern; the first one that produces valid JSON
  // wins. Stop at the first hit so we don't double-count.
  for (const re of _TOOL_CALL_PATTERNS) {
    const m = content.match(re);
    if (!m) continue;
    const calls = _normalizeToolCallJson(_safeJsonParse(m[1]));
    if (calls) return calls;
  }

  // Last-ditch: the whole content might just BE the JSON tool-call
  // payload with no wrapping. Try parsing it as-is (only when it
  // looks JSON-shaped at the trim boundary . don't try this on prose).
  const trimmed = content.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    const calls = _normalizeToolCallJson(_safeJsonParse(trimmed));
    if (calls) return calls;
  }
  return null;
}

/**
 * Fire beforeResponse (extension shaping) and return cognitionSuccess.
 * Empty/non-string output after shaping degrades to SEE.
 */
async function shapedAct(text, role, beingId, rootId) {
  let finalText = text;
  try {
    const hookData = { content: finalText, beingId, rootId, role: role.name };
    await hooks.run("beforeResponse", hookData);
    if (typeof hookData.content === "string") finalText = hookData.content;
  } catch {}
  return cognitionSuccess(finalText);
}

/**
 * Pick the moment's orientation. Order of precedence:
 *   1. envelope.orientation . the summon that opened this moment
 *      explicitly named one (the canonical channel per INNER-FOLD §4)
 *   2. moment.orientation . threaded by the caller
 *   3. role.defaultOrientation . the role's standing posture
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
function pickOrientation(envelope, role, moment) {
  const raw =
    envelope?.orientation ||
    moment?.orientation ||
    role?.defaultOrientation ||
    "forward";
  if (!ORIENTATIONS.has(raw)) {
    log.warn("LLM", `unknown orientation "${raw}"; treating as forward`);
    return "forward";
  }
  return raw;
}

/**
 * Gather extension context via the enrichContext hook. Returns a
 * dictionary the role's prompt builder can read; an empty object on
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
