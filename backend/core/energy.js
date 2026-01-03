/* ================================
 * CONSTANTS (HALF-COST VERSION)
 * ================================ */

// text
const TEXT_CHARS_PER_ENERGY = 500; // ⬅ doubled = half cost
const TEXT_MIN_COST = 2;

// file energy
const FILE_MIN_COST = 5; // ⬅ was 10

// soft → hard scaling (halved)
const FILE_BASE_RATE = 1.5; // was 3
const FILE_MID_RATE = 3; // was 6

// thresholds
const SOFT_LIMIT_MB = 100;
const HARD_LIMIT_MB = 1024;

// daily limits (unchanged)
const DAILY_LIMITS = {
  basic: 60,
  standard: 50,
  premium: 2000,
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
  // 1 energy
  editStatus: 1,
  editValue: 1,
  editSchedule: 1,
  editGoal: 1,
  editNameNode: 1,
  updateParent: 1,
  updateChildNode: 1,
  branchLifecycle: 1,
  prestige: 1,
  executeScript: 1,
  invite: 1,

  // 2 energy
  create: 2,
  delete: 2,
  transaction: 2,
};

const CONTENT_ACTIONS = new Set(["note", "rawIdea", "editScript"]);

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
  if (CONTENT_ACTIONS.has(action)) {
    let length = 0;

    if (typeof payload === "string") {
      length = payload.length;
    } else if (typeof payload === "number") {
      length = payload;
    } else if (payload?.content) {
      length = payload.content.length;
    }

    return Math.max(TEXT_MIN_COST, Math.ceil(length / TEXT_CHARS_PER_ENERGY));
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
  const lastReset = user.availableEnergy.lastResetAt?.getTime() || 0;
  const DAY_MS = 24 * 60 * 60 * 1000;

  if (now - lastReset < DAY_MS) return false;

  const limit = DAILY_LIMITS[user.profileType] ?? DAILY_LIMITS.basic;

  user.availableEnergy.amount = limit;
  user.availableEnergy.lastResetAt = new Date();

  return true;
}
