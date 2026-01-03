import fs from "fs";
import User from "../db/models/user.js";
import { calculateEnergyCost, maybeResetEnergy } from "../core/energy.js";

const MAX_FILE_MB_STANDARD = 1024; // 1 GB

export function energyGuard(action, payloadResolver) {
  return async function (req, res, next) {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const user = await User.findById(req.userId);

      if (!user) {
        if (req.file) {
          await fs.promises.unlink(req.file.path).catch(() => {});
        }
        return res.status(401).json({ message: "User not found" });
      }

      // 🔁 reset if needed
      maybeResetEnergy(user);

      // 🧮 resolve payload
      const payload = payloadResolver ? payloadResolver(req) : null;

      // 🚫 basic plan: no files
      if (
        (action === "note" || action === "rawIdea") &&
        payload?.type === "file" &&
        user.profileType === "basic"
      ) {
        if (req.file) {
          await fs.promises.unlink(req.file.path).catch(() => {});
        }

        return res.status(403).json({
          error: "File uploads are not available on the Basic plan",
        });
      }

      // 🚫 standard: 1GB hard cap
      if (
        payload?.type === "file" &&
        user.profileType === "standard" &&
        payload.sizeMB > MAX_FILE_MB_STANDARD
      ) {
        if (req.file) {
          await fs.promises.unlink(req.file.path).catch(() => {});
        }

        return res.status(413).json({
          error: "File exceeds 1 GB limit for Standard plan",
        });
      }

      // ⚡ cost
      const cost = calculateEnergyCost(action, payload);

      if (user.availableEnergy.amount < cost) {
        if (req.file) {
          await fs.promises.unlink(req.file.path).catch(() => {});
        }

        return res.status(402).json({
          message: "Energy limit reached",
          required: cost,
          remaining: user.availableEnergy.amount,
        });
      }

      // 💸 deduct
      user.availableEnergy.amount -= cost;
      await user.save();

      req.energyUsed = cost;
      next();
    } catch (err) {
      console.error("Energy middleware error:", err);

      if (req.file) {
        await fs.promises.unlink(req.file.path).catch(() => {});
      }

      res.status(500).json({ message: "Energy check failed" });
    }
  };
}
