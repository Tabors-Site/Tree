import express from "express";
import authenticate from "../middleware/authenticate.js";

const router = express.Router();

router.get("/me", authenticate, async (req, res) => {
  res.json({
    success: true,
    userId: req.userId,
    username: req.username,
  });
});

export default router;
