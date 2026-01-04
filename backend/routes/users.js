import express from "express";
import {
  register,
  login,
  logout,
  setHtmlShareToken,
  getHtmlShareToken,
  forgotPassword,
  resetPassword,
  verifyEmail,
} from "../controllers/users.js";
import authenticate from "../middleware/authenticate.js";

const router = express.Router();

router.post("/register", register);

router.post("/login", login);

router.post("/logout", authenticate, logout);

router.post("/setHTMLShareToken", authenticate, setHtmlShareToken);

router.post("/verify-token", authenticate, getHtmlShareToken, (req, res) => {
  res.json({
    userId: req.userId,
    username: req.username,
    HTMLShareToken: req.HTMLShareToken,
  });
});

router.post("/user/forgot-password", forgotPassword);
router.post("/user/reset-password", resetPassword);
router.get("/user/verify/:token", verifyEmail);

export default router;
