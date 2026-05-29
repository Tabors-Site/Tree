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

export const SEED_DELEGATES = [
  {
    name: "arrival",
    role: "arrival",
    operatingMode: "scripted",
    description:
      "Shared stance for unauthenticated visitors. SEE-only; one row, many concurrent users.",
  },
  {
    name: "cherub",
    role: "cherub",
    operatingMode: "scripted",
    description:
      "Welcome character; processes BE register/claim/release/switch.",
  },
  {
    name: "llm-assigner",
    role: "llm-assigner",
    operatingMode: "scripted",
    description:
      "Configures LLM connections — caller's being, owned nodes, or place default (root operator only for place scope).",
  },
  {
    name: "reality-manager",
    role: "reality-manager",
    operatingMode: "llm",
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

  for (const spec of SEED_DELEGATES) {
    try {
      // Look up by name (the canonical identifier per place).
      const existingBeing = await Being.findOne({ name: spec.name }).select(
        "_id roles defaultRole homeSpace operatingMode parentBeingId",
      );
      if (existingBeing) {
        // Idempotent drift correction: keep mode/role/home/parent in
        // sync via do.set facts (one per field that drifted, on the
        // delegate's reel). The legacy `existingBeing.save()` direct
        // write retired (2026-05-23); fact-driven keeps the genesis
        // exception list short (only the spaceRoot/I_AM creation).
        const { doVerb } = await import("../../ibp/verbs/do.js");
        const setOpts = { scaffold: true, summonCtx };
        const setField = (field, value) =>
          doVerb(existingBeing, "set-being", { field, value }, setOpts);

        if (existingBeing.operatingMode !== spec.operatingMode) {
          await setField("operatingMode", spec.operatingMode);
        }
        const carried = Array.isArray(existingBeing.roles)
          ? existingBeing.roles
          : [];
        if (!carried.includes(spec.role) || carried.length !== 1) {
          await setField("roles", [spec.role]);
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
        ? { beingId: rootBeingId, name: "I_AM" }
        : await iAmIdentity();
      await summonCreateBeing({
        spec: {
          name: spec.name,
          role: spec.role,
          operatingMode: spec.operatingMode,
          homeSpace: String(spaceRootId),
          parentBeingId: rootBeingId,
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
