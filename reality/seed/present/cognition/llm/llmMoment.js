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
//        kind:"act"     . the LLM dispatched a tool. Prose alongside is
//                         narration of the act and rides in the Act's
//                         content.
//        kind:"see"     . no tool call. The being looked, did not act.
//                         Includes the case of prose without a tool:
//                         speech is an act, acts go through tools,
//                         prose alone means the LLM did not call one.
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
//     that wants to keep stepping declares `selfContinue: true`; the
//     seal-handler enqueues a self-SUMMON after each act. SEE is the
//     natural exit.
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
import log from "../../../seedReality/log.js";
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
import {
  resolveToolsForPosition,
  executeTool,
  getToolVerb,
} from "./tools.js";
import {
  getClientForBeing,
  getLlmTimeout,
  resolveRootLlmForRole,
} from "./connect.js";
import { callWithFailover } from "./call.js";
import { presenceKeyFor } from "../../beats/2-fold/reel.js";
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
 * @param {object} [opts.summonCtx]   . ambient moment ctx (actId/sessionId)
 * @returns {Promise<CognitionResult>}
 */
export async function runLlmMoment({ being, envelope, role, signal, summonCtx } = {}) {
  if (!being || !role || !envelope) {
    return cognitionFailure("internal", "runLlmMoment requires being, role, envelope");
  }
  if (_activeRunTurns >= MAX_RUN_TURNS) {
    return cognitionFailure("internal", `too many concurrent moments (cap=${MAX_RUN_TURNS})`);
  }

  _activeRunTurns++;
  try {
    return await runLlmMomentInner({ being, envelope, role, signal, summonCtx });
  } finally {
    _activeRunTurns--;
  }
}

