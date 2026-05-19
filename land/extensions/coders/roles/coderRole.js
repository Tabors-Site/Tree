// coder-worker role.
//
// A code worker that operates at its scope: reads source files, writes
// edits, runs whatever build-time tooling the operator wires up. Permissions
// are SEE + DO (workers don't summon; sub-Ruler dispatch is Foreman's job).
//
// Tools: minimal for v1. The role registers and is summonable; the
// filesystem-artifact tools (read-file, write-file, list-files) come in a
// follow-up slice along with the substrate-side auto-sync for
// origin=filesystem artifacts.

import { runChat } from "../../../seed/llm/conversation.js";
import log from "../../../seed/log.js";

const CODER_PROMPT_BODY = `You are a Coder. You see and write code artifacts at this scope.

Your work is bounded by the spec the Foreman handed you. Realize the
smallest correct change that satisfies the spec. Read existing files
before writing changes to them. Don't invent files outside your scope;
your scope is the node you live at and the artifacts under it.

When you're done with the assigned step, return a short summary of what
you changed. The Foreman will judge your output against the contracts in
force at this scope.`;

export const coderRole = Object.freeze({
  // Dispatch contract
  name: "coder",
  permissions: ["see", "do"],
  respondMode: "async",
  triggerOn: ["message"],

  // LLM behavior contract. No modeKey — the kernel synthesizes one
  // (`role:coder`) since the mode-registry mirror is legacy
  // ([[mode-registry-legacy]]) and new roles don't carry the legacy
  // identifier explicitly.
  maxMessagesBeforeLoop: 30,
  preserveContextOnLoop: true,
  maxToolCallsPerStep: 8,
  // Empty for v1. Filesystem-artifact tools (read-file, write-file,
  // list-files) land in a follow-up slice once the origin=filesystem
  // auto-sync is wired. The role is summonable today; it just has
  // no tools to invoke until then.
  toolNames: [],

  buildSystemPrompt(ctx) {
    return CODER_PROMPT_BODY.trim();
  },

  // Summon function — kernel scheduler invokes this on inbox arrival.
  async summon(message, ctx) {
    const startMs = Date.now();
    const scopeNodeId = ctx.nodeId || ctx.resolved?.nodeId;
    if (!scopeNodeId) {
      log.warn("Coder", "summon without scopeNodeId; returning empty");
      return { content: "Internal error: no scope." };
    }
    log.info(
      "Coder",
      `💻 summons at ${String(scopeNodeId).slice(0, 8)} ` +
        `(from=${message.from || "?"}, correlation=${message.correlation?.slice(0, 8) || "?"})`,
    );

    let result;
    try {
      result = await runChat({
        being:    ctx.toBeing,
        envelope: message,
        role:     coderRole,
        signal:   ctx.signal,
      });
    } catch (err) {
      if (ctx.signal?.aborted) {
        log.info("Coder", `summon aborted (${err.message})`);
        return null;
      }
      log.warn("Coder", `LLM call failed: ${err.message}`);
      return { content: `Coder error: ${err.message}` };
    }

    const durationMs = Date.now() - startMs;
    log.info(
      "Coder",
      `💻 summons complete at ${String(scopeNodeId).slice(0, 8)} in ${durationMs}ms`,
    );

    return {
      content: result?.answer || "(coder done)",
      summonId: result?.summonId || null,
    };
  },
});
