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
import { IbpError, IBP_ERR } from "../../../ibp/protocol.js";
import { emitFact } from "../../../past/fact/facts.js";
import { detectTargetKind, targetIdOf } from "../../../materials/_targetShape.js";
import { matterContentId } from "../../../materials/matter/matterId.js";
import { registerRoleWord } from "../../../present/word/roleWordRegistry.js";

// Self-register this module's co-located `.word` slice (CONVERTING.md): importing
// portalOp.js (at seed boot, or in a DRY harness) registers it so
// resolveRoleWord("portal", "form-portal") finds the world strand. The cut in the
// handler runs it through the bridge with portalHostEnv(); the JS body is the
// clean-miss fallback.
registerRoleWord("portal", "form-portal", new URL("./portal.word", import.meta.url));

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

// The .word is the live path: run portal.word through the bridge (CALLER mode, host
// see-ops wired by portalHost.js). It COMPOSES create-matter with a nested ibpa spec —
// no host: emit. Returns the result, or null on a clean miss so the JS body below runs.
async function _formPortalViaWord({ target, params, identity, moment }) {
  if (!moment) return null;
  const { resolveRoleWord, runRoleWord } = await import("../../../present/word/roleWordRegistry.js");
  const ir = resolveRoleWord("portal", "form-portal", moment?.actorAct?.history);
  if (!ir) return null;
  const { portalHostEnv } = await import("./portalHost.js");
  try {
    const { result } = await runRoleWord(ir, {
      moment,
      history: moment?.actorAct?.history,
      trigger: {
        target,
        foreignAddress: params?.target ?? null,
        name: params?.name ?? null,
        caller: identity?.beingId ? String(identity.beingId) : null,
      },
      env: { host: portalHostEnv() },
    });
    return result || null;
  } catch (e) {
    if (e && e.__wordRefusal) throw new IbpError(e.code || IBP_ERR.INVALID_INPUT, e.message);
    throw e;
  }
}

async function formPortalHandler({ target, params, moment, identity }) {
  // THE CONVERSION: form-portal's world strand is portal.word (composes create-matter).
  // The JS body below is the clean-miss fallback.
  const viaWord = await _formPortalViaWord({ target, params, identity, moment });
  if (viaWord) return viaWord;

  const { target: foreignAddress, name } = params || {};

  if (typeof foreignAddress !== "string" || !foreignAddress.length) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "form-portal: `target` must be a foreign IBPA string (e.g. \"bing.com#0/library\")",
    );
  }
  if (!IBPA_RE.test(foreignAddress)) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `form-portal: \`target\` doesn't look like a foreign IBPA: "${foreignAddress}". ` +
        `Expected "<story-domain>[#<branch>]/<position>".`,
    );
  }

  // Resolve the containing space. Portal forms inside the space the
  // actor is acting on. Matter targets get the matter's containing
  // space; space targets are the space itself.
  const kind = detectTargetKind(target);
  let spaceId;
  if (kind === "space") {
    spaceId = String(targetIdOf(target));
  } else if (kind === "matter") {
    const { loadOrFold } = await import("../../../materials/projections.js");
    const history = moment?.actorAct?.history || "0";
    const matterSlot = await loadOrFold("matter", String(targetIdOf(target)), history);
    spaceId = matterSlot?.state?.spaceId || null;
    if (!spaceId) {
      throw new IbpError(
        IBP_ERR.SPACE_NOT_FOUND,
        "form-portal: cannot determine containing space for the matter target",
      );
    }
  } else {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `form-portal: target must be a space or matter (got ${kind})`,
    );
  }

  const actorBeingId = identity?.beingId
    ? String(identity.beingId)
    : null;
  if (!actorBeingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "form-portal requires an identified actor",
    );
  }

  const history = moment?.targetHistory || moment?.actorAct?.history || "0";

  // ONE fact births the typed portal whole: type, the content
  // reference, and the qualities.portal provenance block all ride
  // the create-matter params (applyCreateMatter copies qualities).
  // The content lives on the foreign story — the {target} reference
  // shape says so; no separate origin tag.
  //
  // Build the spec FIRST, then content-address the row id from it with
  // matterContentId — the same recipe every other matter uses (matter/
  // ops.js). Hashing the exact object that rides the fact guarantees the
  // id is byte-reproducible from its birth spec, never a floating uuid.
  const createSpec = {
    spaceId,
    beingId: actorBeingId,
    type: "ibpa",
    content: { target: foreignAddress },
    name: name || `portal → ${foreignAddress}`,
    parentMatterId: null,
    qualities: {
      // Renderer back-compat + provenance. `content.target` is
      // canonical; qualities.portal.target mirrors it for the
      // existing 3D portal-mesh keying.
      portal: {
        target:    foreignAddress,
        createdBy: actorBeingId,
      },
    },
  };
  const matterId = matterContentId(createSpec);

  await emitFact(
    {
      verb: "do",
      act: "create-matter",
      through: actorBeingId,
      of: { kind: "matter", id: matterId },
      params: createSpec,
      actId: moment?.actId || null,
      history,
    },
    moment,
  );

  return {
    formed: true,
    matterId,
    spaceId,
    target: foreignAddress,
    _factTarget: { kind: "matter", id: matterId },
  };
}

registerOperation("form-portal", {
  targets: ["space", "matter"],
  ownerExtension: "seed",
  factAction: "form-portal",
  // form-portal lays NO fact of its own: portal.word composes do:create-matter,
  // which lays the one caller-attributed fact. (The clean-miss JS fallback self-
  // emits that same create-matter fact.) No redundant do:form-portal audit.
  skipAudit: true,
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
  handler: formPortalHandler,
});
