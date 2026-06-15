// Store registrar handlers. One per intent.
//
// The catalog IS the registrar's folded qualities. Every publish or
// retire is ONE set-being the registrar writes on its OWN being, so a
// publish is one moment and one fact, exactly the federation-manager
// pattern. The registrar's reel is the catalog's whole history; its
// folded qualities.store are the catalog now. "Browsing is SEE" means
// SEE the registrar.
//
// The write authorizes because the registrar OWNS its home space (the
// catalog space, owner-set by the seed): a set-being on a being resolves
// auth to that being's home space, and the registrar owns it. No
// per-publisher grant, no foreign-target gating.
//
// Why qualities and not a space-per-publisher tree: the moment model is
// one-moment-one-write (sealAct refuses a second top-level op), and the
// fold lands at seal, so a synchronous publish cannot create a space,
// then a listing inside it, then a pointer. One self-qualities write per
// publish is the shape that fits. Sharding (per-publisher registrars, or
// a SEE-projection into matter) is the scaling path, noted in ROOTS.md.
//
// Catalog shape (qualities.store.catalog):
//
//   "<publisher>": {
//     "<name>": {
//       pointer:  <claim>,                 // the current chained claim
//       versions: { "<version>": { manifest, listingHash, listingType,
//                                  builtFor, status } }  // status: listed|delisted
//     }
//   }
//
// Immutability: a (publisher, name, version) that already exists with a
// DIFFERENT manifest hash is refused; identical re-publish is idempotent.
// The pointer is the only mutable thing, and it mutates by chaining.

import log from "../../../seed/seedReality/log.js";
import { buildClaim, listingHashOf } from "./lib/claims.js";

// Listing types ARE the resource kinds (RESOURCES.md). Six total:
// code, role, roleflow, seed, asset, pack. A whole-reality publish is
// a "pack" listing whose tree happens to span the entire repo,  no
// separate type; same primitive at a larger scope. The roleflow
// listing path is soft-rejected below pending its design pass.
const LISTING_TYPES = new Set([
  "code", "role", "roleflow", "seed", "asset", "pack",
]);
const NAME_RE = /^[a-z][a-z0-9-]*$/;
const VERSION_RE = /^[A-Za-z0-9][A-Za-z0-9.+-]*$/;
const MAX_MANIFEST_BYTES = 64 * 1024;

function failure(reason, shape = "invalid") {
  return { kind: "failure", ok: false, shape, reason };
}

/** Read a namespace out of qualities that may be a Map or a plain object. */
function nsOf(qualities, ns) {
  if (!qualities) return null;
  if (qualities instanceof Map) return qualities.get(ns) || null;
  return qualities[ns] || null;
}

/** The registrar's own being id + branch for this moment. */
function frameOf(ctx) {
  const meId = ctx?.toBeing?._id
    ? String(ctx.toBeing._id)
    : (ctx?.actorAct?.beingOut || ctx?.actorAct?.beingIn || null);
  const branch = ctx?.actorAct?.branch || ctx?.branch || null;
  if (!meId) throw new Error("registrar: no being id resolvable on ctx");
  if (!branch) throw new Error("registrar: no branch on ctx (refusing to guess)");
  return { meId, branch, identity: { beingId: meId, name: ctx?.toBeing?.name || "registrar" } };
}

/**
 * The publisher's identity: the BEING that summoned the registrar, by
 * its key. Publishing requires an identified being holding the
 * store:publisher role (ROOTS.md). That being may be NATIVE (born
 * here, or grafted in) or FOREIGN (reaching across in its left stance
 * over cross-reality IBP); the key is the publisher either way, so names
 * scope to a key, never to an anonymous domain string. `homeReality`
 * rides along as a label when the publisher reaches across from a peer
 * (the cross-reality summon sets askerReality).
 */
function publisherOf(ctx) {
  const beingId = ctx?.askerBeingId
    || ctx?.actorAct?.beingIn
    || ctx?.toBeing?._id;
  if (!beingId) throw new Error("registrar: no publisher being on ctx (who is asking?)");
  return { key: String(beingId), homeReality: ctx?.askerReality || null };
}

