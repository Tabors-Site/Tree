// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// begin.js — the row reservation. Open the frame so children write
// into it.
//
// The Stamp row needs to exist before momentum runs so every DO and
// BE the being emits during the moment can carry the stampId. That
// row is what gets pressed shut by stamped.js at moment-close.
//
// Why this is its own file, not part of assign.js:
//
// assign() resolves WHO acts (being + role) and builds the summon
// context. It's called once per stamping by the scheduler. But
// assign() does NOT call beginStamping itself — because the row write
// needs voice-specific provenance (the LLM voice writes its provider
// model + connection into the row; scripted and human voices write
// nothing). assign has no way to know which voice will run.
//
// So beginStamping is called by the VOICE that's about to run
// momentum, after it has its provider info in hand. The LLM voice
// calls it inside runTurn; the BE-register audit path in verbs.js
// calls it directly (begin + stamp back-to-back, no momentum). All
// three places use the same write surface — this file.
//
// Counterpart: [stamped.js](./stamped.js) presses the closing face
// on the row this file opened.

import log from "../../system/log.js";
import { v4 as uuidv4 } from "uuid";
import Stamp from "../../models/stamp.js";
import { computeIbpStampAddress } from "../../ibp/address.js";
import { capContent } from "./stamped.js";

/**
 * Reserve the Stamp row at the start of a being's moment so DOs/BEs
 * emitted during the moment carry the stampId. The row is filled
 * with start-side fields (beingIn/beingOut, ibpAddress, activeRole,
 * inReplyTo, rootCorrelation, parentThread, receivedAt, stampedAt,
 * startMessage, llmProvider) and an open endMessage. The closing
 * press happens in stamped.js via `stamp({ stampId, content })`.
 */
export async function beginStamping(opts = {}) {
  const {
    beingIn,
    beingOut = null,
    askerPosition = null,
    addresseePosition = null,
    message,
    source = "user",
    activeRole = null,
    llmProvider = null,
    inboxMessageId = null,
    inReplyTo = null,
    rootCorrelation = null,
    receivedAt = null,
    parentThread: parentThreadOpt = null,
  } = opts;

  if (!beingIn) {
    log.warn("Begin", "beginStamping called without beingIn");
    return null;
  }

  let resolvedRoot = rootCorrelation || null;

  // Resolve rootCorrelation: when there's a parent and no explicit root,
  // inherit the parent's rootCorrelation so audit walks see the whole
  // reply chain rooted at the originating user message.
  if (!resolvedRoot && inReplyTo) {
    try {
      const parent = await Stamp.findById(inReplyTo)
        .select("rootCorrelation")
        .lean();
      resolvedRoot = parent?.rootCorrelation || inReplyTo;
    } catch {
      resolvedRoot = inReplyTo;
    }
  }

  const stampId = uuidv4();
  // A summon with no parent IS its own root.
  if (!resolvedRoot) resolvedRoot = stampId;

  // Spawn-lineage auto-stamp. When the asker is currently acting
  // under another rootCorrelation (running inside thread A) and
  // emits a fresh top-level SUMMON (no inReplyTo, so a new chain),
  // the kernel records that the new chain was spawned from thread A.
  // Without this stamp the forest is unwalkable: spawned threads
  // would look like roots with no lineage. The scheduler holds the
  // asker's currentRootCorrelation; we read it here so beings don't
  // have to remember to pass it.
  //
  // Three cases:
  //   - parentThreadOpt passed explicitly  → use it (caller knows)
  //   - inReplyTo set                       → null (it's a reply, same thread)
  //   - else (fresh spawn)                  → look up scheduler.currentRoot
  let resolvedParentThread = parentThreadOpt;
  if (resolvedParentThread == null && !inReplyTo) {
    try {
      const { getCurrentRootCorrelation } = await import("../intake/scheduler.js");
      const currentRoot = getCurrentRootCorrelation(String(beingIn));
      if (currentRoot && currentRoot !== resolvedRoot) {
        resolvedParentThread = currentRoot;
      }
    } catch {
      // Scheduler unavailable (pre-cognition boot, tests). Leave parentThread null.
    }
  }

  const ibpAddress = await computeIbpStampAddress({
    askerBeingId: beingIn,
    askerPosition,
    addresseeBeingId: beingOut,
    addresseePosition,
  });

  const now = new Date();
  const safeMessage = capContent(message);

  try {
    const row = await Stamp.create({
      _id: stampId,
      beingIn,
      beingOut: beingOut || null,
      ibpAddress,
      activeRole,
      inboxMessageId,
      inReplyTo,
      rootCorrelation: resolvedRoot,
      parentThread: resolvedParentThread,
      receivedAt: receivedAt || now,
      stampedAt: now,
      startMessage: { content: safeMessage, source },
      llmProvider: llmProvider
        ? {
            model: llmProvider.model || null,
            connectionId: llmProvider.connectionId || null,
          }
        : { model: null, connectionId: null },
    });
    return row;
  } catch (err) {
    log.warn("Begin", `beginStamping failed: ${err.message}`);
    return null;
  }
}
