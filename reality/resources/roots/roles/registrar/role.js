// roots:registrar. The catalog's writer.
//
// Scripted cognition, same shape as the federation-manager: classify
// the incoming SUMMON by intent, run the handler, return the response.
// Publishers (peer realities or this one) reach me through SUMMONs;
// browsing the catalog is plain SEE on the spaces and matter I keep,
// no intent needed.
//
// TWO INTENTS (the wire shape):
//
//   publish-listing    publisher -> roots
//     "List this. Here is the manifest."
//     payload: { listingType: "extension"|"seed",
//                manifest: { name, version, builtFor?, assets?, requires? } }
//     response: { kind: "published", listingHash, claimHash, seq }
//     Versions are immutable: same (name, version) with a different
//     hash refuses; identical re-publish is idempotent.
//
//   retire-listing     publisher -> roots
//     "Sunset this name (optionally: its successor is X)."
//     payload: { name, successor? }
//     response: { kind: "retired", claimHash, seq }
//
// Both write the catalog into the registrar's OWN qualities (one
// self-authorized set-being per publish), so the catalog's whole history
// is the registrar's reel and no grant or ownership is needed. The
// roots operator's editorial lever is the separate roots:delist DO
// op, not an intent: delisting is the operator's act, not the publisher's.

import log from "../../../../seed/seedReality/log.js";

export const registrarRole = Object.freeze({
  name: "roots:registrar",
  description:
    "The roots catalog's writer. Handles publish-listing and retire-listing SUMMONs from publisher realities; keeps the catalog in its own qualities as immutable versions under chained name pointers.",
  requiredCognition: "scripted",
  permissions: ["see", "do"],
  respondMode: "async",
  triggerOn: ["message"],

  canSee: ["identity"],

  // No canDo entries: the registrar writes only its OWN qualities. That
  // set-being resolves auth to the registrar's home space, which the
  // registrar OWNS (the seed sets the catalog space's owner), so the
  // write authorizes through ownership. No foreign target to gate.
  canDo: [],

  canSummon: [
    { stance: "(asker)", description: "Reply to whoever woke this moment." },
  ],

  canBe: [],

  label: "Roots Registrar",

  async summon(message, ctx) {
    // Cross-reality SUMMONs still ride the payload inside content
    // (same canopy serializer gap the federation-manager documents).
    const fedMessage = (typeof message?.content === "object" && message.content !== null
                       && (message.content.kind === "roots" || message.content.intent))
      ? message.content
      : message;

    const intent = message?.intent
      || ((typeof fedMessage === "object" && fedMessage !== null)
            ? (fedMessage.intent || null)
            : null);

    if (!intent) {
      log.warn("Roots", "SUMMON arrived with no intent; ignoring");
      return null;
    }

    log.info("Roots",
      `registrar routing intent="${intent}" askerReality=${ctx?.askerReality || "(local)"}`);
    try {
      const handlers = await import("../../code/handlers.js");
      if (intent === "publish-listing") return await handlers.publishListing(fedMessage, ctx);
      if (intent === "retire-listing")  return await handlers.retireListing(fedMessage, ctx);
      log.warn("Roots", `unknown intent "${intent}"`);
      return { kind: "failure", ok: false, shape: "unknown-intent", reason: `unknown intent "${intent}"` };
    } catch (err) {
      log.warn("Roots", `intent "${intent}" handler threw: ${err.message}`);
      return { kind: "failure", ok: false, shape: "internal", reason: err.message };
    }
  },
});
