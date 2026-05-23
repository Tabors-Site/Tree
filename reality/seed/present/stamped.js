// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// stamped.js — the post stamping. The closing press.
//
// A Act is a frame on the reel. assign reserved the row at the
// front so every DO and BE emitted during the moment could carry
// the actId. This file presses the closing face — endMessage —
// onto the reserved row when the moment ends. "What was inside
// this moment" is then recovered as `Fact.find({ actId })`.
//
// This file owns nothing of the stamping itself. The face was
// assembled by assemble.js; the looking-back was folded inside the
// reel; the act was driven by moment / runTurn; the row was opened
// by assign.js. This file just presses the stamp at the back.
//
// Public surface:
//   stamp          — press the final face when the moment closes
//   capContent     — shared content-cap helper (also used by assign)

import { getRealityConfigValue } from "../realityConfig.js";
import { getInternalConfigValue } from "../internalConfig.js";
import Act from "../past/act/act.js";
import { closeInboxOnAnswer } from "../past/act/inboxProjectionFold.js";
import { noteActSealOnThread } from "../past/act/threadsProjectionFold.js";

function MAX_CHAT_CONTENT_BYTES() {
  return Math.max(
    10000,
    Math.min(
      Number(getInternalConfigValue("maxChatContentBytes")) || 100000,
      1000000,
    ),
  );
}

export function capContent(s) {
  if (typeof s !== "string") return s;
  const max = MAX_CHAT_CONTENT_BYTES();
  return s.length > max ? s.slice(0, max) + "... (truncated)" : s;
}

/**
 * Press the final face onto a reserved Act row when the moment
 * closes. Writes endMessage.{content,time,stopped}. Atomic guard
 * against double-press: only fires when endMessage.time is null.
 */
export async function stamp({
  actId,
  content,
  stopped = false,
} = {}) {
  if (!actId) return null;
  const endTime = new Date();
  const safeContent = content != null ? capContent(content) : null;

  const updated = await Act.findOneAndUpdate(
    { _id: actId, "endMessage.time": null },
    {
      $set: {
        "endMessage.content": safeContent,
        "endMessage.time": endTime,
        "endMessage.stopped": stopped,
      },
    },
    { new: true },
  );

  // Bucket 3 Option D (2026-05-23): two cross-cutting projections
  // hook into the Act seal because Act seals are not Fact appends
  // and don't flow through the foldEngine's per-fact dispatch.
  //
  //   1. If this Act answers a summon, evict the matching
  //      InboxProjection row. Act.answers was set at assign-time
  //      from the picked InboxProjection correlation. Atomic guard
  //      on findOneAndUpdate makes this idempotent (updated is null
  //      on second seal).
  //   2. If this Act participates in a thread (rootCorrelation
  //      set), bump the ThreadsProjection's lastAct so .threads
  //      reads stay fresh.
  //
  // Both are best-effort — projections self-heal on the next fold
  // round.
  if (updated) {
    if (updated.answers) {
      try { await closeInboxOnAnswer(updated.answers); } catch {}
    }
    if (updated.rootCorrelation) {
      try { await noteActSealOnThread(updated.rootCorrelation, endTime); } catch {}
    }
  }

  return updated;
}
