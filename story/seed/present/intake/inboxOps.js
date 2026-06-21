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
// For each pending entry, we attach a `render` spec via the inbox
// renderer registry (seed/present/intake/inboxRenderers.js). The spec
// is JSON-serializable; the panel renders it without knowing the intent
// or having any intent-specific switches. Renderers are server-side and
// keyed by envelope intent; seed ships one for "role-request", and
// extensions add their own through story.registerInboxRenderer.
// Roles with no matching renderer get `render: null` and the panel
// falls back to a generic free-text reply surface.

import { registerSeeOperation } from "../../ibp/seeOps.js";
import { loadOrFold } from "../../materials/projections.js";
import { buildInboxRenderSpec } from "./inboxRenderers.js";
import { getStoryDomain } from "../../ibp/address.js";

registerSeeOperation("my-inbox", {
  ownerExtension: "seed",
  description: "The caller's pending inbox — every open summon addressed to them. Returns {pending: [...]} sorted newest-first; each entry carries a `render` spec the panel uses verbatim.",
  handler: async ({ identity, history }) => {
    if (!identity?.beingId) return { pending: [], total: 0 };
    const InboxProjection = (await import("../../past/projections/inbox/inboxProjection.js")).default;
    const rows = await InboxProjection.find({
      recipient: String(identity.beingId),
      ...(history ? { history } : {}),
    })
      .sort({ sentAt: -1 })
      .lean();
    // Enrich with summoner names so the panel can render @from
    // without a second round-trip per row.
    const story = getStoryDomain();
    const enriched = [];
    for (const r of rows) {
      let summonerName = null;
      if (r.summoner) {
        try {
          const slot = await loadOrFold("being", String(r.summoner), history || "0");
          summonerName = slot?.state?.name || null;
        } catch { /* best effort */ }
      }
      const entry = {
        correlation:  r._id,
        summoner:     r.summoner,
        summonerName,
        sender:       r.sender,
        content:      r.content,
        priority:     r.priority,
        sentAt:       r.sentAt,
        history:      r.history,
        inboxSpaceId: r.inboxSpaceId,
        // Envelope intent (canonical, per seed/SUMMON.md). The fallback
        // to content.intent is a one-release transition for callers that
        // still send intent inside content; the auth gate reads ONLY
        // envelope intent, so anything not on the envelope is hint-only.
        intent: r.intent
          || (r.content && typeof r.content === "object" ? r.content.intent || null : null),
      };
      // Build the render spec from the renderer registry. Null when no
      // renderer matches; the panel then uses its default free-text
      // surface. Renderer errors are logged and treated as null.
      entry.render = await buildInboxRenderSpec(entry, {
        story,
        history:  r.history || history || "0",
        identity,
      });
      enriched.push(entry);
    }
    return { pending: enriched, total: enriched.length };
  },
});
