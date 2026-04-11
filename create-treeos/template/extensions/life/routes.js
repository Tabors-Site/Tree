import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import log from "../../seed/log.js";
import { getAvailableDomains, addDomain, findLifeRoot, getDomainNodes } from "./core.js";

const router = express.Router();

/**
 * POST /life/add
 * Operator shortcut: add a single domain to the user's Life tree.
 * Body: { domain: "food" }
 */
router.post("/life/add", authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const { domain } = req.body;

    if (!domain) {
      return sendError(res, 400, ERR.INVALID_INPUT, "domain required");
    }

    const available = new Set(getAvailableDomains());
    const normalized = domain.toLowerCase();
    if (!available.has(normalized)) {
      return sendError(res, 400, ERR.INVALID_INPUT, `Unknown domain "${domain}". Available: ${[...available].join(", ")}`);
    }

    // Find Life root or create one
    let rootId = await findLifeRoot(userId);
    if (!rootId) {
      const { scaffoldRoot } = await import("./core.js");
      const result = await scaffoldRoot(userId);
      rootId = result.rootId;
    }

    const result = await addDomain({ rootId, domain: normalized, userId });

    // Rebuild routing index
    try {
      const { rebuildIndexForRoot } = await import("../tree-orchestrator/routingIndex.js");
      await rebuildIndexForRoot(rootId);
    } catch {}

    sendOk(res, result);
  } catch (err) {
    log.error("Life", "Add domain error:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /life/domains
 * List available domains (installed extensions with scaffold support).
 */
router.get("/life/domains", authenticate, async (req, res) => {
  const available = getAvailableDomains();
  const rootId = await findLifeRoot(req.userId);
  let scaffolded = {};
  if (rootId) {
    scaffolded = await getDomainNodes(rootId);
  }
  sendOk(res, {
    available,
    scaffolded: Object.keys(scaffolded),
    rootId: rootId || null,
  });
});

export default router;
