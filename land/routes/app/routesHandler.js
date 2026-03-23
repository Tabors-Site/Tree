import { authPageRouter } from "../auth.js";
import { getExtension } from "../../extensions/loader.js";

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

export default async function registerRoutes(app) {
  app.use(limiter);

  app.use("/", authPageRouter);

  // Page routes from html-rendering extension (only if installed)
  const htmlExt = getExtension("html-rendering");
  if (htmlExt?.pageRouter) {
    app.use("/", htmlExt.pageRouter);
  }

  // App routes (chat, setup, etc.) are dynamic so they don't crash if html-rendering is missing
  try {
    const appe = (await import("./app.js")).default;
    const chat = (await import("./chat.js")).default;
    const setup = (await import("./setup.js")).default;
    app.use("/", appe);
    app.use("/", chat);
    app.use("/", setup);
  } catch {
    // html-rendering not installed, skip page routes
  }
}