/** Load the registrar's folded qualities.store (prior moments only). */
async function readStore(meId, branch) {
  const { loadProjection } = await import("../../seed/materials/projections.js");
  const slot = await loadProjection("being", meId, branch);
  const store = nsOf(slot?.state?.qualities, "store");
  const catalog = (store && typeof store.catalog === "object" && store.catalog) || {};
  return { ...(store || {}), catalog };
}

/** Write the whole store namespace back in one self-authorized set-being. */
async function writeStore(frame, ctx, store) {
  const { doVerb } = await import("../../seed/ibp/verbs/do.js");
  await doVerb(
    { kind: "being", id: frame.meId },
    "set-being",
    { field: "qualities.store", value: store, merge: false },
    { identity: frame.identity, summonCtx: ctx },
  );
}

// ── intents ──────────────────────────────────────────────────────────

/**
 * publish-listing
 *   payload: { listingType, manifest: { name, version, description?,
 *              builtFor?, assets?: [{ hash, label?, size? }], requires? } }
 *   response: { kind: "published", publisher, name, version,
 *               listingHash, claimHash, seq, idempotent? }
 */
export async function publishListing(fed, ctx) {
  const manifest = fed?.manifest;
  const listingType = fed?.listingType || manifest?.listingType || null;

  if (listingType === "roleflow") {
    return failure(
      "roleflow listings await their design pass (ROOTS.md build order); publish extensions and seeds today",
      "unsupported",
    );
  }
  if (!LISTING_TYPES.has(listingType)) {
    return failure(`listingType must be one of: ${[...LISTING_TYPES].join(", ")}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return failure("manifest object is required");
  }
  const name = manifest.name;
  const version = String(manifest.version || "");
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    return failure("manifest.name must be kebab-case (a-z, 0-9, hyphens)");
  }
  if (!VERSION_RE.test(version)) {
    return failure("manifest.version is required (letters, digits, dots, +, -)");
  }
  if (manifest.assets !== undefined) {
    if (!Array.isArray(manifest.assets)) return failure("manifest.assets must be an array");
    for (const a of manifest.assets) {
      if (!a || typeof a.hash !== "string" || !a.hash.length) {
        return failure("every manifest.assets entry needs a content hash");
      }
    }
  }
  if (manifest.requires !== undefined && !Array.isArray(manifest.requires)) {
    return failure("manifest.requires must be an array");
  }
  const { canonicalJson } = await import("./lib/claims.js");
  if (Buffer.byteLength(canonicalJson(manifest), "utf8") > MAX_MANIFEST_BYTES) {
    return failure(`manifest exceeds ${MAX_MANIFEST_BYTES} bytes; assets travel as hashes, not bytes`, "too-large");
  }

  const frame = frameOf(ctx);
  const { key: publisher, homeReality } = publisherOf(ctx);
  const listingHash = listingHashOf(manifest);

  const store = await readStore(frame.meId, frame.branch);
  const nameNode = store.catalog[publisher]?.[name] || { pointer: null, versions: {} };

  // Immutability gate: a version is its hash, forever.
  const existing = nameNode.versions[version];
  if (existing) {
    if (existing.listingHash === listingHash) {
      log.info("Store", `re-publish of ${publisher}/${name}@${version} is identical; idempotent ok`);
      return { kind: "published", idempotent: true, publisher, name, version, listingHash, claimHash: nameNode.pointer?.claimHash || null, seq: nameNode.pointer?.seq ?? null };
    }
    return failure(
      `${name}@${version} is already published by ${publisher} with different content; versions are immutable, publish a new version`,
      "immutable",
    );
  }

  // Advance the name pointer by chaining a new claim onto the last.
  const prevClaim = nameNode.pointer || null;
  const claim = buildClaim({
    publisher, name, version, listingHash,
    state: "current",
    prev: prevClaim?.claimHash || null,
    seq: prevClaim ? (Number(prevClaim.seq) || 0) + 1 : 0,
  });

  const newNameNode = {
    pointer: claim,
    versions: {
      ...nameNode.versions,
      [version]: {
        manifest,
        listingHash,
        listingType,
        builtFor: typeof manifest.builtFor === "string" ? manifest.builtFor : null,
        homeReality,
        status: "listed",
      },
    },
  };
  store.catalog = {
    ...store.catalog,
    [publisher]: { ...(store.catalog[publisher] || {}), [name]: newNameNode },
  };
  await writeStore(frame, ctx, store);

  log.info("Store", `published ${publisher}/${name}@${version} (${listingType}, ${listingHash.slice(0, 12)}…)`);
  return { kind: "published", publisher, name, version, listingHash, claimHash: claim.claimHash, seq: claim.seq };
}

/**
 * retire-listing
 *   payload: { name, successor? }
 *   Publisher-only sunset: chains a "retired" claim onto the name's
 *   pointer. Distinct from store:delist (the operator's lever) and from
 *   deletion (which does not exist; the versions remain).
 */
export async function retireListing(fed, ctx) {
  const name = fed?.name;
  if (typeof name !== "string" || !NAME_RE.test(name)) {
    return failure("name is required (kebab-case)");
  }
  const successor = typeof fed?.successor === "string" ? fed.successor : null;

  const frame = frameOf(ctx);
  const { key: publisher } = publisherOf(ctx);

  const store = await readStore(frame.meId, frame.branch);
  const nameNode = store.catalog[publisher]?.[name];
  const prevClaim = nameNode?.pointer || null;
  if (!prevClaim) return failure(`no pointer for "${name}" by ${publisher}`, "not-found");
  if (prevClaim.publisher !== publisher) {
    // The catalog is keyed by publisher being, so this is belt-and-
    // suspenders: a different being's summon reads a different catalog
    // branch and never reaches another publisher's pointer.
    return failure("only the publisher may retire its own name", "forbidden");
  }
  if (prevClaim.state === "retired") {
    return { kind: "retired", idempotent: true, name, publisher, claimHash: prevClaim.claimHash, seq: prevClaim.seq };
  }

  const claim = buildClaim({
    publisher, name,
    version: prevClaim.version,
    listingHash: prevClaim.listingHash,
    state: "retired",
    successor,
    prev: prevClaim.claimHash,
    seq: (Number(prevClaim.seq) || 0) + 1,
  });
  store.catalog = {
    ...store.catalog,
    [publisher]: { ...store.catalog[publisher], [name]: { ...nameNode, pointer: claim } },
  };
  await writeStore(frame, ctx, store);

  log.info("Store", `retired ${publisher}/${name}${successor ? ` (successor: ${successor})` : ""}`);
  return { kind: "retired", name, publisher, successor, claimHash: claim.claimHash, seq: claim.seq };
}

/**
 * delist, the store operator's editorial lever (called by the delist
 * DO op, not an intent). Marks one (publisher, name, version) delisted in
 * the registrar's catalog. Never a deletion; the version stays, the hash
 * stays, mirrors may still carry it.
 */
export async function delistVersion(ctx, { publisher, name, version, reason = null }) {
  const frame = frameOf(ctx);
  const store = await readStore(frame.meId, frame.branch);
  const entry = store.catalog[publisher]?.[name]?.versions?.[version];
  if (!entry) {
    return { ok: false, reason: `no ${publisher}/${name}@${version} in this catalog` };
  }
  store.catalog[publisher][name] = {
    ...store.catalog[publisher][name],
    versions: {
      ...store.catalog[publisher][name].versions,
      [version]: { ...entry, status: "delisted", ...(reason ? { delistReason: reason } : {}) },
    },
  };
  await writeStore(frame, ctx, store);
  log.info("Store", `delisted ${publisher}/${name}@${version}`);
  return { ok: true, publisher, name, version };
}
