// ws/modes/registry.js
// Central mode registry: defines all modes, their tools, and switching logic

import log from "../../core/log.js";
import { resolveTools } from "../tools.js";

// ── HOME sub-modes ──────────────────────────────────────────────────────
import homeDefault from "./home/default.js";
import homeReflect from "./home/reflect.js";

// ── TREE sub-modes (core only, extension modes registered via init()) ───
import treeStructure from "./tree/structure.js";
import treeEdit from "./tree/edit.js";
import treeBe from "./tree/be.js";
import treeNavigate from "./tree/navigate.js";
import treeGetContext from "./tree/getContext.js";
import treeEditNotes from "./tree/notes.js";
import treeRespond from "./tree/respond.js";
import treeLibrarian from "./tree/librarian.js";


// ─────────────────────────────────────────────────────────────────────────
// BIG MODES
// ─────────────────────────────────────────────────────────────────────────
// Core bigModes (always available)
export const BIG_MODES = {
  LAND: "land",
  HOME: "home",
  TREE: "tree",
};

/**
 * Register a custom bigMode from an extension.
 * e.g. raw-ideas extension registers RAW_IDEA.
 */
export function registerBigMode(key, value) {
  BIG_MODES[key] = value;
}

// ─────────────────────────────────────────────────────────────────────────
// MODE DEFINITIONS
// Each mode exports: { name, emoji, label, bigMode, toolNames[], buildSystemPrompt(ctx) }
// ─────────────────────────────────────────────────────────────────────────
const ALL_MODES = {
  // HOME (core)
  "home:default": homeDefault,
  "home:reflect": homeReflect,

  // TREE (core)
  "tree:navigate": treeNavigate,
  "tree:structure": treeStructure,
  "tree:edit": treeEdit,
  "tree:be": treeBe,
  "tree:getContext": treeGetContext,
  "tree:notes": treeEditNotes,
  "tree:respond": treeRespond,
  "tree:librarian": treeLibrarian,

  // Extension modes registered dynamically via registerMode()
};

// ─────────────────────────────────────────────────────────────────────────
// DEFAULT ENTRY MODES (when entering a big mode)
// ─────────────────────────────────────────────────────────────────────────
const DEFAULT_MODES = {
  [BIG_MODES.HOME]: "home:default",
  [BIG_MODES.TREE]: "tree:navigate",
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
 * Merges three layers:
 *   1. Mode's base toolNames[]
 *   2. Extension-injected tools (via loader)
 *   3. Tree-specific tools (from root node metadata.tools.allowed[])
 */
export function getToolsForMode(modeKey, treeToolConfig = null) {
  const mode = ALL_MODES[modeKey];
  if (!mode) return [];

  // Layer 1: mode base tools
  let toolNames = [...mode.toolNames];

  // Layer 2: extension-injected tools
  const extTools = _getExtToolsFn(modeKey);
  if (extTools.length > 0) {
    toolNames = [...new Set([...toolNames, ...extTools])];
  }

  // Layer 3: tree-specific tools from root node metadata
  // treeToolConfig = { allowed: ["execute-shell", "my-tool"], blocked: ["delete-node-branch"] }
  if (treeToolConfig) {
    if (Array.isArray(treeToolConfig.allowed)) {
      toolNames = [...new Set([...toolNames, ...treeToolConfig.allowed])];
    }
    if (Array.isArray(treeToolConfig.blocked)) {
      toolNames = toolNames.filter(t => !treeToolConfig.blocked.includes(t));
    }
  }

  return resolveTools(toolNames);
}

// Extension tool injection hook. Set by the loader after initialization.
let _getExtToolsFn = () => [];

/**
 * Called by extension loader to register the tool injection function.
 * This avoids circular imports between registry and loader.
 */
export function setExtensionToolResolver(fn) {
  _getExtToolsFn = fn;
}

/**
 * Register a custom mode from an extension.
 * The mode object must have: name, bigMode, toolNames[], buildSystemPrompt(ctx)
 * Optional: emoji, label, hidden, maxMessagesBeforeLoop, preserveContextOnLoop
 */
export function registerMode(modeKey, modeConfig, extName = "unknown") {
  if (!modeKey || !modeConfig) {
    log.warn("Modes", `Invalid mode registration from ${extName}`);
    return false;
  }
  if (!modeConfig.buildSystemPrompt || typeof modeConfig.buildSystemPrompt !== "function") {
    log.warn("Modes", `Mode "${modeKey}" from ${extName} missing buildSystemPrompt(). Skipped.`);
    return false;
  }
  if (!Array.isArray(modeConfig.toolNames)) {
    log.warn("Modes", `Mode "${modeKey}" from ${extName} missing toolNames[]. Skipped.`);
    return false;
  }
  if (ALL_MODES[modeKey]) {
    log.warn("Modes", `Mode "${modeKey}" already registered. ${extName} cannot override.`);
    return false;
  }

  // Fill in defaults
  const mode = {
    name: modeKey,
    emoji: modeConfig.emoji || "🧩",
    label: modeConfig.label || modeKey.split(":")[1] || modeKey,
    bigMode: modeConfig.bigMode || modeKey.split(":")[0] || "tree",
    hidden: modeConfig.hidden ?? false,
    toolNames: modeConfig.toolNames,
    buildSystemPrompt: modeConfig.buildSystemPrompt,
    maxMessagesBeforeLoop: modeConfig.maxMessagesBeforeLoop,
    preserveContextOnLoop: modeConfig.preserveContextOnLoop,
  };

  ALL_MODES[modeKey] = mode;
  log.verbose("Modes", `Registered: ${modeKey} (${extName})`);
  return true;
}

/**
 * Unregister all modes from an extension.
 */
export function unregisterModes(extName) {
  for (const [key, mode] of Object.entries(ALL_MODES)) {
    if (mode._extName === extName) {
      delete ALL_MODES[key];
    }
  }
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
 *   /node/:nodeId       → TREE
 *   /root/:nodeId  → TREE
 */

const NODE_ID_PATTERN =
  "(?:[a-f0-9]{24}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})";
// Matches both MongoDB ObjectIds (24 hex) and UUIDs (8-4-4-4-12 hex with dashes)
const NODE_PREFIX_PATTERN = new RegExp(
  `^(/api/v1)?/node/(${NODE_ID_PATTERN})(/|$)`,
  "i",
);

export function bigModeFromUrl(urlPath) {
  if (!urlPath) return BIG_MODES.HOME;
  const clean = urlPath.split("?")[0]; // strip query
  // Match with or without /api/v1 prefix
  if (NODE_PREFIX_PATTERN.test(clean)) {
    return BIG_MODES.TREE;
  }
if (clean.match(/^(\/api\/v1)?\/user\//)) return BIG_MODES.HOME;
  if (clean.match(/^(\/api\/v1)?\/root\//)) return BIG_MODES.TREE;
  // bare /:nodeId or /api/v1/:nodeId

  return BIG_MODES.HOME;
}

/**
 * Number of recent messages to carry across a mode switch.
 */
export const CARRY_MESSAGES = 4;
