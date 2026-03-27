import log from "../../seed/log.js";
import { escapeRegex } from "../../seed/utils.js";
import { queueCanopyEvent } from "../../canopy/events.js";
import { extractTaggedUsersAndRewrite, syncTagsForNote, clearTagsForNote } from "./tags.js";
import { getPendingInvitesForUser, respondToInvite } from "./invites.js";
import { buildRouter } from "./routes.js";

export async function init(core) {
  const { User } = core.models;

  // ── Hook: beforeNote (rewrite @mentions to canonical usernames) ────
  core.hooks.register("beforeNote", async (hookData) => {
    if (hookData.contentType === "text" && hookData.content) {
      const { rewrittenContent } = await extractTaggedUsersAndRewrite(hookData.content, User);
      hookData.content = rewrittenContent;
    }
  }, "team");

  // ── Hook: afterNote (sync NoteTag records) ────────────────────────
  core.hooks.register("afterNote", async (data) => {
    const { note, action, nodeId, userId } = data;

    if (action === "delete") {
      await clearTagsForNote(note._id);
      return;
    }

    if ((action === "create" || action === "edit") && note.contentType === "text") {
      await syncTagsForNote({
        noteId: note._id,
        content: note.content,
        nodeId,
        taggedBy: userId,
        User,
      });
    }
  }, "team");

  log.verbose("Team", "Hooks registered (beforeNote, afterNote)");

  const router = buildRouter(core, { escapeRegex, queueCanopyEvent });

  const { Node, Note } = core.models;
  const { logContribution } = core.contributions;

  // Pre-bound: callers just pass inviteId/userId/acceptInvite, no deps needed
  async function boundRespondToInvite({ inviteId, userId, acceptInvite }) {
    return respondToInvite({
      inviteId,
      userId,
      acceptInvite,
      Node,
      User,
      logContribution,
      queueCanopyEvent,
    });
  }

  const canopyHandlers = await import("./canopyHandlers.js");

  return {
    router,
    exports: {
      getPendingInvitesForUser,
      respondToInvite: boundRespondToInvite,
      canopyHandlers,
    },
  };
}
