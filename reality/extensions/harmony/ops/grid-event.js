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

  async handler({ params }) {
    // No state mutation. The fact itself is the record.
    return {
      event: params?.event || null,
      beingId: params?.beingId || null,
      from: params?.from || null,
      to: params?.to || null,
    };
  },
};
