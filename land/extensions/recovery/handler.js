/**
 * Recovery Handler
 *
 * Decides which mode to use. Does NOT call runChat.
 * The orchestrator executes on its own session.
 *
 * Returns { mode, message?, answer?, setup? }
 *   - mode: which mode the orchestrator should switch to
 *   - message: override message for the AI (optional)
 *   - answer: direct response, skip AI call (optional)
 *   - setup: true if this is a first-time scaffold
 */

import { createNote } from "../../seed/tree/notes.js";
import {
  isInitialized,
  getSetupPhase,
  completeSetup,
  scaffold,
  findRecoveryNodes,
  parseCheckIn,
  recordDoses,
  recordCraving,
  recordMood,
  recordEnergy,
  getStatus,
} from "./core.js";

export async function handleMessage(message, { userId, username, rootId, targetNodeId }) {
  const recoveryRoot = targetNodeId || rootId;

  // ── First use: scaffold if this is the extension's own node (not tree root) ──
  const initialized = await isInitialized(recoveryRoot);
  if (!initialized) {
    if (String(recoveryRoot) !== String(rootId)) {
      await scaffold(recoveryRoot, userId);
    }
    return { mode: "tree:recovery-plan", setup: true };
  }

  // ── Auto-complete setup if structural nodes exist ──
  const phase = await getSetupPhase(recoveryRoot);
  if (phase === "base") {
    const nodes = await findRecoveryNodes(recoveryRoot);
    if (nodes && Object.keys(nodes).length > 0) {
      await completeSetup(recoveryRoot);
    }
  }

  const nodes = await findRecoveryNodes(recoveryRoot);

  // ── "be" / "begin" command: guided check-in ──
  const lower = message.trim().toLowerCase();
  if (lower === "be" || lower === "begin") {
    return { mode: "tree:recovery-log" };
  }

  // ── Review: progress, milestones, patterns ──
  if (/\b(progress|milestone|pattern|history|how.*long|streak|days.*clean|sober|how am i|how's my|trend|week|month|review|doing)\b/i.test(message)) {
    return { mode: "tree:recovery-review" };
  }

  // ── Planning: taper, schedule, goals ──
  if (/\b(plan|add.*substance|remove|adjust|taper|schedule|change|goal|slow down|speed up|set.*target|change.*target)\b/i.test(message)) {
    return { mode: "tree:recovery-plan" };
  }

  // ── Journal ──
  if (/\b(journal|just writing|need to write|vent)\b/i.test(message) && nodes?.journal) {
    try {
      await createNote({ nodeId: nodes.journal.id, content: message, contentType: "text", userId });
    } catch {}
    return { answer: "Written.", mode: "tree:recovery-log" };
  }

  // ── Check-in (default): parse, record data, return status ──
  const parsed = await parseCheckIn(message, userId, username, recoveryRoot);

  if (parsed) {
    // Record substances
    if (parsed.substances) {
      for (const sub of parsed.substances) {
        if (sub.name && sub.doses != null) {
          try { await recordDoses(nodes, sub.name, sub.doses); } catch {}
        }
      }
    }

    // Record cravings
    if (parsed.cravings) {
      for (const cr of parsed.cravings) {
        try { await recordCraving(nodes, cr.intensity || 0, !!cr.resisted, cr.trigger || null); } catch {}
      }
    }

    // Record mood
    if (parsed.mood?.score != null) {
      try { await recordMood(nodes, parsed.mood.score); } catch {}
    }

    // Record energy
    if (parsed.energy != null) {
      try { await recordEnergy(nodes, parsed.energy); } catch {}
    }

    // Write note to Log
    if (nodes?.log) {
      try {
        const noteContent = parsed.context || message;
        await createNote({ nodeId: nodes.log.id, content: noteContent, contentType: "text", userId });
      } catch {}
    }

    // Build confirmation from parsed data
    const parts = [];
    if (parsed.substances?.length > 0) {
      parts.push(parsed.substances.map(s => `${s.name}: ${s.doses}`).join(", "));
    }
    if (parsed.mood?.score != null) parts.push(`mood: ${parsed.mood.score}`);
    if (parsed.energy != null) parts.push(`energy: ${parsed.energy}`);

    const answer = parts.length > 0 ? `Logged. ${parts.join(", ")}.` : "Logged.";
    return { answer, parsed, mode: "tree:recovery-log" };
  }

  // Nothing parsed. Let the AI handle conversationally.
  return { mode: "tree:recovery-log" };
}
