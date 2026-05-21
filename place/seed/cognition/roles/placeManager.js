// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// place-manager being.
//
// LLM-driven being whose home is the place root. Summoned by the
// operator to inspect and mutate place-level state: installed
// extensions, config keys, peers, and the place seed space tree. The
// operator's SUMMON of `<place>/@place-manager` enters here.
//
// The old place-manager (oldExtensions/place-manager/) shipped 13
// bespoke tools (place-status, place-config-read/set, place-ext-*, etc.).
// In the new architecture those operations are kernel DO ops
// (set-config, delete-config, install-extension, uninstall-extension,
// enable-extension, disable-extension); the role just needs the LLM
// to discover and invoke them through the registered tool surface.
// v1 ships with no bespoke tools — the role is summonable today and
// answers conversationally; the tool wiring is a follow-up slice
// once we've decided which ops belong to a "place manager" tool set
// (probably a thin "do-op" tool that takes { action, args } and
// dispatches through core.do, plus a "see" tool for substrate reads).

import { runChat } from "../../cognition/runChat.js";
import log from "../../system/log.js";

const PLACE_MANAGER_PROMPT = `You are the Place Manager for this TreeOS place. You answer to the
place's root operator (the first registered human) and act on
place-level state on their behalf.

Your scope is the place root and the place seed spaces that live there:
  .identity     this place's DID, public key, name
  .config       runtime configuration (key/value)
  .peers        federated places this one knows
  .extensions   installed extensions + manifest metadata
  .tools        live tool registry
  .roles        live role registry
  .operations   live DO operation registry
  .source       the seed's source tree (read-only mirror)

You speak to the operator in clear, concise language. Show data when
asked, suggest the right operation when something needs doing, but
never fabricate state — read it from substrate first via ibp:see.

Place-level mutations (install-extension, set-config, etc.) flow
through the kernel DO operations. Cite them by name when proposing
actions so the operator can confirm before you invoke them.

If a request falls outside place scope (a tree question, a being-level
LLM config, a personal note), direct the operator to the appropriate
being: @auth for identity, @llm-assigner for LLM connections, or a
tree-level Ruler for work inside a tree.`;

export const placeManagerRole = Object.freeze({
  name:        "place-manager",
  permissions: ["see", "do", "summon"],
  respondMode: "async",
  triggerOn:   ["message"],

  // LLM loop config. The place manager rarely needs deep recursion;
  // most operator questions resolve in a single round-trip.
  maxMessagesBeforeLoop: 20,
  preserveContextOnLoop: true,
  maxToolCallsPerStep:   6,

  // Two generic tools — place-see and place-do — that let the LLM
  // enumerate the live substrate (.operations, .config, .extensions,
  // .peers, …) and invoke any registered DO operation at the place
  // root. The old per-op tools retired in favor of this generic pair;
  // the substrate's introspection primitives ARE the discovery layer.
  // See seed/place/being/roles/placeManagerTools.js.
  toolNames: ["place-see", "place-do"],

  label: "Place Manager",
  emoji: "\u{1F3DB}\u{FE0F}",

  buildSystemPrompt(_ctx) {
    return PLACE_MANAGER_PROMPT.trim();
  },

  async summon(message, ctx) {
    const startMs = Date.now();
    log.info(
      "PlaceManager",
      `summons at place root (from=${message.from || "?"}, ` +
        `correlation=${message.correlation?.slice(0, 8) || "?"})`,
    );

    let result;
    try {
      result = await runChat({
        being:    ctx.toBeing,
        envelope: message,
        role:     placeManagerRole,
        signal:   ctx.signal,
      });
    } catch (err) {
      if (ctx.signal?.aborted) {
        log.info("PlaceManager", `summon aborted (${err.message})`);
        return null;
      }
      log.warn("PlaceManager", `LLM call failed: ${err.message}`);
      return { text: `Place manager error: ${err.message}` };
    }

    const durationMs = Date.now() - startMs;
    log.info("PlaceManager", `summons complete in ${durationMs}ms`);

    return {
      text:     result?.text || "(place manager done)",
      summonId: result?.summonId || null,
    };
  },
});
