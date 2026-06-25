// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// reel.js . the durable record's prompt-side fold.
//
// A being doesn't persist across moments. Each moment that needs to
// see what came before folds the durable Act collection (per
// ibpAddress) into prompt context. The fold runs FRESH every moment;
// there is no in-memory chat buffer that lives across moments.
//
// This file used to keep an in-memory `reels` Map with a `messages`
// array per presence lane . the chat-shape sidecar that the LLM
// rebuild retired. With session.messages gone, the only thing that
// lives here is the helper that reads sealed Acts for the next
// prompt and the carry-limit knob.
//
// Keyed by presenceKey . the lane the being is continuously present
// in. For being-to-being summons that's the IBP Address
// (stance::stance); for stanceless internal cognition it's the
// pipeline key. Ephemeral pipeline keys early-return [] (those lanes
// are stateless by design).

import log from "../../../seedStory/log.js";
import { findByIbpAddress } from "./reelChains.js";

// Compatibility stubs. The in-memory reel cache and its CARRY_MESSAGES
// tail retired with the forward-fold rebuild (a forward moment reads
// the world, not the act-chain, so there is no tail to carry). knobs.js
// still routes setMaxPresenceReels / setStalePresenceMs through
// internalConfig; keep them as no-ops so the wiring doesn't throw at
// boot. CARRY_MESSAGES the knob is gone entirely . it claimed to
// configure how many prior Acts feed the prompt, which is zero per
// MODEL.md forward-fold doctrine.
export function setMaxPresenceReels(_n) {
  /* no-op . in-memory reel cache retired with the LLM rebuild */
}
export function setStalePresenceMs(_ms) {
  /* no-op . in-memory reel cache retired with the LLM rebuild */
}

/**
 * Resolve the presence key for this turn. Two reaches sitting in the
 * same IBPA share one prompt-history lane end to end (folded from the
 * same Acts). Today every caller hands the resolved key in as fallback;
 * the ctx slot is reserved for an explicit IBPA lane.
 */
export function presenceKeyFor(_ctx, fallback) {
  return fallback;
}

/**
 * Number of folded reels held in memory. The in-memory cache is gone;
 * this returns 0. Kept so health probes calling it don't break.
 */
export function getReelCount() {
  return 0;
}

/**
 * RECENCY WINDOW (not recall). Returns the most recent N sealed Acts
 * on a lane as user/assistant pairs. Useful for explicit transitional
 * tooling that wants a quick lookback over an IBPA, but DO NOT inject
 * the return value into an LLM moment's prompt by default.
 *
 * Per MODEL.md + INNER-FOLD.md, a forward fold does NOT read A_b. A
 * forward moment's prompt is system + user only . no past. The
 * dance is harmonic because each forward voice reacts to the world
 * it sees NOW; secretly carrying prior Acts every moment makes every
 * being a contemplative and breaks that property.
 *
 * "Recall" (the half-fold's A_b surface) is the braid-walk:
 * INNER-FOLD §3 . past acts causally stitched to entities in the
 * current face. Recency is NOT braid-walk. When half-orientation is
 * built, recall plugs in at llmMoment's orientation seam and does
 * NOT call this function.
 *
 * Keeping the helper here so transitional callers (replay tooling,
 * audit views, the legacy chat console) still have a quick way to
 * read recent IBPA Acts. The LLM voice no longer uses it.
 */
export async function foldMessagesFromReel(presenceKey, opts = {}) {
  if (!presenceKey || typeof presenceKey !== "string") return [];
  if (!presenceKey.includes("::")) return [];
  const limit = Math.max(1, Math.min(Number(opts.limit) || 50, 500));
  let acts;
  try {
    acts = await findByIbpAddress(presenceKey, { limit });
  } catch (err) {
    log.debug("Reel", `foldMessagesFromReel skipped: ${err.message}`);
    return [];
  }
  if (!Array.isArray(acts) || acts.length === 0) return [];
  // findByIbpAddress returns newest-first; the prompt wants oldest-
  // first so the most recent moment is the last user/assistant pair
  // before the live envelope appends.
  acts.reverse();
  const messages = [];
  for (const act of acts) {
    const startContent = act?.startMessage?.content;
    const endContent = act?.endMessage?.content;
    if (typeof startContent === "string" && startContent.length > 0) {
      messages.push({ able: "user", content: startContent });
    }
    if (typeof endContent === "string" && endContent.length > 0) {
      messages.push({ able: "assistant", content: endContent });
    }
  }
  return messages;
}
