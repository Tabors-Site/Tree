// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// inboxOps.js — read surface over the caller's inbox.
//
// SEE "my-inbox" returns every pending InboxProjection row addressed
// to the calling being. Each row is an open summon waiting to be
// processed. Responding is NOT a separate operation — it's a normal
// SUMMON back with `inReplyTo: <correlation>`. The existing
// inboxProjectionFold handler closes the row when the reply lands.
//
// When the response carries a side effect (e.g. "approve a role
// request" → grant-role for the asker), the caller dispatches that
// op separately. The inbox doesn't try to bundle two acts into one;
// the portal panel just orchestrates: do(grant-role), then summon(reply).

import { registerSeeOperation } from "../../ibp/seeOps.js";
import { loadOrFold } from "../../materials/projections.js";

registerSeeOperation("my-inbox", {
  ownerExtension: "seed",
  description: "The caller's pending inbox — every open summon addressed to them. Returns {pending: [...]} sorted newest-first.",
  handler: async ({ identity, branch }) => {
    if (!identity?.beingId) return { pending: [], total: 0 };
    const InboxProjection = (await import("../../past/projections/inbox/inboxProjection.js")).default;
    const rows = await InboxProjection.find({
      recipient: String(identity.beingId),
      ...(branch ? { branch } : {}),
    })
      .sort({ sentAt: -1 })
      .lean();
    // Enrich with summoner names so the panel can render @from
    // without a second round-trip per row.
    const enriched = [];
    for (const r of rows) {
      let summonerName = null;
      if (r.summoner) {
        try {
          const slot = await loadOrFold("being", String(r.summoner), branch || "0");
          summonerName = slot?.state?.name || null;
        } catch { /* best effort */ }
      }
      enriched.push({
        correlation:  r._id,
        summoner:     r.summoner,
        summonerName,
        sender:       r.sender,
        content:      r.content,
        priority:     r.priority,
        sentAt:       r.sentAt,
        branch:       r.branch,
        inboxSpaceId: r.inboxSpaceId,
        // Extract the intent from content for easy panel-side
        // switching. Convention only — the substrate doesn't care.
        intent: r.content && typeof r.content === "object"
          ? r.content.intent || null
          : null,
      });
    }
    return { pending: enriched, total: enriched.length };
  },
});
