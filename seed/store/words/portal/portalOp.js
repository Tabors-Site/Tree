// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// `do form-portal` — create a portal Matter in the actor's current
// space, pointing at a foreign IBPA address.
//
// A portal is matter of type "ibpa" (materials/matter/types.js) —
// named for its reference kind, exactly like web matter is named for
// the WWW. The two are COMPLETELY different reference worlds: web's
// `{ url }` is an HTTP link (render only — iframes); ibpa's
// `{ target }` is an IBP address BETWEEN worlds (four verbs — never
// an iframe):
//
//   content = { target: "<story>#<branch>/<position>" }
//
// What each VIEWER experiences through the portal is emergent from
// the foreign story's stance auth for THEIR identity (per
// CROSS-WORLD.md and the "portal == window == full" doctrine):
//
//   - foreign side grants SEE      → renders camera-through ("window")
//   - foreign side grants SEE+DO   → can reach in and act ("portal")
//   - foreign side grants SEE+DO+BE → can walk through (do:move with
//                                     position = portal target)
//   - foreign side grants nothing  → black window (matter visible
//                                     locally, contents not)
//
// Portals are NOT 3D furniture. The 3D portal renders the doorway
// with a live SEE painted on the opening, but a headless being uses
// the same matter the same way: read `external.target` off the
// descriptor entry, then issue SEE/DO/SUMMON/BE at that address —
// the normal canopy cross-world dispatch does the rest. The portal
// matter is how beings move between realities, or act on one story
// from inside another, regardless of renderer.
//
// `qualities.portal` carries provenance (createdBy) and mirrors the
// target for renderer back-compat. No expiry: wall-clock TTLs are
// human time, which doesn't exist inside the story — a portal ends
// by `end-matter`, or by a future story-time (moments) mechanism.

import { registerOperation } from "../../../ibp/operations.js";
import { registerAbleWord } from "../../../present/word/ableWordRegistry.js";
import { portalHostEnv } from "./portalHost.js";

// Self-register this module's co-located `.word` slice (CONVERTING.md): importing
// portalOp.js (at seed boot, or in a DRY harness) registers it so
// resolveAbleWord("portal", "form-portal") finds the world strand. do.js's runOpWord
// resolves and runs portal.word in the OP's ONE moment with portalHostEnv() wired.
registerAbleWord("portal", "form-portal", new URL("./portal.word", import.meta.url));

// Matches the IBPA shapes a portal can point at. A portal opens onto
// a different WORLD (different story OR different branch); same
// story+branch isn't a portal, it's just a reference. Accepted:
//
//   <story>#<branch>/<position>   foreign story + foreign branch
//   <story>/<position>            foreign story (implicit branch)
//   #<branch>/<position>            same story, foreign branch
//
// "Story" can be either a TLD-style domain (bing.com, tabors.site)
// or a single-word host (localhost, etc.) — both are legitimate
// substrate identities. Branch path follows the alternating-segment
// grammar (BRANCH_RE in address.js).
// Accept the trailing-slash form `<story>#<branch>/` as "the root
// of that world" — same convention the resolver uses for bare-story
// addresses. `.*` after the slash allows either a named path or an
// empty path (root). classify.js floor-matches the same shape (kept
// in sync) so pasting an IBPA into the place composer previews
// "will become: portal".
export const IBPA_RE =
  /^(?:[a-zA-Z0-9.\-_]+(?:#[^/]+)?|#[^/]+)\/.*$/;

// WORD-SOURCED registration — NO handler (Tabor's no-mirror law: an op is its `.word`
// OR pure-JS, never both; WORD-SOLE = no handler). do.js's runOpWord resolves
// portal.word and runs it via runAbleWord in the OP's ONE moment, so the nested
// `do create-matter` deed pools INTO that moment — laid atomically with the caller.
//
// form-portal is a PURE-COMPOSITION: its whole effect is one entailed event ("a portal
// IS a matter" → one do:create-matter fact). `ranAsMoments: true` tells the dispatcher
// this op stamps NONE of its own — there is no own do:form-portal audit; the
// create-matter deed IS the fact. (NOT skipAudit; a one-moment composite.)
//
// `able:"portal"` is the ableword resolution key (registerAbleWord namespace);
// `noun:"matter"` is the entailed deed's target kind. `idFrom` is omitted — form-portal
// lays no own fact, so there is no own target to mint. hostEnv wires the see-op floor
// reads (has-address / valid-address / resolve-containing-space) portal.word reaches.
registerOperation("form-portal", {
  targets: ["space", "matter"],
  ownerExtension: "seed",
  args: {
    target: {
      type: "text",
      label: "Foreign IBPA (e.g. \"bing.com#0/library\" or \"#1a/<spaceId>\")",
      required: true,
    },
    name: {
      type: "text",
      label: "Portal name (optional)",
      required: false,
    },
  },
  word: { noun: "matter", able: "portal", ranAsMoments: true },
  hostEnv: portalHostEnv,
});
