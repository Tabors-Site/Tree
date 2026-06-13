// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seed delegates. My first delegates — pre-planted beings that
// every place ships with.
//
// Every place has a small set of beings I plant at the place root
// itself, not at any tree:
//
//   arrival        The shared stance every unauthenticated visitor
//                  carries. One Being row, many concurrent users
//                  (SEE bypasses the scheduler; no contention).
//                  SEE-only by default. Surfaces as
//                  `<reality>/@arrival` on the network.
//   cherub         The gate. Stands at the threshold between outside
//                  the place (no identity yet) and inside (bound to
//                  a being). The only stance that accepts a request
//                  from an unidentified arrival. BE register/claim/
//                  release/switch. Scripted cognition.
//   llm-assigner   Configures LLM connections (per-being and
//                  per-tree slot assignments) + the first-time setup
//                  tutorial. Scripted cognition.
//   reality-manager  Conversational interface for place-level admin
//                  (extensions, config, peers). LLM cognition —
//                  the only one of the three whose moments are
//                  factory-assembled frames.
//
// They exist as real Being rows so the descriptor can surface them
// and the address grammar resolves `<reality>/@cherub` (etc.) to them.
//
// These are beings I formed from myself, but they are no longer me.
// They have their own identities, their own summon paths, their own
// stances. Anything they do attributes to their own beingId, not to
// me.
//
// Being-tree parenting. Every place has exactly one I-Am at the
// root of the being-tree (the only Being with `parentBeingId:
// null`), planted during `ensureSpaceRoot()`. The delegates here
// and every human are my children. Walking parentBeingId from any
// being eventually reaches me, then `null`.
//
// `ensureSeedDelegates(spaceRootId)` runs at genesis after my Being
// row exists. Idempotent: safe to call every boot. The drift
// reconciler also keeps existing delegate parentBeingId pointed at
// me.
//
// Lookups for I_AM identity (`findIAm`, `iAmIdentity`,
// `findRootOperator`) live alongside other identity primitives in
// [identity.js](identity.js). This file owns the delegate roster
// and the scaffold that ensures their rows exist.

import log from "../../seedReality/log.js";
import { birthBeing } from "./identity/birth.js";
import { findIAm, iAmIdentity } from "./identity.js";
import { I_AM } from "./seedBeings.js";
import { findByName, loadProjection } from "../projections.js";

