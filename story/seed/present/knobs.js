// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The factory's budget knobs and the single switch that genesis
// uses to hand my remembered settings down.
//
// Every LLM-being's turn runs against a ceiling: how many messages
// in the buffer, how many tool iterations, how many retries, how
// many bytes per message, how long a single tool call may take.
// The ceiling exists because a turn that loops forever or floods
// context isn't thinking, it's burning. Defaults live here; the
// operator overrides through story config; setInternalConfig at the
// bottom of this file routes each remembered key to the right
// subsystem.
//
// Clamps prevent a misconfig from bricking the factory. Every
// path produces a working system even if a config value arrives
// nonsense.

import { getStoryConfigValue } from "../storyConfig.js";
import { getInternalConfigValue } from "../internalConfig.js";
import { setLlmTimeout } from "./cognition/llm/connect.js";
import { setFailoverTimeout } from "./cognition/llm/call.js";
import { setMaxPresenceReels, setStalePresenceMs } from "./stamper/2-fold/reel.js";

// ─────────────────────────────────────────────────────────────────
// LOCAL BUDGET STATE
// ─────────────────────────────────────────────────────────────────

let MAX_MESSAGES = 30;
let MAX_TOOL_ITERATIONS = 15;
let LLM_MAX_RETRIES = 3;
let TOOL_CALL_TIMEOUT_MS = 600000;
let TOOL_RESULT_MAX_BYTES = 15000;

export function getMaxMessages() {
  return MAX_MESSAGES;
}
export function getMaxToolIterations() {
  return MAX_TOOL_ITERATIONS;
}
export function getLlmMaxRetries() {
  return LLM_MAX_RETRIES;
}
export function getToolCallTimeoutMs() {
  return TOOL_CALL_TIMEOUT_MS;
}
export function getToolResultMaxBytes() {
  return TOOL_RESULT_MAX_BYTES;
}

// Per-message content cap. Reads live each call because the
// operator can flip it without restart.
export function getMaxMessageContentBytes() {
  return Math.max(
    4096,
    Math.min(
      Number(getInternalConfigValue("maxMessageContentBytes")) || 32768,
      131072,
    ),
  );
}

// ─────────────────────────────────────────────────────────────────
// EXTERNAL SETTERS BRIDGED HERE
// ─────────────────────────────────────────────────────────────────
//
// stamper.js owns the max-run-turns counter (it accounts for live
// runs as they happen), so the setter lives there and is registered
// with me via registerMaxRunTurnsSetter. Same pattern for intake's
// setMaxIntake — loaded lazily to avoid a load-order cycle through
// the scheduler.

let _setMaxRunTurns = null;
export function registerMaxRunTurnsSetter(fn) {
  if (typeof fn === "function") _setMaxRunTurns = fn;
}

// ─────────────────────────────────────────────────────────────────
// THE SWITCH
// ─────────────────────────────────────────────────────────────────
//
// Genesis hands me each remembered setting through this single
// switch. I route by key — the call-surround knobs (failover
// timeout) forward into llmCall's setter; the reel knobs forward
// into reel's setters; the loop-shape knobs clamp my local state;
// the run-turn cap forwards into the registered stamper setter;
// the intake cap loads lazily. One entry, every clamp deliberate.

export function setInternalConfig(key, value) {
  const num = Number(value);
  switch (key) {
    case "llmTimeout":
      setLlmTimeout(Math.max(5000, Math.min(num * 1000, 30 * 60 * 1000)));
      break;
    case "llmMaxRetries":
      LLM_MAX_RETRIES = Math.max(0, Math.min(num, 10));
      break;
    case "maxToolIterations":
      MAX_TOOL_ITERATIONS = Math.max(1, Math.min(num, 100));
      break;
    case "maxConversationMessages":
      MAX_MESSAGES = Math.max(4, Math.min(num, 200));
      break;
    case "maxRunTurns":
      if (_setMaxRunTurns) _setMaxRunTurns(num);
      break;
    case "maxIntake":
      // Lazy: intake imports the scheduler, which imports the
      // stamper, which imports back into config.js. Defer the
      // load to avoid the cycle.
      import("./intake/intake.js").then((m) => m.setMaxIntake(num)).catch(() => {});
      break;
    case "failoverTimeout":
      setFailoverTimeout(Math.max(1000, Math.min(num * 1000, 120000)));
      break;
    case "toolCallTimeout":
      TOOL_CALL_TIMEOUT_MS = Math.max(5000, Math.min(num * 1000, 600000));
      break;
    case "toolResultMaxBytes":
      TOOL_RESULT_MAX_BYTES = Math.max(1000, Math.min(num, 1000000));
      break;
    case "maxPresences":
      setMaxPresenceReels(num);
      break;
    case "stalePresenceTimeout":
      setStalePresenceMs(num * 1000);
      break;
  }
}
