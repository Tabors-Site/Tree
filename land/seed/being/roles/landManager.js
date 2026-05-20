// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// land-manager being.
//
// LLM-driven being whose home is the land root. Summoned by the
// operator to inspect and mutate land-level state: installed
// extensions, config keys, peers, and the system-node tree. The
// operator's SUMMON of `<land>/@land-manager` enters here.
//
// The old land-manager (oldExtensions/land-manager/) shipped 13
// bespoke tools (land-status, land-config-read/set, land-ext-*, etc.).
// In the new architecture those operations are kernel DO ops
// (set-config, delete-config, install-extension, uninstall-extension,
// enable-extension, disable-extension); the role just needs the LLM
// to discover and invoke them through the registered tool surface.
// v1 ships with no bespoke tools — the role is summonable today and
// answers conversationally; the tool wiring is a follow-up slice
// once we've decided which ops belong to a "land manager" tool set
// (probably a thin "do-op" tool that takes { action, args } and
// dispatches through core.do, plus a "see" tool for substrate reads).

import { runChat } from "../llm/runChat.js";
import log from "../core/log.js";

const LAND_MANAGER_PROMPT = `You are the Land Manager for this TreeOS land. You answer to the
land's root operator (the first registered human) and act on
land-level state on their behalf.

Your scope is the land root and the system nodes that live there:
  .identity     this land's DID, public key, name
  .config       runtime configuration (key/value)
  .peers        federated lands this one knows
  .extensions   installed extensions + manifest metadata
  .tools        live tool registry
  .roles        live role registry
  .operations   live DO operation registry
  .source       the seed's source tree (read-only mirror)

You speak to the operator in clear, concise language. Show data when
asked, suggest the right operation when something needs doing, but
never fabricate state — read it from substrate first via ibp:see.

Land-level mutations (install-extension, set-config, etc.) flow
through the kernel DO operations. Cite them by name when proposing
actions so the operator can confirm before you invoke them.

If a request falls outside land scope (a tree question, a being-level
LLM config, a personal note), direct the operator to the appropriate
being: @auth for identity, @llm-assigner for LLM connections, or a
tree-level Ruler for work inside a tree.`;

export const landManagerRole = Object.freeze({
  name:        "land-manager",
  permissions: ["see", "do", "summon"],
  respondMode: "async",
  triggerOn:   ["message"],

  // LLM loop config. The land manager rarely needs deep recursion;
  // most operator questions resolve in a single round-trip.
  maxMessagesBeforeLoop: 20,
  preserveContextOnLoop: true,
  maxToolCallsPerStep:   6,

  // Two generic tools — land-see and land-do — that let the LLM
  // enumerate the live substrate (.operations, .config, .extensions,
  // .peers, …) and invoke any registered DO operation at the land
  // root. The old per-op tools retired in favor of this generic pair;
  // the substrate's introspection primitives ARE the discovery layer.
  // See seed/roles/landManagerTools.js.
  toolNames: ["land-see", "land-do"],

  label: "Land Manager",
  emoji: "\u{1F3DB}\u{FE0F}",

  buildSystemPrompt(_ctx) {
    return LAND_MANAGER_PROMPT.trim();
  },

  async summon(message, ctx) {
    const startMs = Date.now();
    log.info(
      "LandManager",
      `summons at land root (from=${message.from || "?"}, ` +
        `correlation=${message.correlation?.slice(0, 8) || "?"})`,
    );

    let result;
    try {
      result = await runChat({
        being:    ctx.toBeing,
        envelope: message,
        role:     landManagerRole,
        signal:   ctx.signal,
      });
    } catch (err) {
      if (ctx.signal?.aborted) {
        log.info("LandManager", `summon aborted (${err.message})`);
        return null;
      }
      log.warn("LandManager", `LLM call failed: ${err.message}`);
      return { content: `Land manager error: ${err.message}` };
    }

    const durationMs = Date.now() - startMs;
    log.info("LandManager", `summons complete in ${durationMs}ms`);

    return {
      content:  result?.answer || "(land manager done)",
      summonId: result?.summonId || null,
    };
  },
});
