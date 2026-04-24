import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import {
  getPatterns, getProposals, dismissPattern, approveProposal,
  detectAndStorePatterns, generateProposals,
} from "./core.js";

const router = express.Router();

// GET /land/evolve - patterns and proposals summary
router.get("/land/evolve", authenticate, async (req, res) => {
  try {
    const patterns = await getPatterns();
    const proposals = await getProposals();
    sendOk(res, { patterns, proposals });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// GET /land/evolve/proposals - just proposals
router.get("/land/evolve/proposals", authenticate, async (req, res) => {
  try {
    const proposals = await getProposals();
    sendOk(res, { proposals });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /land/evolve/dismiss - dismiss a pattern
router.post("/land/evolve/dismiss", authenticate, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return sendError(res, 400, ERR.INVALID_INPUT, "id is required");
    const result = await dismissPattern(id);
    if (!result) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Pattern not found");
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /land/evolve/approve - approve a proposal
router.post("/land/evolve/approve", authenticate, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return sendError(res, 400, ERR.INVALID_INPUT, "id is required");
    const result = await approveProposal(id);
    if (!result) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Proposal not found");
    sendOk(res, result);
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// POST /land/evolve/run - kick a full detection + proposal cycle on demand.
// Normally runs every 6h via the evolve-cycle job; this lets an operator
// trigger it immediately for testing or after a burst of activity without
// waiting for the next scheduled tick. Returns the detected patterns and
// generated proposals so the caller can see what was written.
router.post("/land/evolve/run", authenticate, async (req, res) => {
  try {
    const patterns = await detectAndStorePatterns();
    const proposals = await generateProposals();
    sendOk(res, {
      patterns,
      proposals,
      message: `Detected ${patterns.length} pattern(s), generated ${proposals.length} proposal(s).`,
    });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

export default router;