// `invocableBy` is a display label the portal shows next to the
// delegate ("who is this for?"). It is NOT the auth gate . that's
// role-walk downstream. The only behavior the descriptor
// derives from this field today is `available`: "anyone" maps to
// authorizedHere (the caller can SEE here at all), every other value
// maps to writeAllowed (the caller can write here). The label values
// stay informational: "anyone" means even arrival, "authenticated"
// means any local being, "owner" reads as "this is the root
// operator's tool" even though the gate semantics match
// "authenticated" in this code path. Single source of truth for the
// delegate roster; descriptor.js reads from here.
export const SEED_DELEGATES = [
  {
    name: "arrival",
    role: "arrival",
    cognition: "scripted",
    invocableBy: "anyone",
    description:
      "Shared stance for unauthenticated visitors. SEE-only; one row, many concurrent users.",
  },
  {
    name: "public",
    role: "public",
    cognition: "scripted",
    invocableBy: "no-one",
    description:
      "The commons delegate (seed/RolesAreAuth.md). Holds the owner slot on spaces transferred to the public commons. Visitors get the commons role via auto-on-entry on those spaces, admitted through the regular role-walk. Never acts; never accepts SUMMONs. The silence IS the lock — Public-owned spaces can't be re-privatized except by I-Am (public's own owner) or by branching the timeline.",
  },
  {
    name: "cherub",
    role: "cherub",
    cognition: "scripted",
    invocableBy: "anyone",
    description:
      "Welcome character; processes BE register/claim/release/switch.",
  },
  {
    name: "birther",
    role: "birther",
    cognition: "scripted",
    invocableBy: "authenticated",
    description:
      "Sibling delegate to cherub. Cherub serves unauthenticated arrival (mint a fresh identity on this reality). Birther serves authenticated callers (mint a child being whose parent is you).",
  },
  {
    name: "role-manager",
    role: "role-manager",
    cognition: "scripted",
    invocableBy: "authenticated",
    description:
      "Authors and edits live-defined roles. Click @role-manager at the reality root to add or replace a role with origin:'live'. Restart picks up live changes; the in-memory registry rebuilds from ./roles on boot.",
  },
  {
    name: "role-finder",
    role: "role-finder",
    cognition: "llm",
    invocableBy: "authenticated",
    description:
      "LLM-cognition helper. Summon @role-finder and describe what a being should do; it searches ./roles for matches, drafts new role definitions, and saves via set-role on user approval. Pairs with @roleflow-composer for end-to-end role authoring.",
  },
  {
    name: "roleflow-composer",
    role: "roleflow-composer",
    cognition: "llm",
    invocableBy: "authenticated",
    description:
      "LLM-cognition helper. Summon @roleflow-composer and describe a being's behavior; it composes a structured roleFlow (the per-moment role-selection program) and writes it onto the target being's qualities via set-being-roleflow.",
  },
  {
    name: "llm-assigner",
    role: "llm-assigner",
    cognition: "scripted",
    invocableBy: "authenticated",
    description:
      "Configures LLM connections — caller's being, owned nodes, or place default (root operator only for place scope).",
  },
  {
    name: "reality-manager",
    role: "reality-manager",
    cognition: "llm",
    invocableBy: "owner",
    description:
      "Conversational interface for place-level administration (extensions, config, peers). Carries the reality-manager role with canDo for set-config, install-extension, etc. — granted at the reality root with reality-wide reach.",
  },
  {
    name: "branch-manager",
    role: "branch-manager",
    cognition: "scripted",
    invocableBy: "authenticated",
    description:
      "Creates and manages branches — divergent worlds forked from a past moment of an existing branch. Click @branch-manager at the reality root to mint a new branch, merge branches, or manage the named-pointer registry (set-pointer, delete-pointer).",
  },
  {
    name: "federation-manager",
    role: "federation-manager",
    cognition: "scripted",
    invocableBy: "owner",
    description:
      "Negotiates transfers with peer realities. Operator triggers offer-template / offer-being (push a template or a being to a peer) or request-template (ask a peer for one of theirs); the role handles incoming offer-template / request-template / deliver-template / deliver-being SUMMONs from peers. Seed (the shape, fresh ids) and graft (the entity, verbatim) are the data primitives; push and pull are the social verbs on top.",
  },
  // The host tier (nodeServerTest Phase 1): the running machine as
  // beings. Each is homed at its ./host child space via
  // homeHeavenSpace rather than the place root; the lifecycle code
  // lives in seed/materials/host/.
  {
    name: "http-server",
    role: "http-server",
    cognition: "scripted",
    invocableBy: "owner",
    homeHeavenSpace: "host-http",
    description:
      "The HTTP listener as a being. Lives at ./host/http; stamps the request stream onto the request-log matter and lifecycle facts (listening, shutdown) onto the http space. Live counters via the http-stats SEE op.",
  },
  {
    name: "websocket-pool",
    role: "websocket-pool",
    cognition: "scripted",
    invocableBy: "owner",
    homeHeavenSpace: "host-websocket",
    description:
      "The WebSocket pool as a being. Lives at ./host/websocket; one connection matter per live socket, created on connect and ended on disconnect. Its act-chain is the connection log; live view via the connections SEE op.",
  },
  {
    name: "mongo",
    role: "mongo-connection",
    cognition: "scripted",
    invocableBy: "owner",
    homeHeavenSpace: "host-mongo",
    description:
      "The Mongo connection as a being. Lives at ./host/mongo; stamps boot and reconnect facts on the mongo space's reel; live stats via the mongo-stats SEE op.",
  },
];

/**
 * Ensure each seed delegate exists as a Being row, has the place
 * root as its home, is parented under me (the only Being with
 * parentBeingId: null) in the being-tree, and is registered in
 * qualities.beings at the place root. Returns a summary
 * { created, existing, deferred }.
 *
 * Deferred when I do not yet exist as a Being row (pre-bootstrap
 * place). ensureSpaceRoot() creates my row first and then calls
 * this. Subsequent boots re-run idempotently to backfill any drift.
 */
