import treeDataFetchingRoutes from "../routes/treeDataFetching.js";
import usersRoutes from "../routes/users.js";

import appe from "./app.js";
import chat from "./chat.js";
import setup from "./setup.js";

import rateLimit from "express-rate-limit";

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1800, // same rate as 60 / 30s
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

export default function registerRoutes(app) {
  app.use(limiter);

  app.use("/", treeDataFetchingRoutes);
  app.use("/", usersRoutes);
  app.use("/", appe);
  app.use("/", chat);
  app.use("/", setup);
}
