// TreeOS Intent — `@intent` role definition (Slice 6c).
//
// First Slice 6c conversion: the autonomous intent engine becomes a
// Mode 1 being carrying the `intent` role, with **code cognition**.
// The being instance lives at the land root; its summon handler runs
// the existing intent-cycle logic. Auth-being is the precedent for
// "real being-instance, deterministic code inside" — same shape,
// different code.
//
// **Why a being.** Intent has identity worth surfacing: the engine
// observes trees, generates autonomous actions, executes them. Other
// beings can address it (`SUMMON @intent` to trigger a cycle ad-hoc);
// audit attribution lands on it (Dids during a cycle attribute to the
// intent being); it's observable in the population.
//
// **Why code cognition (vs. LLM via the bridge role).** The cycle is
// multi-step orchestration: find opted-in trees, per tree call the
// LLM for generation, per generated intent call the LLM for execution,
// write results. That's a small pipeline, not one LLM turn. The role's
// `summon` runs the pipeline as deterministic JS; the pipeline
// internally makes LLM calls through OrchestratorRuntime for each
// step. Substrate sees one SUMMON in, one summary out.
//
// **Schedule integration.** A scheduled-wake SUMMON (intent="scheduled-
// wake") arrives on cadence. The role's summon handler dispatches to
// the same runCycle the legacy setInterval used to call. No behavior
// change in what the cycle does; only the trigger mechanism shifted
// from a hidden timer to a substrate-visible scheduled summons.
//
// **Direct invocation.** Other beings (or the operator via a tool)
// can SUMMON `@intent` directly with `intent: "chat"` to force a
// cycle outside the schedule. Same handler runs; same output shape.

import log from "../../seed/log.js";
import { runCycle } from "./intentJob.js";

export const intentRole = Object.freeze({
  name: "intent",
  // Honors scheduled-wake (the normal trigger) plus chat (manual
  // SUMMON to force a cycle). Other intents are rejected — there's
  // no place/query/be semantic for an intent-cycle.
  honoredIntents: ["chat", "scheduled-wake"],
  // Async: cycles can take many seconds (LLM calls inside). ACK
  // immediately, deliver a summary via the scheduler's handoff path.
  respondMode: "async",
  triggerOn: ["message"],
  async summon(message, ctx) {
    const startMs = Date.now();
    const trigger = message?.intent === "scheduled-wake" ? "scheduled" : "manual";
    log.verbose("Intent", `@intent summoned (trigger=${trigger}, from=${message?.from || "?"})`);

    try {
      const summary = await runCycle({ signal: ctx?.signal });
      const durationMs = Date.now() - startMs;
      const text = summary?.text
        || `intent cycle done (trees=${summary?.treesProcessed ?? "?"}, intents=${summary?.intentsExecuted ?? "?"}, ${durationMs}ms)`;
      return {
        content: text,
        intent:  "chat",
      };
    } catch (err) {
      if (ctx?.signal?.aborted) {
        log.info("Intent", `@intent summons aborted (${err.message})`);
        return null;
      }
      log.warn("Intent", `@intent cycle failed: ${err.message}`);
      return {
        content: `intent cycle failed: ${err.message}`,
        intent:  "chat",
      };
    }
  },
});
