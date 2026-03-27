import { Router } from "express";
import { getGovernanceState } from "./core.js";

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

export default router;
