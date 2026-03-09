import note from "./notes.js";
import node from "./node.js";
import root from "./root.js";
import user from "./user.js";
import contributions from "./contributions.js";
import transactions from "./transactions.js";
import values from "./values.js";
import appe from "./app.js";
import chat from "./chat.js";
import understanding from "./understanding.js";
import tree from "./tree.js";

import rateLimit from "express-rate-limit";

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1800,               // same rate as 60 / 30s
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      error: "Too many requests",
      message: "You are sending requests too fast. Try again in 15 minutes.",
      retryAfterMinutes: 15,
    });
  },
});


export default function registerURLRoutes(app) {

  app.use(apiLimiter);
  app.use("/", user);
  app.use("/", root);
  app.use("/", appe);
  app.use("/", chat);
  app.use("/", understanding);

  app.use("/", note);
  app.use("/", contributions);
  app.use("/", transactions);
  app.use("/", values);
  app.use("/", node);
  app.use("/", tree);
}
