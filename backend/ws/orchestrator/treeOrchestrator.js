// ws/orchestrator.js
// High-level tree orchestrator: intent → execute
// Navigation is treated as a NORMAL MODE (no pre-routing)

import {
  switchMode,
  processMessage,
  getCurrentMode,
  getRootId,
} from "../conversation.js";
import { determineIntent } from "../modes/intent.js";

/**
 * Emit a status event to the frontend (greyed-out system message).
 */
function emitStatus(socket, phase, text) {
  socket.emit("executionStatus", { phase, text });
}

export async function orchestrateTreeRequest({
  visitorId,
  message,
  socket,
  username,
  userId,
  signal,
}) {
  if (signal?.aborted) return null;

  const rootId = getRootId(visitorId);
  const meta = { username, userId, rootId };

  const originalMode = getCurrentMode(visitorId) || "tree:structure";

  /* ────────────────────────────────────────────────────── */
  /* STEP 1: INTENT                                         */
  /* ────────────────────────────────────────────────────── */

  emitStatus(socket, "mode", "Deciding approach…");

  const decision = determineIntent({
    message,
    currentMode: originalMode,
  });

  const executionMode =
    decision.action === "switch" && decision.confidence >= 1
      ? decision.targetMode
      : originalMode;

  const isModeChange = executionMode !== originalMode;

  switchMode(visitorId, executionMode, {
    ...meta,
    clearHistory: isModeChange,
  });

  socket.emit("modeSwitched", {
    modeKey: executionMode,
    emoji: getModeEmoji(executionMode),
    label: getModeLabel(executionMode),
    silent: true,
  });

  /* ────────────────────────────────────────────────────── */
  /* STEP 2: EXECUTE                                       */
  /* ────────────────────────────────────────────────────── */

  emitStatus(socket, "execute", "Working…");

  const response = await processMessage(visitorId, message, {
    username,
    userId,
    rootId,
    signal,
    onToolResults(results) {
      if (signal?.aborted) return;
      for (const r of results) {
        socket.emit("toolResult", r);
      }
    },
  });

  emitStatus(socket, "done", "");
  return response;
}

/* ─────────────────────────────────────────────────────────── */
/* Mode metadata                                               */
/* ─────────────────────────────────────────────────────────── */

const MODE_META = {
  "tree:structure": { emoji: "🏗️", label: "Structure" },
  "tree:edit": { emoji: "✏️", label: "Edit" },
  "tree:be": { emoji: "🎯", label: "Be" },
  "tree:reflect": { emoji: "🔮", label: "Reflect" },
  "tree:navigate": { emoji: "🧭", label: "Navigate" },
    "tree:understand": {  emoji: "🧠",
  label: "Understand"},

};

function getModeEmoji(modeKey) {
  return MODE_META[modeKey]?.emoji || "🌳";
}

function getModeLabel(modeKey) {
  return MODE_META[modeKey]?.label || modeKey.split(":")[1] || "Tree";
}