export async function ensureSeedDelegates(spaceRootId) {
  // Each delegate birth + each drift-correction set-being rides its
  // OWN withIAmAct moment (one moment, one act). Genesis is a sequence
  // by then: ensureIAm → ensureSpaceRoot → setIAmHomeSpace →
  // ensureSeedDelegates. The I-Am Being row exists by the time this
  // runs.
  if (!spaceRootId) {
    log.warn("SeedDelegates", "ensureSeedDelegates called without a spaceRootId");
    return { created: 0, existing: 0, deferred: false };
  }
  const { withIAmAct } = await import("../../sprout.js");

  const iAm = await findIAm();
  if (!iAm) {
    log.info(
      "SeedDelegates",
      "no I_AM yet; deferring seed-delegate setup until ensureIAm() runs",
    );
    return { created: 0, existing: 0, deferred: true };
  }
  const rootBeingId = String(iAm._id);

  let created = 0;
  let existing = 0;

  // Resolve the space root's size for the seed-delegate circle. With
  // a size we lay out the delegates evenly around a small ring at the
  // center of the place root . a clean stable arrangement instead of
  // the random-coord scatter createBeing would otherwise pick. Without
  // a size we leave coord null and let the renderer's hash-ring
  // fallback handle placement.
  let circleCoord = null;
  try {
    const live = (await loadProjection("space", spaceRootId, "0"))?.state || null;
    let size = live?.size || null;
    if (!size && opts.summonCtx?.deltaF) {
      const pendingCreate = opts.summonCtx.deltaF.find(
        (f) =>
          f?.verb === "do" &&
          f?.action === "create-space" &&
          f?.target?.kind === "space" &&
          String(f?.target?.id) === String(spaceRootId),
      );
      size = pendingCreate?.params?.size || null;
    }
    if (size && Number.isFinite(size.x) && Number.isFinite(size.y) &&
        size.x > 0 && size.y > 0) {
      const cx = size.x / 2;
      const cy = size.y / 2;
      // Ring radius = quarter of the smaller dimension. Tight enough
      // to read as a cluster, large enough that two delegates never
      // overlap visually.
      const r = Math.max(2, Math.min(size.x, size.y) / 4);
      const total = SEED_DELEGATES.length;
      circleCoord = (i) => {
        const angle = (i / total) * Math.PI * 2;
        return {
          x: Math.round(cx + r * Math.cos(angle)),
          y: Math.round(cy + r * Math.sin(angle)),
        };
      };
    }
  } catch { /* defensive: leave circleCoord null */ }

  // Accumulator for the place root's qualities.beings entries. The
  // doctrine (one moment = one act, an act stamps each reel at most
  // once): registering N delegates with N set-space facts on the SAME
  // place root reel from ONE moment is a multi-act-dressed-as-one-act
  // violation. Instead we collect each delegate's roster entry as
  // we go and emit ONE set-space at the end carrying the whole batch.
  const rosterUpdate = {};

  for (let i = 0; i < SEED_DELEGATES.length; i++) {
    const spec = SEED_DELEGATES[i];
    try {
      // Per-delegate home. Most delegates live at the place root;
      // host delegates name a heaven space via homeHeavenSpace and
      // live there. Fallback to the place root when the space hasn't
      // planted (degraded boot); the drift pass re-homes next boot.
      let homeId = String(spaceRootId);
      if (spec.homeHeavenSpace) {
        const { findByHeavenSpace } = await import("../projections.js");
        const slot = await findByHeavenSpace(spec.homeHeavenSpace, "0");
        if (slot?.id) homeId = String(slot.id);
      }

      // Look up by name on main (seed delegates are main-branch).
      const existingSlot = await findByName("being", spec.name, "0");
      if (existingSlot) {
        // Idempotent drift correction: each drift-correction set-being
        // is its own withIAmAct moment per the one-DO-per-moment
        // doctrine. On a clean reboot of an unchanged reality, the
        // checks all match and no moments open — idempotent.
        const { doVerb } = await import("../../ibp/verbs/do.js");
        const beingTarget = { kind: "being", id: String(existingSlot.id) };
        const setFieldInOwnMoment = (label, field, value) =>
          withIAmAct(label, async (ctx) =>
            doVerb(beingTarget, "set-being", { field, value },
              { identity: I_AM, summonCtx: ctx }));

        const st = existingSlot.state || {};
        const quals = st.qualities;
        const existingCognition = quals instanceof Map
          ? quals.get("cognition")?.defaultKind
          : quals?.cognition?.defaultKind;
        if (existingCognition !== spec.cognition) {
          await setFieldInOwnMoment(
            `I correct ${spec.name}'s cognition`,
            "qualities.cognition",
            { defaultKind: spec.cognition },
          );
        }
        if (st.defaultRole !== spec.role) {
          await setFieldInOwnMoment(
            `I correct ${spec.name}'s role`,
            "defaultRole",
            spec.role,
          );
        }
        if (st.homeSpace !== homeId) {
          await setFieldInOwnMoment(
            `I correct ${spec.name}'s home`,
            "homeSpace",
            homeId,
          );
        }
        if (st.parentBeingId !== rootBeingId) {
          await setFieldInOwnMoment(
            `I correct ${spec.name}'s parent`,
            "parentBeingId",
            String(rootBeingId),
          );
        }
        // Room-homed delegates stand at the center of their room;
        // earlier boots birthed them coordless.
        if (spec.homeHeavenSpace && st.coord == null) {
          await setFieldInOwnMoment(
            `I place ${spec.name} in its room`,
            "coord",
            { x: 4, y: 4 },
          );
        }
        // Roster entry on the place root: include existing delegates
        // too so a reboot re-emits the merge map. set-space with merge
        // makes this idempotent — re-writing the same map doesn't
        // re-emit a fact (the caller's qualitiesDiffer guard catches
        // identical state).
        rosterUpdate[spec.name] = {
          beingId: String(existingSlot.id),
          role: spec.role,
          installedAt: new Date().toISOString(),
          installedBy: "seedDelegates",
        };
        existing++;
        continue;
      }

      // I bring the new being into existence through BE:birth — the
      // self-act in the closed three-op BE set (birth/connect/release).
      // Each birth opens its OWN withIAmAct moment so the I-Am's reel
      // shows "I birth <name>" as a distinct entry.
      const iAmIdent = await iAmIdentity();
      let result;
      await withIAmAct(`I birth @${spec.name}`, async (ctx) => {
        result = await birthBeing({
          spec: {
            name: spec.name,
            role: spec.role,
            cognition: spec.cognition,
            homeId,
            parentBeingId: String(rootBeingId),
            // Deterministic ring position when the place root has a
            // size. Falls through to birthBeing's random-in-bounds
            // default when circleCoord couldn't be computed. Host
            // delegates skip the ring (it is sized for the place
            // root) and stand at the center of their own 8x8 room.
            ...(spec.homeHeavenSpace
              ? { coord: { x: 4, y: 4 } }
              : (circleCoord ? { coord: circleCoord(i) } : {})),
          },
          identity: iAmIdent,
          summonCtx: ctx,
        });
      });

      // Stage the delegate's roster entry. Emitted by the caller as
      // its own moment (one set-space on qualities.beings with all
      // entries).
      rosterUpdate[spec.name] = {
        beingId: String(result.beingId),
        role: spec.role,
        installedAt: new Date().toISOString(),
        installedBy: "seedDelegates",
      };
      created++;
      log.info("Genesis", `I create ${spec.name}.`);
    } catch (err) {
      log.error(
        "SeedDelegates",
        `failed to ensure ${spec.role} delegate: ${err.message}`,
      );
    }
  }

  // NOTE: roster set-space DOES NOT happen here. The caller
  // (genesis.js) emits it as its own withIAmAct moment after this
  // function returns — keeping the one-moment-one-act doctrine clean.
  // Return the rosterUpdate dict; the caller writes it.

  if (created > 0 || existing > 0) {
    log.verbose(
      "SeedDelegates",
      `seed delegates ensured: ${created} created, ${existing} already present (parent=${rootBeingId.slice(0, 8)})`,
    );
  }
  return { created, existing, deferred: false, rosterUpdate };
}

