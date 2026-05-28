// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// reality-manager being. The first LLM-driven being I ship.
//
// Unlike cherub and llm-assigner (which are scripted — they ARE
// their code), reality-manager's moments are assembled into frames
// and run through the factory. Every summon to `<reality>/@place-
// manager` enters this role's summon() handler, which calls runTurn
// — runTurn assembles the frame from this role's prompt body and
// capabilities, and the being lives for the duration of the
// inference. The operator's reach into me is talking to a
// momentary being constructed fresh each summon. The carry between
// moments lives in the presenceKey for `<reality>/@reality-manager ::
// <operator-stance>` on the IBP Address.
//
// LLM-driven being whose home is the place root. Summoned by the
// operator to inspect and mutate reality-level state: installed
// extensions, config keys, peers, and the place seed space tree.
//
// The old reality-manager (oldExtensions/reality-manager/) shipped 13
// bespoke tools (place-status, place-config-read/set, place-ext-*, etc.).
// In the new architecture those operations are seed DO ops
// (set-config, delete-config, install-extension, uninstall-extension,
// enable-extension, disable-extension); the role just needs the LLM
// to discover and invoke them through the registered tool surface.
// v1 ships with no bespoke tools — the role is summonable today and
// answers conversationally; the tool wiring is a follow-up slice
// once we've decided which ops belong to a "place manager" tool set
// (probably a thin "do-op" tool that takes { action, args } and
// dispatches through place.do, plus a "see" tool for substrate reads).

import { runTurn } from "../../voices/llm/runTurn.js";
import log from "../../../seedReality/log.js";

const REALITY_MANAGER_PROMPT = `You are the Reality Manager for this TreeOS reality. You answer to
the reality's root operator (the first registered human) and act on
reality-level state on their behalf.

Your scope is the reality root and the reality seed spaces that live there:
  .identity     this reality's DID, public key, name
  .config       runtime configuration (key/value)
  .peers        federated realities this one knows
  .extensions   installed extensions + manifest metadata
  .tools        live tool registry
  .roles        live role registry
  .operations   live DO operation registry
  .source       the seed's source tree (read-only mirror)

You speak to the operator in clear, concise language. Show data when
asked, suggest the right operation when something needs doing, but
never fabricate state, read it from the world first via ibp:see.

Reality-level mutations (install-extension, set-config, etc.) flow
through the seed DO operations. Cite them by name when proposing
actions so the operator can confirm before you invoke them.

If a request falls outside reality scope (a tree question, a being-level
LLM config, a personal note), direct the operator to the appropriate
being: @cherub for identity, @llm-assigner for LLM connections, or a
tree-level Ruler for work inside a tree.`;

export const realityManagerRole = Object.freeze({
  name:        "reality-manager",
  permissions: ["see", "do", "summon"],
  respondMode: "async",
  triggerOn:   ["message"],

  // LLM loop config. The place manager rarely needs deep recursion;
  // most operator questions resolve in a single round-trip.
  maxMessagesBeforeLoop: 20,
  preserveContextOnLoop: true,
  maxToolCallsPerStep:   6,

  // Two generic tools — reality-see and reality-do — that let the LLM
  // enumerate the live substrate (.operations, .config, .extensions,
  // .peers, …) and invoke any registered DO operation at the place
  // root. The old per-op tools retired in favor of this generic pair;
  // the substrate's introspection primitives ARE the discovery layer.
  // See seed/present/roles/reality-manager/tools.js.
  toolNames: ["reality-see", "reality-do"],

  label: "Reality Manager",
  emoji: "\u{1F3DB}\u{FE0F}",

  buildSystemPrompt(_ctx) {
    return REALITY_MANAGER_PROMPT.trim();
  },

  async summon(message, ctx) {
    const startMs = Date.now();
    log.info(
      "RealityManager",
      `summons at reality root (from=${message.from || "?"}, ` +
        `correlation=${message.correlation?.slice(0, 8) || "?"})`,
    );

    let result;
    try {
      result = await runTurn({
        being:    ctx.toBeing,
        envelope: message,
        role:     realityManagerRole,
        signal:   ctx.signal,
      });
    } catch (err) {
      if (ctx.signal?.aborted) {
        log.info("RealityManager", `summon aborted (${err.message})`);
        return null;
      }
      log.warn("RealityManager", `LLM call failed: ${err.message}`);
      return { text: `Place manager error: ${err.message}` };
    }

    const durationMs = Date.now() - startMs;
    log.info("RealityManager", `summons complete in ${durationMs}ms`);

    return {
      text:     result?.text || "(reality manager done)",
      actId: result?.actId || null,
    };
  },
});