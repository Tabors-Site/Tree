/**
 * Swarm HTTP routes.
 *
 * One endpoint:
 *
 *   POST /api/v1/root/:rootId/swarm-plans/branches/:branchName/generate
 *     Body: { branchNodeId }
 *     Fires the architect at the branch node. Its response flows
 *     through dispatch.js's pause-and-stash path, so the user sees
 *     the proposed sub-plan card in their chat.
 *
 * Branch step editing (spec, files, mode, slot rename) used to live
 * here too, but is now handled by the plan extension's own PATCH
 * /api/v1/plan/node/:nodeId/steps/:stepId endpoint. Plan owns the
 * primitive; swarm only owns dispatch.
 */

import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import Node from "../../seed/models/node.js";
import { NS } from "./state/meta.js";
import log from "../../seed/log.js";

const router = express.Router();

router.post("/root/:rootId/swarm-plans/branches/:branchName/generate", authenticate, async (req, res) => {
  try {
    const { rootId, branchName } = req.params;
    const { branchNodeId } = req.body || {};
    if (!branchNodeId) {
      return sendError(res, 400, ERR.INVALID_INPUT, "branchNodeId required");
    }

    const branchNode = await Node.findById(branchNodeId).select("_id name metadata parent").lean();
    if (!branchNode) return sendError(res, 404, ERR.NODE_NOT_FOUND, "branch node not found");

    const swarm = branchNode.metadata instanceof Map
      ? branchNode.metadata.get(NS)
      : branchNode.metadata?.[NS];
    const spec = swarm?.spec || `Build out the "${branchName}" branch of this project.`;

    const { runChat } = await import("../../seed/llm/conversation.js");
    const userId = req.userId;
    const username = req.username || "user";
    const architectMsg =
      `Generate a [[BRANCHES]] plan for this branch's scope:\n\n` +
      `Branch: ${branchName}\n` +
      `Spec: ${spec}\n\n` +
      `Emit the complete [[BRANCHES]] block. If the branch needs an integration file at this scope, write it as this Ruler's own file (do not create a separate branch for it). Close with [[DONE]].`;

    runChat({
      userId,
      username,
      message: architectMsg,
      mode: "tree:code-plan",
      rootId,
      nodeId: branchNodeId,
      // Sub-plan generation is one-shot — default ephemeral session.
      llmPriority: "INTERACTIVE",
    }).catch((err) =>
      log.warn("Swarm", `sub-plan generation failed for ${branchName}: ${err.message}`),
    );

    log.info("Swarm",
      `⎇ sub-plan generation requested: ${branchName} @ ${String(branchNodeId).slice(0, 8)} (user=${userId || "?"})`,
    );
    return sendOk(res, { proposed: true, branchName, branchNodeId });
  } catch (err) {
    log.warn("Swarm", `sub-plan generate failed: ${err.message}`);
    return sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
