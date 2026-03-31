/**
 * UI Slot Registry
 *
 * Extensions register HTML fragments for named slots during init().
 * Pages resolve slots by name. Whatever's installed appears. Whatever's
 * not installed doesn't. The page never names an extension.
 *
 * Same pattern as hooks, modes, tools. Extensions register. The resolver filters.
 *
 * Spatial scoping: if an extension is blocked at the current node position,
 * its slot fragments don't render. Same resolution as tools and hooks.
 *
 * Usage in extensions:
 *   const treeos = getExtension("treeos-base");
 *   treeos?.exports?.registerSlot("user-profile", "energy", (ctx) => {
 *     return `<div>Energy: ${ctx.energy}</div>`;
 *   });
 *
 * Usage in pages:
 *   const html = resolveSlots("user-profile", { user, nodeId });
 */

import log from "../../seed/log.js";

// slotName -> [{ extName, render, priority }]
const slots = new Map();

/**
 * Register a UI fragment for a named slot.
 *
 * @param {string} slotName - where the fragment appears (e.g. "user-profile", "node-detail", "welcome-stats")
 * @param {string} extName - the extension registering this fragment
 * @param {Function} renderFn - (context) => HTML string. Context is whatever the page passes.
 * @param {object} [opts]
 * @param {number} [opts.priority=50] - lower renders first. Default 50. Core treeos uses 10-30.
 */
export function registerSlot(slotName, extName, renderFn, opts = {}) {
  if (typeof slotName !== "string" || !slotName) {
    log.warn("Slots", `Invalid slot name from ${extName}. Ignored.`);
    return false;
  }
  if (typeof renderFn !== "function") {
    log.warn("Slots", `Slot "${slotName}" from ${extName} has non-function render. Ignored.`);
    return false;
  }

  if (!slots.has(slotName)) slots.set(slotName, []);
  const list = slots.get(slotName);

  // Replace existing from same extension (no duplicates)
  const idx = list.findIndex(s => s.extName === extName);
  if (idx !== -1) list.splice(idx, 1);

  list.push({
    extName,
    render: renderFn,
    priority: opts.priority ?? 50,
  });

  // Sort by priority (lower first)
  list.sort((a, b) => a.priority - b.priority);

  log.verbose("Slots", `Registered "${slotName}" from ${extName} (priority ${opts.priority ?? 50})`);
  return true;
}

/**
 * Remove all slots registered by an extension.
 * Called on extension uninstall.
 */
export function unregisterSlots(extName) {
  for (const [name, list] of slots) {
    const filtered = list.filter(s => s.extName !== extName);
    if (filtered.length === 0) slots.delete(name);
    else slots.set(name, filtered);
  }
}

/**
 * Resolve all fragments for a named slot.
 * Filters by spatial scoping if nodeId is in context.
 * Returns concatenated HTML string.
 *
 * @param {string} slotName
 * @param {object} [context] - passed to each render function. May include { user, node, nodeId, ... }
 * @returns {string} HTML
 */
export function resolveSlots(slotName, context = {}) {
  const registered = slots.get(slotName);
  if (!registered || registered.length === 0) return "";

  const parts = [];
  for (const slot of registered) {
    // Spatial scoping: if the extension is blocked at this position, skip its fragment
    if (context._blockedExtensions && context._blockedExtensions.has(slot.extName)) continue;

    try {
      const html = slot.render(context);
      if (html && typeof html === "string") {
        parts.push(`<div data-slot="${slotName}" data-ext="${slot.extName}">${html}</div>`);
      }
    } catch (err) {
      log.warn("Slots", `Slot "${slotName}" render from ${slot.extName} failed: ${err.message}`);
    }
  }

  return parts.join("\n");
}

/**
 * Emit a slot update over WebSocket.
 * The client-side script replaces the matching data-slot container.
 *
 * @param {object} core - core services bundle (needs core.websocket)
 * @param {string} userId - target user
 * @param {string} slotName - which slot to update
 * @param {string} extName - which extension's fragment to update
 * @param {object} context - passed to the render function
 */
export function emitSlotUpdate(core, userId, slotName, extName, context = {}) {
  const registered = slots.get(slotName);
  if (!registered) return;

  const slot = registered.find(s => s.extName === extName);
  if (!slot) return;

  try {
    const html = slot.render(context);
    if (html && typeof html === "string" && core.websocket?.emitToUser) {
      core.websocket.emitToUser(userId, "slotUpdate", {
        slotName,
        extName,
        html,
      });
    }
  } catch (err) {
    log.debug("Slots", `emitSlotUpdate "${slotName}" from ${extName} failed: ${err.message}`);
  }
}

/**
 * Resolve slots with async render functions.
 * Same as resolveSlots but awaits each render.
 */
export async function resolveSlotsAsync(slotName, context = {}) {
  const registered = slots.get(slotName);
  if (!registered || registered.length === 0) return "";

  const parts = [];
  for (const slot of registered) {
    if (context._blockedExtensions && context._blockedExtensions.has(slot.extName)) continue;

    try {
      const html = await slot.render(context);
      if (html && typeof html === "string") parts.push(html);
    } catch (err) {
      log.debug("Slots", `Async slot "${slotName}" render from ${slot.extName} failed: ${err.message}`);
    }
  }

  return parts.join("\n");
}

/**
 * List all registered slot names (for debugging).
 */
export function listSlots() {
  const result = {};
  for (const [name, list] of slots) {
    result[name] = list.map(s => ({ extName: s.extName, priority: s.priority }));
  }
  return result;
}
