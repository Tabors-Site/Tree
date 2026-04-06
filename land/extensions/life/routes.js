import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import log from "../../seed/log.js";
import { getAvailableDomains, scaffold, addDomain, findLifeRoot } from "./core.js";

const router = express.Router();

/**
 * POST /life/setup
 * Interactive setup. Body: { selections: ["food","fitness"], singleTree: true }
 * Or body: { action: "add", rootId: "...", domain: "recovery" }
 */
router.post("/life/setup", authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const { action, selections, singleTree, rootId, domain, domains } = req.body;

    // Add domain to existing tree (explicit action or domain without selections)
    if (action === "add" || (domain && !selections && !domains)) {
      const addDomain_ = domain || (Array.isArray(domains) ? domains[0] : domains);
      if (!addDomain_) return sendError(res, 400, ERR.INVALID_INPUT, "domain required for add");

      let resolvedRootId = rootId;
      if (!resolvedRootId) {
        const Node = (await import("../../seed/models/node.js")).default;
        const lifeRoot = await Node.findOne({
          rootOwner: userId, parent: { $nin: ["deleted", null] },
          "metadata.life": { $exists: true },
        }).select("_id").lean()
          || await Node.findOne({
            rootOwner: userId, name: "Life", parent: { $nin: ["deleted", null] },
          }).select("_id").lean();
        if (!lifeRoot) return sendError(res, 404, ERR.TREE_NOT_FOUND, "No Life tree found. Run 'life' first.");
        resolvedRootId = String(lifeRoot._id);
      }

      const result = await addDomain({ rootId: resolvedRootId, domain: addDomain_, userId });
      return sendOk(res, result);
    }

    // Parse selections from either `selections` array or `domains` (from CLI)
    let picks = selections;
    if (!picks && domains) {
      if (Array.isArray(domains)) {
        picks = domains.flatMap(d => d.split(/[,\s]+/)).filter(Boolean);
      } else if (typeof domains === "string") {
        picks = domains.split(/[,\s]+/).filter(Boolean);
      }
    }

    if (!picks || picks.length === 0) {
      const available = getAvailableDomains();
      return sendOk(res, {
        available,
        message: "Usage: life food fitness study (or: life --all)",
      });
    }

    // --all: scaffold all available domains
    if (picks.includes("--all") || picks.includes("all")) {
      picks = getAvailableDomains();
    }

    // Validate selections
    const available = new Set(getAvailableDomains());
    const valid = picks.map(s => s.toLowerCase()).filter(s => available.has(s));
    if (valid.length === 0) {
      return sendError(res, 400, ERR.INVALID_INPUT, "No valid domains selected. Available: " + [...available].join(", "));
    }

    // If Life tree already exists, add the selected domains to it
    const existingRootId = await findLifeRoot(userId);
    if (existingRootId) {
      const results = [];
      for (const sel of valid) {
        try {
          const result = await addDomain({ rootId: existingRootId, domain: sel, userId });
          results.push(result);
        } catch (err) {
          results.push({ name: sel, status: "error", error: err.message });
        }
      }
      return sendOk(res, { rootId: existingRootId, type: "added", results });
    }

    const UserModel = (await import("../../seed/models/user.js")).default;
    const user = await UserModel.findById(userId).select("username").lean();

    const result = await scaffold({
      selections: valid,
      singleTree: singleTree !== false, // default to single tree
      userId,
      username: user?.username || "user",
    });

    sendOk(res, result);
  } catch (err) {
    log.error("Life", "Setup error:", err.message);
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

/**
 * GET /life/setup
 * Show available domains and current Life tree status.
 */
router.get("/life/setup", authenticate, async (req, res) => {
  const available = getAvailableDomains();
  const rootId = await findLifeRoot(req.userId);
  sendOk(res, {
    available,
    rootId: rootId || null,
    message: rootId
      ? "Life tree exists. Use 'life add <domain>' to add more."
      : "Usage: life food fitness study",
  });
});

/**
 * GET /life/domains
 * List available domains (installed extensions with scaffold support).
 */
router.get("/life/domains", authenticate, async (req, res) => {
  sendOk(res, { domains: getAvailableDomains() });
});

export default router;
