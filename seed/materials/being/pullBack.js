// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Pull-back safety. A being whose position is foreign must not be
// stuck there if the home substrate restarts, the session times out,
// or the foreign substrate becomes unreachable.
//
// Per CROSS-WORLD.md "Pull-back safety":
//
//   On home substrate startup, scan beings whose position names a
//   foreign story or history. For each, check whether the foreign
//   substrate has confirmed liveness within a configured window. If
//   not (timeout / restart crossed the heartbeat threshold), stamp a
//   `set-being:position` fact on the home reel that resets the
//   being's position to their home space. If the foreign story is
//   reachable, also stamp a corresponding departure fact on the
//   foreign reel; best-effort. If unreachable, home unilaterally
//   pulls back; the foreign reconciles at its next sync cycle.
//
//   The guarantee: a being's identity is never hostage to a foreign
//   story being available. Worst case they come back home; they
//   don't get locked at foreign.
//
// What this file does today: provide the scan + pull primitive.
// Wiring it into the boot sequence happens in genesis.js (or
// scheduler.js for an interval scan). Liveness probes against
// foreign substrates are stubbed pending the canopy gateway; until
// then every cross-world position is considered "stale" on home
// substrate restart and pulled back. The scan stays cheap because
// cross-world positions are rare until cross-story lands.

import { parsePositionAddress, formatPositionAddress, isPositionCrossWorld } from "./positionAddress.js";
import { getStoryDomain } from "../../ibp/address.js";
import { withIAmAct } from "../../sprout.js";

/**
 * Pull back any beings on this substrate whose position names a
 * foreign world. Stamps a set-being:position fact on the home reel
 * resetting the being to homeSpace. Returns the count of beings
 * pulled back; zero when no beings were foreign.
 *
 * No-op when the substrate has no foreign-positioned beings (the
 * common case). Intended to run once at boot and as a periodic
 * health pass while cross-story is in use.
 *
 * @returns {Promise<{ pulledBack: number, scanned: number }>}
 */
export async function pullBackForeignPositions() {
  // Query the projection cache — the canonical source of current being
  // state (per the projection-cache doctrine). The legacy Being collection
  // isn't kept in sync with qualities/position; projections is the truth.
  //
  // CURATED swap: the raw Projection.find regex-prefilter became the curated
  // listByType("being", "0") (live beings on main, tombstones already
  // filtered) + a per-id loadProjection to read state.position/homeSpace.
  // The coarse "/"-segment regex was only a scan-narrowing optimization;
  // isPositionCrossWorld below is the authoritative cross-world test, so the
  // JS filter loses nothing.
  const { listByType, loadProjection } =
    await import("../projections.js");
  const homeStory = getStoryDomain();
  const homeRealm   = { story: homeStory, history: "0" };

  const occupants = await listByType("being", "0");
  const candidates = [];
  for (const occ of occupants) {
    const slot = await loadProjection("being", occ.id, "0");
    if (!slot) continue;
    candidates.push({
      id: occ.id,
      state: { position: slot.state?.position, homeSpace: slot.state?.homeSpace },
    });
  }

  let pulled = 0;
  for (const row of candidates) {
    const being = {
      _id: row.id,
      position: row.state?.position,
      homeSpace: row.state?.homeSpace,
    };
    if (!isPositionCrossWorld(being.position, homeRealm)) continue;
    const parts = parsePositionAddress(being.position);
    if (!parts) continue;

    // Resolved home position. Falls back to the parsed bare spaceId
    // when homeSpace is unset (legacy beings); we accept the bare
    // spaceId as same-world rather than throw so the pull-back
    // primitive stays robust.
    const homeSpaceId = being.homeSpace || parts.spaceId;
    if (!homeSpaceId) continue;

    await withIAmAct(`pull-back ${String(being._id).slice(0, 8)}`, async (ctx) => {
      const { doVerb } = await import("../../ibp/verbs/do.js");
      await doVerb(
        { kind: "being", id: String(being._id) },
        "set-being",
        {
          field: "position",
          value: formatPositionAddress({ spaceId: homeSpaceId }),
        },
        { identity: { beingId: String(being._id), name: null }, moment: ctx },
      );
    });
    pulled++;
  }
  return { pulledBack: pulled, scanned: candidates.length };
}
