import log from "../../seed/log.js";
import { escapeRegex } from "../../seed/utils.js";
import { queueCanopyEvent } from "../../canopy/events.js";
import { extractTaggedUsersAndRewrite, syncTagsForNote, clearTagsForNote } from "./tags.js";
import { getPendingInvitesForUser, respondToInvite } from "./invites.js";
import { buildRouter } from "./routes.js";

export async function init(core) {
  const { Being } = core.models;

  // ── Hook: beforeArtifact (rewrite @mentions to canonical usernames) ────
  // Origin "ibp" with string content is the editable text path; other
  // origins (filesystem, web, cross-land) hold structured content where
  // @mention rewriting doesn't apply.
  core.hooks.register("beforeArtifact", async (hookData) => {
    if (hookData.origin === "ibp" && typeof hookData.content === "string" && hookData.content) {
      const { rewrittenContent } = await extractTaggedUsersAndRewrite(hookData.content, Being);
      hookData.content = rewrittenContent;
    }
  }, "team");

  // ── Hook: afterArtifact (sync NoteTag records) ────────────────────────
  core.hooks.register("afterArtifact", async (data) => {
    const { artifact, action, nodeId, beingId, origin } = data;

    if (action === "delete") {
      if (artifact?._id) await clearTagsForNote(artifact._id);
      return;
    }

    if ((action === "create" || action === "edit") && origin === "ibp" && typeof artifact?.content === "string") {
      await syncTagsForNote({
        noteId: artifact._id,
        content: artifact.content,
        nodeId,
        taggedBy: beingId,
        User: Being,
      });
    }
  }, "team");

  log.verbose("Team", "Hooks registered (beforeArtifact, afterArtifact)");

  const router = buildRouter(core, { escapeRegex, queueCanopyEvent });

  const { Node, Artifact } = core.models;
  const { logDid } = core.dids;

  // Pre-bound: callers just pass inviteId/beingId/acceptInvite, no deps needed
  async function boundRespondToInvite({ inviteId, beingId, acceptInvite }) {
    return respondToInvite({
      inviteId,
      beingId,
      acceptInvite,
      Node,
      User,
      logDid,
      queueCanopyEvent,
    });
  }

  const canopyHandlers = await import("./canopyHandlers.js");

  // Register quick link on user profile
  try {
    const { getExtension } = await import("../loader.js");
    const treeos = getExtension("treeos-base");
    treeos?.exports?.registerSlot?.("user-quick-links", "team", ({ beingId, queryString }) =>
      `<li><a href="/api/v1/user/${beingId}/invites${queryString}">Invites</a></li>`,
      { priority: 35 }
    );

    treeos?.exports?.registerSlot?.("tree-team", "team", ({ ownerHtml, contributorsHtml, inviteFormHtml }) => {
      return `<div class="content-card">
  <div class="section-header"><h2>Team</h2></div>
  ${ownerHtml || ""}
  ${contributorsHtml || ""}
  ${inviteFormHtml || ""}
</div>`;
    }, { priority: 10 });
  } catch {}

  return {
    router,
    exports: {
      getPendingInvitesForUser,
      respondToInvite: boundRespondToInvite,
      canopyHandlers,
    },
  };
}
