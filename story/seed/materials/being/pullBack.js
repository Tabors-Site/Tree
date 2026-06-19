// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Pull-back safety. A being whose position is foreign must not be
// stuck there if the home substrate restarts, the session times out,
// or the foreign substrate becomes unreachable.
//
// Per CROSS-WORLD.md "Pull-back safety":
//
//   On home substrate startup, scan beings whose position names a
//   foreign story or branch. For each, check whether the foreign
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
  // Query the projection collection — the canonical source of
  // current being state (per the projection-cache doctrine).
  // The legacy Being Mongoose collection isn't kept in sync with
  // qualities/position; projections is the truth.
  const { default: Projection } = await import("../history/projection.js");
  const homeStory = getStoryDomain();
  const homeRealm   = { story: homeStory, branch: "0" };

  // Cross-world positions encode story + branch as a "/" segment;
  // bare spaceIds never contain "#" or "/". Use a coarse regex
  // pre-filter then validate in JS to avoid scanning every being.
  const candidates = await Projection.find({
    branch: "0",
    type: "being",
    "state.position": { $regex: /^[^#/]+#?[^/]*\// },
    tombstoned: { $ne: true },
  }).select("id state.position state.homeSpace").lean();

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
