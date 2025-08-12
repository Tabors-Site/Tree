const express = require("express");
const router = express.Router();

const { register, login } = require("../controllers/users");
const authenticate = require("../middleware/authenticate");

router.post("/register", register);
router.post("/login", login);

//check if token is accurate for log in check when entering site
router.post("/verify-token", authenticate, (req, res) => {
  res.json({ userId: req.userId, username: req.username });
});

module.exports = router;