async function runLlmMomentInner({ being, envelope, role, signal, summonCtx }) {
  const beingId = String(being._id);
  const username = being.name || null;

  // The conversation lane. IBPA when both stances are resolvable; else
  // an ephemeral pipeline key. The reel fold reads this; the system
  // prompt's "presenceKey" lookup writes through it.
  const beingOut = envelope.beingOut || envelope.toBeingId || null;
  const isPresentist = role?.presentist === true;
  const _ibpAddress = (isPresentist || !beingOut)
    ? null
    : await computeIbpStampAddress({
        askerBeingId: beingId,
        askerPosition: getCurrentSpace(beingId) || null,
        addresseeBeingId: beingOut,
      });
  const presenceKey = _ibpAddress
    || envelope.ibpAddress
    || summonCtx?.ibpAddress
    || `pipeline:ephemeral:${crypto.randomUUID()}`;

  // 1. Plant the being at its space. rootId derives from setCurrentSpace.
  const spaceId =
    being.currentPositionId || being.homePositionId || null;
  if (spaceId) await setCurrentSpace(beingId, spaceId);
  const currentSpace = getCurrentSpace(beingId);
  const rootId = getRootIdFor(beingId);

  // 2. Ancestor snapshot pinned for this moment. Every resolution
  // chain (scope, tools, LLM, config) reads from this memo.
  const snapshotNodeId = currentSpace || rootId || null;
  const ancestorSnapshot = snapshotNodeId
    ? await snapshotAncestors(snapshotNodeId)
    : [];

  // Tree circuit breaker. If the owning root is tripped, return a
  // brief act explaining the dormancy.
  const rootAncestor = ancestorSnapshot.find((a) => a.rootOwner);
  if (rootAncestor?.qualities?.circuit?.tripped) {
    return cognitionSuccess(
      "This tree is dormant. It exceeded health thresholds and its circuit breaker tripped.",
    );
  }

  // 3. LLM client resolution.
  const roleConnectionId = rootId
    ? await resolveRootLlmForRole(rootId, role)
    : null;
  const clientEntry = await getClientForBeing(beingId, null, roleConnectionId);
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
  // ORIENTATION SEAM. When half / inward land they plug in here. half
  // would push a structured recall(A_b) block onto the user message
  // (or as a second user message) sourced from the braid-walk
  // (INNER-FOLD §3) . causally stitched, NOT recency-windowed. inward
  // would replace the world face entirely with an A_b-only
  // serialization. Both require the orientation parameter (below) to
  // be honored, and both require their respective fold primitives to
  // be implemented.
  const orientation = pickOrientation(envelope, role, summonCtx);

  const enrichedContext = await gatherEnrichedContext({
    beingId,
    currentSpace,
    rootId,
    presenceKey,
    message: envelope.content,
  });
  const systemPrompt = await buildSystemPromptForRole(role, {
    name: username,
    beingId,
    presenceKey,
    rootId,
    currentSpace,
    enrichedContext,
    being,
  });
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
    reqParams.tool_choice = "auto";
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
    actId: summonCtx?.actId || envelope.actId || null,
    sessionId: summonCtx?.sessionId || null,
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
      actId: summonCtx?.actId || envelope.actId || null,
      sessionId: summonCtx?.sessionId || null,
      responseText: response?.choices?.[0]?.message?.content || null,
    })
    .catch(() => {});

  // 7. Parse the response into one of three outcomes.
  const choice = response?.choices?.[0];
  if (!choice?.message) {
    return cognitionFailure("garbage", "no choice/message in provider response");
  }
  const assistant = choice.message;
  const toolCalls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
  const proseRaw = typeof assistant.content === "string" ? assistant.content : "";
  const prose = proseRaw.trim();

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
    try {
      await executeTool(
        firstCall,
        sessionFacade,
        {
          beingId,
          rootId,
          currentSpace,
          actId: summonCtx?.actId || envelope.actId || null,
          sessionId: summonCtx?.sessionId || null,
          rootActId: summonCtx?.rootActId || summonCtx?.actId || envelope.actId || null,
          signal,
          username,
          // Wake context. The summon tool (and any other tool that
          // wants to reply-thread) reads these off callCtx.summonCtx
          // to default `target` to the asker and `inReplyTo` to the
          // wake's correlation. The LLM doesn't have to track
          // correlations . a bare `summon({content:"..."})` is a
          // reply to whoever opened this moment.
          wakeFrom: envelope?.from || null,
          wakeCorrelation: envelope?.correlation || null,
        },
        presenceKey,
      );
    } catch (err) {
      if (signal?.aborted) return cognitionFailure("aborted", err.message);
      return cognitionFailure("internal", `tool dispatch failed: ${err.message}`);
    }
    // The tool dispatch IS the act . its handler emitted a Fact that
    // will commit with this moment's Act. content is the prose, if
    // any, that the LLM said alongside the tool call (the being's
    // narration of what it just did, kept in the Act's content).
    return await shapedAct(prose, role, beingId, rootId);
  }

  // No tool call . SEE. The rule is uniform: every act in the system
  // goes through a declared tool. Speech is an act. A being that
  // should speak declares a speech tool (`canDo: ["respond"]`,
  // `canDo: ["say"]`, whatever the role conventions choose) and the
  // tool dispatches the speech-act. A being that has no speech tool
  // doesn't speak; if its LLM emits prose without calling any tool,
  // the LLM did not act, which is SEE.
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
      `${role.name} emitted prose with no tool call; treating as SEE. ` +
        `prose="${prose.slice(0, 120).replace(/\s+/g, " ")}"`,
    );
  }

  // The being looked and chose not to act. This is SEE, not failure.
  return cognitionSee();
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
 *   2. summonCtx.orientation . threaded by the caller
 *   3. role.defaultOrientation . the role's standing posture
 *   4. "forward" . the substrate's default
 *
 * Today only "forward" is honored. half / inward are accepted and
 * logged but downgraded to forward so an early-arriving turned summon
 * never silently injects past before the braid-walk lands. The seam
 * is named so when half / inward come online they only need to flip
 * here, not unwind every caller.
 */
function pickOrientation(envelope, role, summonCtx) {
  const raw =
    envelope?.orientation ||
    summonCtx?.orientation ||
    role?.defaultOrientation ||
    "forward";
  if (!ORIENTATIONS.has(raw)) {
    log.warn("LLM", `unknown orientation "${raw}"; treating as forward`);
    return "forward";
  }
  if (raw !== "forward") {
    log.warn(
      "LLM",
      `orientation "${raw}" requested but not yet wired ` +
        `(braid-walk/inner-fold pending); folding forward`,
    );
    return "forward";
  }
  return "forward";
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
    const posSpace = await Space.findById(posNodeId).lean();
    if (!posSpace) return null;
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
