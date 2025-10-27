import express from "express";
import { register, login } from "../controllers/users.js";
import authenticate from "../middleware/authenticate.js";

const router = express.Router();

router.post("/register", register);

router.post("/login", login);

//check if token is accurate for log in check when entering site
router.post("/verify-token", authenticate, (req, res) => {
  res.json({ userId: req.userId, username: req.username, bob: "hi" });
});

export default router;
