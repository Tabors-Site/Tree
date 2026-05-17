import log from "../../seed/log.js";
import { escapeRegex } from "../../seed/utils.js";
import { queueCanopyEvent } from "../../canopy/events.js";
import { extractTaggedUsersAndRewrite, syncTagsForNote, clearTagsForNote } from "./tags.js";
import { getPendingInvitesForUser, respondToInvite } from "./invites.js";
import { buildRouter } from "./routes.js";

export async function init(core) {
  const { User } = core.models;

  // ── Hook: beforeNote (rewrite @mentions to canonical usernames) ────
  core.hooks.register("beforeArtifact", async (hookData) => {
    if (hookData.contentType === "text" && hookData.content) {
      const { rewrittenContent } = await extractTaggedUsersAndRewrite(hookData.content, User);
      hookData.content = rewrittenContent;
    }
  }, "team");

  // ── Hook: afterNote (sync NoteTag records) ────────────────────────
  core.hooks.register("afterArtifact", async (data) => {
    const { note, action, nodeId, beingId } = data;

    if (action === "delete") {
      await clearTagsForNote(note._id);
      return;
    }

    if ((action === "create" || action === "edit") && note.contentType === "text") {
      await syncTagsForNote({
        noteId: note._id,
        content: note.content,
        nodeId,
        taggedBy: beingId,
        User,
      });
    }
  }, "team");

  log.verbose("Team", "Hooks registered (beforeNote, afterNote)");

  const router = buildRouter(core, { escapeRegex, queueCanopyEvent });

  const { Node, Note } = core.models;
  const { logContribution } = core.contributions;

  // Pre-bound: callers just pass inviteId/beingId/acceptInvite, no deps needed
  async function boundRespondToInvite({ inviteId, beingId, acceptInvite }) {
    return respondToInvite({
      inviteId,
      beingId,
      acceptInvite,
      Node,
      User,
      logContribution,
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
