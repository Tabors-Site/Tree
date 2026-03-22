// core/energy/useEnergy.js
import fs from "fs";
import User from "../../db/models/user.js";
import { assignConnection } from "../llms/customLLM.js";
import Node from "../../db/models/node.js";

/* ================================
 * CONSTANTS (HALF-COST VERSION)
 * ================================ */

// text
const TEXT_NOTE_CHARS_PER_ENERGY = 1000;
const TEXT_NOTE_MIN = 1;
const TEXT_NOTE_MAX = 5;

// file energy
const FILE_MIN_COST = 5; // ⬅ was 10

// soft → hard scaling (halved)
const FILE_BASE_RATE = 1.5; // was 3
const FILE_MID_RATE = 3; // was 6

// thresholds
const SOFT_LIMIT_MB = 100;
const HARD_LIMIT_MB = 1024;

// daily limits (unchanged)
export const DAILY_LIMITS = {
  basic: 350,
  standard: 1500,
  premium: 8000,
  god: 10_000_000_000,
};

/* ================================
 * FILE ENERGY (progressive)
 * ================================ */
export function calculateFileEnergy(sizeMB) {
  if (sizeMB <= SOFT_LIMIT_MB) {
    return Math.max(FILE_MIN_COST, Math.ceil(sizeMB * FILE_BASE_RATE));
  }

  if (sizeMB <= HARD_LIMIT_MB) {
    const base = SOFT_LIMIT_MB * FILE_BASE_RATE;
    const extra = (sizeMB - SOFT_LIMIT_MB) * FILE_MID_RATE;
    return Math.ceil(base + extra);
  }

  // 💀 over 1 GB → still brutal, but halved
  const base =
    SOFT_LIMIT_MB * FILE_BASE_RATE +
    (HARD_LIMIT_MB - SOFT_LIMIT_MB) * FILE_MID_RATE;

  const overGB = sizeMB - HARD_LIMIT_MB;

  return Math.ceil(base + Math.pow(overGB / 50, 2) * 50); // was *100
}

/* ================================
 * MAIN ENERGY COST DISPATCHER
 * ================================ */

const BASE_ACTION_COSTS = {
  // 1 energy — small edits (~1 KB contribution record each)
  editStatus: 1,
  editValue: 1,
  removeNote: 1,
  editSchedule: 1,
  editGoal: 1,
  editNameNode: 1,
  editType: 1,
  updateParent: 1,
  updateChildNode: 1,
  branchLifecycle: 1,
  invite: 1,
  delete: 1,

  // 2 energy — heavier operations
  prestige: 2,
  executeScript: 2,
  transaction: 2,

  // 2 energy — failed/missing LLM penalty
  chatError: 2,
  proxyLlm: 2,

  // 3 energy — node creation (3-5 KB stored)
  create: 3,
};

const CONTENT_ACTIONS = new Set(["note", "rawIdea", "editScript"]);

/* 🔥 NEW — actions that scale with payload count */
const VARIABLE_ACTIONS = new Set(["understanding"]);

export function calculateEnergyCost(action, payload) {
  /* ---------- FILES ---------- */
  if (payload?.type === "file") {
    const sizeMB = payload.sizeMB;

    if (typeof sizeMB !== "number" || isNaN(sizeMB) || sizeMB < 0) {
      throw new Error("Invalid file size");
    }

    return calculateFileEnergy(sizeMB);
  }

  /* ---------- TEXT ---------- */
  /* ---------- TEXT (notes, rawIdea, editScript) ---------- */
  if (CONTENT_ACTIONS.has(action)) {
    let length = 0;

    if (typeof payload === "string") {
      length = payload.length;
    } else if (typeof payload === "number") {
      length = payload;
    } else if (payload?.content) {
      length = payload.content.length;
    } else if (payload?.type === "text") {
      length = (payload.content || "").length;
    }

    return Math.min(
      TEXT_NOTE_MAX,
      Math.max(
        TEXT_NOTE_MIN,
        1 + Math.floor(length / TEXT_NOTE_CHARS_PER_ENERGY),
      ),
    );
  }

  /* ---------- VARIABLE COUNT (understanding: 2 per node) ---------- */
  if (VARIABLE_ACTIONS.has(action)) {
    const amount = typeof payload === "number" ? payload : 1;
    return Math.max(2, amount * 2);
  }

  /* ---------- FIXED ---------- */
  const cost = BASE_ACTION_COSTS[action];
  if (!cost) {
    throw new Error(`Unknown energy action: ${action}`);
  }

  return cost;
}

