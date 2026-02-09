// ws/modes/registry.js
// Central mode registry: defines all modes, their tools, and switching logic

import { resolveTools } from "../tools.js";

// ── HOME sub-modes ──────────────────────────────────────────────────────
import homeDefault from "./home/default.js";
import homeRawIdeaPlacement from "./home/raw-idea-placement.js";
import homeReflect from "./home/reflect.js";

// ── TREE sub-modes ──────────────────────────────────────────────────────
import treeStructure from "./tree/structure.js";
import treeEdit from "./tree/edit.js";
import treeBe from "./tree/be.js";
import treeReflect from "./tree/reflect.js";

// ─────────────────────────────────────────────────────────────────────────
// BIG MODES
// ─────────────────────────────────────────────────────────────────────────
export const BIG_MODES = {
  HOME: "home",
  TREE: "tree",
};

// ─────────────────────────────────────────────────────────────────────────
// MODE DEFINITIONS
// Each mode exports: { name, emoji, label, bigMode, toolNames[], buildSystemPrompt(ctx) }
// ─────────────────────────────────────────────────────────────────────────
const ALL_MODES = {
  // HOME
  "home:default": homeDefault,
  "home:raw-idea-placement": homeRawIdeaPlacement,
  "home:reflect": homeReflect,

  // TREE
  "tree:structure": treeStructure,
  "tree:edit": treeEdit,
  "tree:be": treeBe,
  "tree:reflect": treeReflect,
};

// ─────────────────────────────────────────────────────────────────────────
// DEFAULT ENTRY MODES (when entering a big mode)
// ─────────────────────────────────────────────────────────────────────────
const DEFAULT_MODES = {
  [BIG_MODES.HOME]: "home:default",
  [BIG_MODES.TREE]: "tree:structure",
};

// ─────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get a mode definition by full key (e.g. "tree:structure")
 */
export function getMode(modeKey) {
  return ALL_MODES[modeKey] || null;
}

/**
 * List sub-modes for a big mode. Used by the mode bar UI.
 * Returns [{ key, emoji, label }]
 */
export function getSubModes(bigMode) {
  return Object.entries(ALL_MODES)
    .filter(([key]) => key.startsWith(bigMode + ":"))
    .map(([key, mode]) => ({
      key,
      emoji: mode.emoji,
      label: mode.label,
    }));
}

/**
 * Get the default sub-mode key when entering a big mode.
 */
export function getDefaultMode(bigMode) {
  return DEFAULT_MODES[bigMode] || null;
}

/**
 * Resolve the OpenAI-compatible tools array for a mode.
 */
export function getToolsForMode(modeKey) {
  const mode = ALL_MODES[modeKey];
  if (!mode) return [];
  return resolveTools(mode.toolNames);
}

/**
 * Build the system prompt for a mode, given context.
 * ctx = { username, userId, rootId }
 */
export function buildPromptForMode(modeKey, ctx) {
  const mode = ALL_MODES[modeKey];
  if (!mode) throw new Error(`Unknown mode: ${modeKey}`);
  return mode.buildSystemPrompt(ctx);
}

/**
 * Determine big mode from a URL path.
 *   /user/:userId  → HOME
 *   /:nodeId       → TREE
 *   /root/:nodeId  → TREE
 */

const NODE_ID_PATTERN =
  "(?:[a-f0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})";
// Matches both MongoDB ObjectIds (24 hex) and UUIDs (8-4-4-4-12 hex with dashes)
const NODE_PREFIX_PATTERN = new RegExp(
  `^(/api)?/(${NODE_ID_PATTERN})(/|$)`,
  "i",
);

export function bigModeFromUrl(urlPath) {
  if (!urlPath) return BIG_MODES.HOME;
  const clean = urlPath.split("?")[0]; // strip query
  // Match with or without /api prefix
  if (NODE_PREFIX_PATTERN.test(clean)) {
    return BIG_MODES.TREE;
  }
  if (clean.match(/^(\/api)?\/user\//)) return BIG_MODES.HOME;
  if (clean.match(/^(\/api)?\/root\//)) return BIG_MODES.TREE;
  // bare /:nodeId or /api/:nodeId

  return BIG_MODES.HOME;
}

/**
 * Number of recent messages to carry across a mode switch.
 */
export const CARRY_MESSAGES = 4;
