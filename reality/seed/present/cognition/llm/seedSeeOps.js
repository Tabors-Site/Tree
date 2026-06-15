// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Foundational seed SEE ops. The named perceptions every reality
// ships so roles can declare canSee: ["place"], canSee: ["roles"],
// etc. and get a focused view of the matter the heaven space already
// curates.
//
// Registered through the unified seeOps registry (seed/ibp/seeOps.js)
// — same surface as extension-supplied SEE ops, no privileged path.
//
// Two flavors here:
//   - heaven catalogs (roles / tools / operations / identity / config
//     / peers / extensions) — each wraps seeVerb on the corresponding
//     heaven address. Returns the descriptor that address would render.
//   - "place" — the position projection. Returns the descriptor for
//     wherever the being currently stands. Position-aware: every
//     moment the being moves, the same "place" name resolves to a
//     different descriptor.
//
// Naming. All are bare names (seed-owned). Extensions register SEE
// ops under "<ext>:<name>".

import { registerSeeOperation } from "../../../ibp/seeOps.js";
import { seeVerb } from "../../../ibp/verbs/see.js";
import { getRealityDomain } from "../../../ibp/address.js";
import log from "../../../seedReality/log.js";
// Side-effect import: registers the my-inner-face SEE op (the live
// canonical inner face for the caller's active stance). Roles can
// declare `canSee: ["my-inner-face"]` to preload their own face; the
// human portal calls client.see("my-inner-face") to render it.
import "../human/myInnerFace.js";

const HEAVEN_SEES = [
  "roles",
  "tools",
  "operations",
  "identity",
  "config",
  "peers",
  "extensions",
];

for (const name of HEAVEN_SEES) {
  registerSeeOperation(name, {
    ownerExtension: "seed",
    description: `Heaven catalog: ${name}`,
    handler: async ({ identity }) => {
      const address = `${getRealityDomain()}/./${name}`;
      try {
        return await seeVerb(address, {
          identity: identity || null,
        });
      } catch (err) {
        log.warn(
          "SeedSees",
          `see "${name}" (${address}) failed: ${err.message}`,
        );
        return null;
      }
    },
  });
}

// "place" — the general position projection. Returns the descriptor
// for wherever the being currently stands. This is the canonical
// "general place see that shows everything" that other SEE ops can
// build on (chopping it up, filtering, etc.).
registerSeeOperation("place", {
  ownerExtension: "seed",
  description: "Position descriptor — where this being currently stands",
  handler: async ({ identity, ctx }) => {
    const spaceId =
      (ctx?.being?.position && String(ctx.being.position)) ||
      ctx?.currentSpace ||
      ctx?.targetSpace ||
      ctx?.rootId ||
      null;
    if (!spaceId) return null;
    const address = `${getRealityDomain()}/${spaceId}`;
    try {
      return await seeVerb(address, {
        identity: identity || (ctx?.being?._id
          ? { beingId: String(ctx.being._id), name: ctx?.being?.name || null }
          : null),
      });
    } catch (err) {
      log.warn("SeedSees", `see "place" (${address}) failed: ${err.message}`);
      return null;
    }
  },
});