// ───────────────────────────────────────────────────────────────────
// Heaven angels (the seed delegates)
// ───────────────────────────────────────────────────────────────────
//
// The retired `ensureSeedDelegatesOnHeaven` added each delegate to
// heaven's `members.angel` class — that was the gate under the old
// stance-auth layered model. Under roles-are-auth (seed/RolesAreAuth.md),
// the gate is `grantAngelToSeedDelegates` below: each delegate gets
// the angel ROLE granted anchored at heaven, the role's spec lives in
// heaven.qualities.roles.angel, and the role-walk authorize finds it
// by walking the grant's anchor up the qualities chain. No member-class
// dance needed.

/**
 * Roles-Are-Auth bootstrap (seed/RolesAreAuth.md). For each seed
 * delegate, the I-Am emits a `do:grant-role` fact giving them the
 * `angel` role anchored at heaven. The being reducer
 * (applyRoleGrants in reducerHelpers.js) folds these facts into the
 * delegate's `qualities.rolesGranted`.
 *
 * Doctrine: angel is about IDENTITY, not just canDo. Seed delegates
 * ARE angels by birth — descendants of I-Am, with heaven access by
 * structural right. The grant codifies that identity: "this being
 * belongs to the heavenly hierarchy and the chain back to I-Am IS
 * their authority." Each delegate's matching role (cherub holds
 * cherub, birther holds birther, etc., granted separately) carries
 * the specific canX they need for day-to-day work; angel is the
 * identity layer, the membership badge, and the access path to
 * heaven space when they later need to operate there.
 *
 * Exceptions: @public (never acts, no grants) and @arrival (shared
 * anonymous-visitor stance — granting angel to arrival would give
 * every anon visitor angel's canSee:["*"], leaking everything; arrival
 * gets its own arrival role only).
 *
 * One moment per delegate (per the one-DO-per-moment doctrine).
 * Idempotent: the reducer dedupes by (role, anchor, grantor) so a
 * re-emit on reboot is a no-op.
 */
