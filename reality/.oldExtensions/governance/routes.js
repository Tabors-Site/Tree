import { Router } from "express";
import { getGovernanceState, refreshGovernance } from "./core.js";

const router = Router();

/**
 * GET /api/v1/land/governance
 * Returns the cached governance state. Used by CLI.
 */
router.get("/land/governance", (req, res) => {
  const state = getGovernanceState();
  if (!state) {
    return res.json({ status: "ok", data: { message: "Governance data not yet fetched" } });
  }
  return res.json({ status: "ok", data: state });
});

/**
 * POST /api/v1/land/governance/check
 * Live check against directory policies (bypasses cache).
 */
router.post("/land/governance/check", async (req, res) => {
  try {
    const state = await refreshGovernance();
    return res.json({ status: "ok", data: state });
  } catch (err) {
    return res.status(500).json({ status: "error", error: { code: "INTERNAL", message: err.message } });
  }
});

export default router;
