// harmony:grid-event — a marker op whose only job is to stamp a fact
// on the grid space's reel.
//
// The fact's `action` field is what foldGridUpToSeq filters on; the
// fact's `params` carry the event payload ({event, beingId, from?, to}).
// The handler does no state mutation — the grid space's qualities
// aren't touched; the trail is the reel, period.
//
// Pure "audit-only fact" pattern. The op exists so the auto-Fact
// mechanism (doVerb's emit at the end) lands a fact with our op
// name on the right reel, riding the moment's actId + deltaF.

export default {
  name: "grid-event",  // becomes harmony:grid-event
  targets: ["space"],

  async handler({ target, params }) {
    // No state mutation. The fact itself is the record.
    //
    // Audit-target pin. do.js's resolveAuditTarget reads
    // result.beingId / spaceId / matterId BEFORE falling back to the
    // call target. Returning `beingId` here without a _factTarget
    // hint silently retargets the fact to the dancer being, which
    // makes foldGridUpToSeq's query (target.kind: "space") miss
    // every event and every dancer reads an empty board. Pin the
    // grid space as the audit target so the fact lands on the reel
    // the fold actually reads.
    const gridSpaceId = typeof target === "string"
      ? target
      : String(target?._id || target?.id || "");
    return {
      _factTarget: { kind: "space", id: gridSpaceId },
      event: params?.event || null,
      beingId: params?.beingId || null,
      from: params?.from || null,
      to: params?.to || null,
    };
  },
};