export async function grantAngelToSeedDelegates() {
  const { findByName, findByHeavenSpace } = await import("../projections.js");
  const { HEAVEN_SPACE } = await import("../space/heavenSpaces.js");
  const { withIAmAct } = await import("../../sprout.js");
  const { doVerb } = await import("../../ibp/verbs/do.js");

  // angel is hosted on heaven (seed/RolesAreAuth.md). Anchor every
  // delegate's grant there so the role-walk authorize finds the spec
  // by walking the grant's anchor up the qualities chain. Reach via
  // angel's qualities is the heaven subtree by default; the angel
  // role's reach field can extend it reality-wide if seed needs it
  // (default angel canX includes "*" so the gate passes once reach
  // is met).
  const heaven = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, "0");
  if (!heaven) {
    log.warn(
      "SeedDelegates",
      "grantAngelToSeedDelegates: heaven not yet materialized; skipping",
    );
    return { granted: 0 };
  }

  let granted = 0;
  for (const spec of SEED_DELEGATES) {
    // @public is a structural placeholder, not an actor. Skip the
    // angel grant — public never acts, never uses canX, and granting
    // it angel would noise up the audit chain without effect.
    if (spec.name === "public") continue;
    // @arrival is the SHARED anonymous-visitor stance. Every anon WS
    // socket binds to its identity. Granting it angel would give every
    // visitor angel's canSee:["*"] — raw SEE on everything — which
    // breaks the filtered arrival-view doctrine. Arrival gets ONLY its
    // own role granted below (canSee:["arrival-view"] + canBe:
    // ["birth","connect","release"] + canSummon:@cherub:mate).
    if (spec.name === "arrival") continue;
    const slot = await findByName("being", spec.name, "0");
    if (!slot) continue;
    try {
      await withIAmAct(`I grant angel to @${spec.name}`, async (ctx) => {
        await doVerb(
          { kind: "being", id: String(slot.id) },
          "grant-role",
          {
            role:          "angel",
            anchorSpaceId: String(heaven.id),
            anchorBeingId: null,
          },
          { identity: I_AM, summonCtx: ctx },
        );
      });
      granted++;
    } catch (err) {
      log.warn(
        "SeedDelegates",
        `failed to grant angel to @${spec.name}: ${err?.message || err}`,
      );
    }
  }

  // Every seed delegate gets its OWN matching role granted at the
  // reality root (in addition to angel @ heaven). This means:
  //   @cherub holds cherub role, @birther holds birther role,
  //   @role-manager holds role-manager role, etc.
  // The role-walk authorize finds each delegate's canX through their
  // OWN role's grant (instead of the registry-fallback hack in
  // roleFlow.js). Reach is reality-wide via host + descendants from
  // the reality root.
  //
  // @public still gets no role grant (it never acts).
  // @arrival's match: arrival role granted at root (covers anon visitors).
  const { getSpaceRootId } = await import("../../sprout.js");
  const rootId = getSpaceRootId();
  if (!rootId) return { granted };

  for (const spec of SEED_DELEGATES) {
    if (spec.name === "public") continue;
    const slot = await findByName("being", spec.name, "0");
    if (!slot) continue;
    try {
      await withIAmAct(`I grant ${spec.role} to @${spec.name}`, async (ctx) => {
        await doVerb(
          { kind: "being", id: String(slot.id) },
          "grant-role",
          {
            role:          spec.role,
            anchorSpaceId: String(rootId),
            anchorBeingId: null,
          },
          { identity: I_AM, summonCtx: ctx },
        );
      });
      granted++;
    } catch (err) {
      log.warn(
        "SeedDelegates",
        `failed to grant ${spec.role} to @${spec.name}: ${err?.message || err}`,
      );
    }
  }

  return { granted };
}
