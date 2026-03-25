import log from "../../seed/log.js";
import fs from "fs";
import User from "../../seed/models/user.js";
import { assignConnection } from "../../seed/llm/connections.js";
import Node from "../../seed/models/node.js";
import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";

const TEXT_NOTE_CHARS_PER_ENERGY = 1000;
const TEXT_NOTE_MIN = 1;
const TEXT_NOTE_MAX = 5;

const FILE_MIN_COST = 5;
const FILE_BASE_RATE = 1.5;
const FILE_MID_RATE = 3;

const SOFT_LIMIT_MB = 100;
const HARD_LIMIT_MB = 1024;

export const DAILY_LIMITS = {
  basic: 350,
  standard: 1500,
  premium: 8000,
  god: 10_000_000_000,
};

export function calculateFileEnergy(sizeMB) {
  if (sizeMB <= SOFT_LIMIT_MB) {
    return Math.max(FILE_MIN_COST, Math.ceil(sizeMB * FILE_BASE_RATE));
  }

  if (sizeMB <= HARD_LIMIT_MB) {
    const base = SOFT_LIMIT_MB * FILE_BASE_RATE;
    const extra = (sizeMB - SOFT_LIMIT_MB) * FILE_MID_RATE;
    return Math.ceil(base + extra);
  }

  const base =
    SOFT_LIMIT_MB * FILE_BASE_RATE +
    (HARD_LIMIT_MB - SOFT_LIMIT_MB) * FILE_MID_RATE;

  const overGB = sizeMB - HARD_LIMIT_MB;

  return Math.ceil(base + Math.pow(overGB / 50, 2) * 50);
}

const BASE_ACTION_COSTS = {
  editStatus: 1,
  editValue: 1,
  removeNote: 1,
  editSchedule: 1,
  editGoal: 1,
  editName: 1,
  editType: 1,
  updateParent: 1,
  updateChild: 1,
  branchLifecycle: 1,
  invite: 1,
  delete: 1,

  prestige: 2,
  executeScript: 2,
  transaction: 2,

  chatError: 2,
  proxyLlm: 2,

  create: 3,
};

const CONTENT_ACTIONS = new Set(["note", "rawIdea", "editScript"]);

const VARIABLE_ACTIONS = new Set(["understanding"]);

const customActions = new Map();

export function registerAction(action, costFn) {
  if (typeof costFn !== "function") {
    throw new Error(`registerAction: costFn must be a function for "${action}"`);
  }
  customActions.set(action, costFn);
}

export function calculateEnergyCost(action, payload) {
  if (payload?.type === "file") {
    const sizeMB = payload.sizeMB;

    if (typeof sizeMB !== "number" || isNaN(sizeMB) || sizeMB < 0) {
      throw new Error("Invalid file size");
    }

    return calculateFileEnergy(sizeMB);
  }

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

  if (VARIABLE_ACTIONS.has(action)) {
    const amount = typeof payload === "number" ? payload : 1;
    return Math.max(2, amount * 2);
  }

  if (customActions.has(action)) {
    return customActions.get(action)(payload);
  }

  const cost = BASE_ACTION_COSTS[action];
  if (!cost) {
    throw new Error(`Unknown energy action: ${action}`);
  }

  return cost;
}

export function maybeResetEnergy(user) {
  const energy = getUserMeta(user, "energy");
  if (!energy.available) return false;

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const billing = getUserMeta(user, "billing");
  const expiresAt = billing.planExpiresAt?.getTime?.() || (typeof billing.planExpiresAt === "number" ? billing.planExpiresAt : 0);

  const currentPlan = getUserMeta(user, "tiers").plan || "basic";
  if (
    currentPlan !== "basic" &&
    !user.isAdmin &&
    expiresAt > 0 &&
    now > expiresAt
  ) {
    setUserMeta(user, "tiers", { plan: "basic" });
    setUserMeta(user, "billing", { ...billing, planExpiresAt: null });

    energy.available.amount = DAILY_LIMITS.basic ?? DAILY_LIMITS["basic"];
    energy.available.lastResetAt = new Date();
    setUserMeta(user, "energy", energy);
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
 log.error("Energy", "Failed to clear root LLM on downgrade:", e.message);
    });
  }

  const lastReset = energy.available.lastResetAt?.getTime?.() || 0;

  if (now - lastReset < DAY_MS) return false;

  const resetPlan = getUserMeta(user, "tiers").plan || "basic";
  const limit = DAILY_LIMITS[resetPlan] ?? DAILY_LIMITS.basic;

  energy.available.amount = limit;
  energy.available.lastResetAt = new Date();
  setUserMeta(user, "energy", energy);

  return true;
}

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
    (getUserMeta(user, "tiers").plan || "basic") === "basic"
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
    (getUserMeta(user, "tiers").plan || "basic") === "standard" &&
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

  const energy = getUserMeta(user, "energy");
  const baseEnergy = energy.available.amount || 0;
  const extraEnergy = energy.additional?.amount || 0;
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

  if (energy.available.amount >= remainingCost) {
    energy.available.amount -= remainingCost;
    remainingCost = 0;
  } else {
    remainingCost -= energy.available.amount;
    energy.available.amount = 0;
  }

  if (remainingCost > 0) {
    energy.additional.amount -= remainingCost;
    remainingCost = 0;
  }

  setUserMeta(user, "energy", energy);
  await user.save();

  return {
    energyUsed: cost,
    remainingEnergy: energy.available.amount + energy.additional.amount,
    remainingBaseEnergy: energy.available.amount,
    remainingAdditionalEnergy: energy.additional.amount,
  };
}