/* ================================
 * DAILY RESET
 * ================================ */
export function maybeResetEnergy(user) {
  if (!user.availableEnergy) return false;

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const expiresAt = user.planExpiresAt?.getTime() || 0;

  if (
    user.profileType !== "basic" &&
    user.profileType !== "god" &&
    expiresAt > 0 &&
    now > expiresAt
  ) {
    user.profileType = "basic";
    user.planExpiresAt = null;

    user.availableEnergy.amount = DAILY_LIMITS.basic ?? DAILY_LIMITS["basic"];

    user.availableEnergy.lastResetAt = new Date();
    // Clear all LLM assignments on downgrade (user slots + root nodes)
    assignConnection(user._id, "main", null);
    assignConnection(user._id, "rawIdea", null);
    Node.updateMany(
      { rootOwner: user._id },
      { $set: {
        "llmAssignments.default": null,
        "llmAssignments.placement": null,
        "llmAssignments.understanding": null,
        "llmAssignments.respond": null,
        "llmAssignments.notes": null,
        "llmAssignments.cleanup": null,
        "llmAssignments.drain": null,
        "llmAssignments.notification": null,
      } },
    ).catch(function (e) {
      console.error("Failed to clear root LLM on downgrade:", e.message);
    });
  }

  const lastReset = user.availableEnergy.lastResetAt?.getTime() || 0;

  if (now - lastReset < DAY_MS) return false;

  const limit = DAILY_LIMITS[user.profileType] ?? DAILY_LIMITS.basic;

  user.availableEnergy.amount = limit;
  user.availableEnergy.lastResetAt = new Date();

  return true;
}

// core/errors/EnergyError.js
export class EnergyError extends Error {
  constructor(message, meta = {}) {
    super(message);
    this.name = "EnergyError";
    Object.assign(this, meta);
  }
}

const MAX_FILE_MB_STANDARD = 1024; // 1 GB

export async function useEnergy({
  userId,
  action,
  payload = null,
  file = null,
}) {
  if (!userId) {
    throw new EnergyError("Not authenticated");
  }

  const user = await User.findById(userId);
  if (!user) {
    if (file?.path) {
      await fs.promises.unlink(file.path).catch(() => {});
    }
    throw new EnergyError("User not found");
  }

  maybeResetEnergy(user);

  if (
    (action === "note" || action === "rawIdea") &&
    payload?.type === "file" &&
    user.profileType === "basic"
  ) {
    if (file?.path) {
      await fs.promises.unlink(file.path).catch(() => {});
    }

    throw new EnergyError("File uploads are not available on the Basic plan", {
      code: "PLAN_RESTRICTION",
    });
  }

  if (
    payload?.type === "file" &&
    user.profileType === "standard" &&
    payload.sizeMB > MAX_FILE_MB_STANDARD
  ) {
    if (file?.path) {
      await fs.promises.unlink(file.path).catch(() => {});
    }

    throw new EnergyError("File exceeds 1 GB limit for Standard plan", {
      code: "FILE_TOO_LARGE",
      limitMB: MAX_FILE_MB_STANDARD,
    });
  }

  const cost = calculateEnergyCost(action, payload);

  const baseEnergy = user.availableEnergy.amount || 0;
  const extraEnergy = user.additionalEnergy?.amount || 0;
  const totalEnergy = baseEnergy + extraEnergy;

  if (totalEnergy < cost) {
    if (file?.path) {
      await fs.promises.unlink(file.path).catch(() => {});
    }

    throw new EnergyError("Energy limit reached", {
      code: "INSUFFICIENT_ENERGY",
      required: cost,
      remaining: totalEnergy,
    });
  }

  let remainingCost = cost;

  if (user.availableEnergy.amount >= remainingCost) {
    user.availableEnergy.amount -= remainingCost;
    remainingCost = 0;
  } else {
    remainingCost -= user.availableEnergy.amount;
    user.availableEnergy.amount = 0;
  }

  if (remainingCost > 0) {
    user.additionalEnergy.amount -= remainingCost;
    remainingCost = 0;
  }

  await user.save();

  return {
    energyUsed: cost,
    remainingEnergy: user.availableEnergy.amount + user.additionalEnergy.amount,
    remainingBaseEnergy: user.availableEnergy.amount,
    remainingAdditionalEnergy: user.additionalEnergy.amount,
  };
}