// "arrival-view" — the implicit floor for stateless visitors. Returns
// a HAND-FILTERED descriptor of the reality root: physical layout
// (name, size, coords) and the cherub being. Strips every other being
// and all matter. The portal's landing page calls
// `see("arrival-view")` to render the public face that lets a visitor
// find and address cherub to register.
//
// Per seed/RolesAreAuth.md, arrival's canSee is ["arrival-view"] only
// — anonymous callers cannot see raw positions or any other SEE op.
// This op is the one window an anonymous caller has into the world.
registerSeeOperation("arrival-view", {
  ownerExtension: "seed",
  description: "The public landing face: reality root layout + cherub only",
  handler: async ({ identity }) => {
    // The reality root resolves from the bare `<reality>/` address.
    // (An earlier shape was `<reality>/<rootId>` — that doesn't parse,
    // since path segments are space NAMES, not IDs, and the root's id
    // never appears as a named child of itself.)
    const address = `${getRealityDomain()}/`;
    // The arrival-view op IS the seed's curated anonymous-safe surface.
    // We read the full place descriptor under I_AM identity (which has
    // universal SEE) and then filter to cherub-only. The wire-level
    // authorize already admitted the CALLER for the arrival-view op
    // itself via the role-walk; this inner SEE is a server-internal
    // descriptor fetch, not a delegation of the caller's authority.
    const { I_AM } = await import("../../../materials/being/seedBeings.js");
    const iAmIdentity = { beingId: I_AM, name: "I-Am" };
    try {
      const full = await seeVerb(address, { identity: iAmIdentity });
      if (!full) return null;

      // Filter beings → cherub only. Rebuild cherub's actions[] for
      // the ANONYMOUS perspective: arrival sees register + login. The
      // descriptor's enrichBeings ran under I_AM and filtered to only
      // release (because I_AM looks "authenticated" to its check); we
      // override here so the public face surfaces the right actions.
      const { BE_OPS } = await import("../../../ibp/beOps.js");
      const beings = (Array.isArray(full.beings)
        ? full.beings.filter((b) => b?.being === "cherub" || b?.name === "cherub")
        : []
      ).map((cherub) => {
        const actions = [];
        if (BE_OPS.birth) {
          actions.push({
            verb:        "be",
            action:      "birth",
            label:       BE_OPS.birth.label || "Register",
            description: BE_OPS.birth.description || "Create a new account",
            args:        BE_OPS.birth.args || {},
          });
        }
        if (BE_OPS.connect) {
          actions.push({
            verb:        "be",
            action:      "connect",
            label:       BE_OPS.connect.label || "Log in",
            description: BE_OPS.connect.description || "Sign in to your account",
            args:        BE_OPS.connect.args || {},
          });
        }
        return { ...cherub, actions };
      });

      // Name-aware floor: when the socket carries a logged-in NAME (the
      // portal identity), enrich the landing face with THAT name's own
      // beings so the holder can pick one to drive (be:connect) or birth a
      // new one — the "name, no being" state. Gated on a present nameId: an
      // anonymous visitor (no nameId) never triggers the roster read and
      // sees only cherub, so nothing leaks and the hot anon path stays
      // cheap. buildNameDescriptor is leak-safe (field-picked, no key).
      let myBeings = [];
      if (identity?.nameId) {
        try {
          const { buildNameDescriptor } = await import("../../../ibp/descriptor.js");
          const reality = getRealityDomain();
          const nameDesc = await buildNameDescriptor(identity.nameId);
          myBeings = (nameDesc?.beings || []).map((b) => ({
            being:      b.name,
            name:       b.name,
            beingId:    b.beingId,
            homeBranch: b.homeBranch || null,
            mine:       true,
            actions:    (BE_OPS.connect && b.name) ? [{
              verb:        "be",
              action:      "connect",
              label:       `Use ${b.name}`,
              description: "Drive a being you own (no password — your name is signed in)",
              address:     `${reality}/@${b.name}`,
            }] : [],
          }));
        } catch (err) {
          log.warn("SeedSees", `arrival-view name roster failed: ${err.message}`);
        }
      }

      return {
        kind:    full.kind || "place",
        address: full.address,
        size:    full.size  || null,
        coord:   full.coord || null,
        space: full.space ? {
          name:  full.space.name,
          size:  full.space.size  || null,
          coord: full.space.coord || null,
        } : null,
        beings:   [...beings, ...myBeings],
        matter:   [],
        children: [],
        // qualities intentionally dropped — anonymous callers don't see
        // operator-side state. The arrival role's reach is the public
        // surface; everything else is private until they register.
      };
    } catch (err) {
      log.warn("SeedSees", `see "arrival-view" failed: ${err.message}`);
      return null;
    }
  },
});
