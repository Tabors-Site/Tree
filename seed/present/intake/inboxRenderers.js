// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Inbox renderer registry. Per seed/SUMMON.md, the inbox panel is a
// dumb renderer. For each pending summon the panel shows, it asks
// "what should this look like?" and renders whatever spec comes back.
// That spec is built server-side here, keyed by the envelope intent,
// and bundled into the my-inbox SEE op's response.
//
// Sovereignty: the receiver's able decides what to do with summons,
// including what UI to show when a human inhabits the receiver. This
// registry is HOW the able's choice reaches the browser. Ables that
// declare receiver entries can opt in by registering a renderer for
// their accepted intent(s); the seed ships renderers for the well-
// known intents it defines (able-request).
//
// Render spec shape (JSON-serializable; no functions on the wire):
//
//   {
//     shape: "action-buttons" | "free-text",
//
//     // Optional body override. When absent, the panel renders the
//     // raw envelope content as a generic block.
//     body: { html?: string, text?: string },
//
//     // For shape="action-buttons":
//     buttons: [
//       {
//         label:    string,
//         kind:     "ok" | "warn" | "neutral",
//         ops?:     [{ target: stance, action: string, args: object }],
//         reply?:   { content: object | string },
//         disabled?: string,   // reason; panel disables and shows tooltip
//       },
//     ],
//
//     // For shape="free-text" (or default fallback):
//     placeholder?: string,
//     allowDismiss?: boolean,
//   }
//
// Panel behavior:
//   - action-buttons: for each button, render. On click, dispatch
//     ops in order (flat.doOp), then send reply summon (flat.client
//     .summon with inReplyTo set). Disabled buttons render greyed
//     with the disabled-reason as tooltip.
//   - free-text (default): text input + reply button + (optional)
//     dismiss button. Reply sends { message: <input> }; dismiss sends
//     { result: "dismissed" }.
//
// Registration:
//   Seed registers via inboxRenderers/index.js, imported as a side
//   effect from services.js. Extensions can register their own via
//   story.registerInboxRenderer (exposed in services).
//
// Failure: a renderer that throws is logged and treated as "no spec"
// (panel falls back to free-text default). Renderers should be
// defensive; the panel always has a usable fallback.

import log from "../../seedStory/log.js";

const RENDERERS = new Map();

/**
 * Register an inbox renderer for an envelope intent.
 *
 * @param {string} intent  kebab-case intent name (matches envelope.intent)
 * @param {(entry, ctx) => Promise<object|null>} fn  renderer
 * @param {object} opts
 * @param {string} [opts.ownerExtension="seed"]  for diagnostics
 */
export function registerInboxRenderer(intent, fn, opts = {}) {
  if (!intent || typeof intent !== "string") {
    throw new Error("registerInboxRenderer requires a non-empty intent string");
  }
  if (typeof fn !== "function") {
    throw new Error(`registerInboxRenderer("${intent}") requires a function`);
  }
  const ownerExtension = opts.ownerExtension || "seed";
  RENDERERS.set(intent, { fn, ownerExtension });
  log.verbose("Inbox", `Registered inbox renderer for intent "${intent}" (${ownerExtension})`);
}

export function unregisterInboxRenderer(intent) {
  return RENDERERS.delete(intent);
}

export function listInboxRenderers() {
  return Array.from(RENDERERS.keys()).sort();
}

/**
 * Build the render spec for an inbox entry. Returns null when no
 * renderer matches the entry's intent (panel falls back to free-text).
 *
 * @param {object} entry  the inbox entry (my-inbox shape)
 * @param {object} ctx    { story, history, identity, viewerBeingId, ... }
 */
export async function buildInboxRenderSpec(entry, ctx) {
  if (!entry || typeof entry !== "object") return null;
  const intent = entry.intent;
  if (!intent || typeof intent !== "string") return null;
  const slot = RENDERERS.get(intent);
  if (!slot) return null;
  try {
    const spec = await slot.fn(entry, ctx);
    return spec || null;
  } catch (err) {
    log.warn("Inbox", `renderer "${intent}" (${slot.ownerExtension}) threw: ${err.message}`);
    return null;
  }
}
