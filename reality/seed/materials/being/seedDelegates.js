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
import Being from "./being.js";
import { summonCreateBeing } from "../../ibp/verbs/summon.js";
import { findIAm, iAmIdentity } from "./identity.js";
import { I_AM } from "./seedBeings.js";

// `invocableBy` is a display label the portal shows next to the
// delegate ("who is this for?"). It is NOT the auth gate . that's
// stance authorization downstream. The only behavior the descriptor
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
      "Conversational interface for place-level administration (extensions, config, peers). Carries no authority of its own; its writes are gated by the caller's stance — root operator, or owner / contributor on the place root.",
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
export async function ensureSeedDelegates(spaceRootId, summonCtx, opts = {}) {
  if (!spaceRootId) {
    log.warn("SeedDelegates", "ensureSeedDelegates called without a spaceRootId");
    return { created: 0, existing: 0, deferred: false };
  }
  if (!summonCtx) {
    throw new Error(
      "ensureSeedDelegates requires summonCtx. Reachable only from inside withBootMoment(...).",
    );
  }

  // Inside the boot moment the spaceRoot and I-Am Being rows haven't
  // materialized yet (they're pending facts in summonCtx.deltaF).
  // sprout.js passes the planted I-Am id (`opts.iAmBeingId`); without
  // it we fall back to the live lookup for the Awakening path.
  let iAm = null;
  if (opts.iAmBeingId) {
    iAm = { _id: opts.iAmBeingId, _pending: true };
  } else {
    iAm = await findIAm();
    if (!iAm) {
      log.info(
        "SeedDelegates",
        "no I_AM yet; deferring seed-delegate setup until ensureSpaceRoot() runs",
      );
      return { created: 0, existing: 0, deferred: true };
    }
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
    const live = await Space.findById(spaceRootId).select("size").lean();
    let size = live?.size || null;
    if (!size && opts.summonCtx?.deltaF) {
      const pendingCreate = opts.summonCtx.deltaF.find(
        (f) =>
          f?.verb === "do" &&
          f?.action === "create-space" &&
          f?.target?.kind === "space" &&
          String(f?.target?.id) === String(spaceRootId),
      );
      size = pendingCreate?.params?.spec?.size || null;
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

  for (let i = 0; i < SEED_DELEGATES.length; i++) {
    const spec = SEED_DELEGATES[i];
    try {
      // Look up by name (the canonical identifier per place).
      const existingBeing = await Being.findOne({ name: spec.name }).select(
        "_id defaultRole homeSpace qualities parentBeingId",
      );
      if (existingBeing) {
        // Idempotent drift correction: keep cognition/role/home/parent
        // in sync via do.set facts (one per field that drifted, on the
        // delegate's reel). The legacy `existingBeing.save()` direct
        // write retired (2026-05-23); fact-driven keeps the genesis
        // exception list short (only the spaceRoot/I_AM creation).
        const { doVerb } = await import("../../ibp/verbs/do.js");
        const setOpts = { scaffold: true, summonCtx };
        const beingTarget = { kind: "being", id: String(existingBeing._id) };
        const setField = (field, value) =>
          doVerb(beingTarget, "set-being", { field, value }, setOpts);

        // Cognition drift correction. The cognition kind lives at
        // qualities.cognition.defaultKind (closed-set "llm"|"human"|
        // "scripted"); compare and write through set-being qualities
        // when the existing delegate has drifted from the spec.
        const quals = existingBeing.qualities;
        const existingCognition = quals instanceof Map
          ? quals.get("cognition")?.defaultKind
          : quals?.cognition?.defaultKind;
        if (existingCognition !== spec.cognition) {
          await setField("qualities.cognition", { defaultKind: spec.cognition });
        }
        if (existingBeing.defaultRole !== spec.role) {
          await setField("defaultRole", spec.role);
        }
        if (existingBeing.homeSpace !== String(spaceRootId)) {
          await setField("homeSpace", String(spaceRootId));
        }
        if (existingBeing.parentBeingId !== rootBeingId) {
          await setField("parentBeingId", rootBeingId);
        }
        existing++;
        continue;
      }

      // I summon the new being forth. SUMMON is the verb of one
      // being calling another, and the act of calling a not-yet-
      // being into being is the same act. The seed-internal helper
      // writes the Being row + audits the act as my own. homeSpace
      // = place root because seed delegates live at the place root
      // itself; parent = me, so the being-tree chain delegate → me
      // → null is intact.
      // Build the I-Am identity from the planted id without a Mongo
      // lookup (the row is still pending inside the boot moment). The
      // be:summon-create Fact summonCreateBeing stamps inside this
      // moment carries rootBeingId as the actor on its own reel.
      const iAmIdent = iAm._pending
        ? { beingId: rootBeingId, name: I_AM }
        : await iAmIdentity();
      await summonCreateBeing({
        spec: {
          name: spec.name,
          role: spec.role,
          cognition: spec.cognition,
          homeSpace: String(spaceRootId),
          parentBeingId: rootBeingId,
          // Deterministic ring position when the place root has a
          // size. Falls through to createBeing's random-in-bounds
          // default when circleCoord couldn't be computed.
          ...(circleCoord ? { coord: circleCoord(i) } : {}),
        },
        identity: iAmIdent,
        scaffold: true,
        summonCtx,
      });
      created++;
      log.info("Genesis", `I create ${spec.name}.`);
    } catch (err) {
      log.error(
        "SeedDelegates",
        `failed to ensure ${spec.role} delegate: ${err.message}`,
      );
    }
  }

  if (created > 0 || existing > 0) {
    log.verbose(
      "SeedDelegates",
      `seed delegates ensured: ${created} created, ${existing} already present (parent=${rootBeingId.slice(0, 8)})`,
    );
  }
  return { created, existing, deferred: false };
}
