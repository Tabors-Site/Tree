// Auto-release a being when its LAST socket drops (tab close, browser crash,
// network loss). Presence hygiene: a being shouldn't read as actively driven
// after every tab connected to it is gone. Ref-counting lives in websocket.js
// (the authSessions map); this module owns the GRACE timers + the
// fire-and-forget be:release dispatch.
//
// The grace window matters: a tab that drops and reconnects (a wifi blip, a
// laptop sleep, a deploy bounce) must NOT churn a be:release then a be:connect
// fact pair every time. So the last socket closing only SCHEDULES a release;
// a (re)connect for the same being within the window CANCELS it. Only a being
// that stays fully disconnected past the grace is actually released.
//
// The release rides cherub exactly like an explicit wire be:release: the
// dispatch opens cherub's moment, beVerb("release") locks the being's signing
// latch and stamps the be:release fact on its reel. There is no socket to push
// the reply to (the tab is gone), so it is fire-and-forget.

import log from "../../seed/seedReality/log.js";

const DEFAULT_GRACE_MS = 20_000;
const _pending = new Map(); // beingId -> timeoutId

/**
 * Schedule a be:release for `beingId` after the grace window, unless a
 * reconnect cancels it first. Idempotent: re-scheduling collapses to one timer.
 */
export function scheduleAutoRelease(beingId, { name = null, branch = "0", graceMs = DEFAULT_GRACE_MS } = {}) {
  if (!beingId) return;
  cancelAutoRelease(beingId);
  const timer = setTimeout(() => {
    _pending.delete(String(beingId));
    dispatchRelease(beingId, name, branch).catch((err) =>
      log.warn("WS", `auto-release dispatch for ${String(beingId).slice(0, 12)} failed: ${err.message}`));
  }, graceMs);
  // Don't let a pending release hold the event loop open at shutdown.
  if (typeof timer.unref === "function") timer.unref();
  _pending.set(String(beingId), timer);
}

/** Cancel a pending auto-release (a tab for this being (re)connected). */
export function cancelAutoRelease(beingId) {
  if (!beingId) return;
  const timer = _pending.get(String(beingId));
  if (timer) {
    clearTimeout(timer);
    _pending.delete(String(beingId));
  }
}

/** Test/inspection: is a release currently scheduled for this being? */
export function hasPendingAutoRelease(beingId) {
  return _pending.has(String(beingId));
}

async function dispatchRelease(beingId, name, branch) {
  if (!name) {
    // Without the being's name we can't form its stance address; skip rather
    // than guess (a named being is the normal authenticated case).
    log.debug("WS", `auto-release skipped for ${String(beingId).slice(0, 12)}: no name`);
    return;
  }
  const { dispatchTransportAct } = await import("../../seed/present/intake/transportAct.js");
  const { findByName } = await import("../../seed/materials/projections.js");
  const { getRealityDomain } = await import("../../seed/ibp/address.js");

  // cherub owns the BE moment, identical to the wire's handleBe.
  const cherubSlot = await findByName("being", "cherub", "0");
  if (!cherubSlot?.id) return;
  const address = `${getRealityDomain()}/@${name}`;
  await dispatchTransportAct({
    beingId: String(cherubSlot.id),
    act: {
      verb: "be",
      act:  "release",
      args: {
        opPayload:      {},
        address,
        addressKind:    "stance",
        callerIdentity: { beingId: String(beingId), name },
      },
    },
    identity: { beingId: String(beingId), name },
    branch:   branch || "0",
  });
  log.debug("WS", `auto-released @${name} after its last tab closed`);
}
