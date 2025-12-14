import express from "express";
import {
  register,
  login,
  setHtmlShareToken,
  getHtmlShareToken,
} from "../controllers/users.js";
import authenticate from "../middleware/authenticate.js";

const router = express.Router();

router.post("/register", register);

router.post("/login", login);

router.post("/login", login);

router.post("/setHTMLShareToken", authenticate, setHtmlShareToken);

router.post("/verify-token", authenticate, getHtmlShareToken, (req, res) => {
  res.json({
    userId: req.userId,
    username: req.username,
    HTMLShareToken: req.HTMLShareToken,
  });
});

export default router;
