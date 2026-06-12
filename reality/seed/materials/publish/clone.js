// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Clone. Capture a subtree's SETUP — beings, roles, qualities,
// configurations, current shape — into a portable artifact that another
// reality (or another part of this one) can graft.
//
// **A clone is a hollow face by design.** It's setup-transfer: "here's
// my dance-floor / lab template / blog skeleton — install it elsewhere."
// The receiver gets the configuration installable, not the history.
// No acts, no biography, no original IDs preserved. The grafted content
// lands as fresh facts on the receiver's branch under the grafter's
// identity; the destination has the shape but no rings, no scars, no
// history of how it came to be — exactly as intended.
//
// Clones are intentionally lossy. If you want full biography transfer
// (acts preserved, identity continuation, original IDs intact), that's
// `seed.js` — the seed artifact is the genome, and is only valid at
// boot via plant. See `seed/done/Chain-Rebuild.md` for the vocabulary
// doctrine pinning that clone and seed are two distinct artifacts with
// two distinct purposes, not one artifact at two fidelity levels.
//
// Implementation: projection-walker. Captures the subtree's CURRENT
// shape (what would appear in a SEE descriptor at the scope root,
// recursively); the graft side synthesizes a chain of create-X facts
// at apply time. History stays out of clones, period — if you want
// history, you want a seed.
//
// Inside the bundle:
//
//   - Spaces, beings, and matter become content entries, each with a
//     `sourceId` that other entries Ref against. The walker doesn't see
//     bare-string IDs inside the bundle — every reference to an
//     aggregate is a `{ __ref, id }` whose id is a sourceId.
//
//   - References that point OUTSIDE the captured subtree are replaced
//     with sentinels:
//       * `REF_INSERTION_POINT` for the scope root's own parent (the
//         graft target fills it in at apply time)
//       * `REF_GRAFT_INITIATOR` for beings/owners outside the subtree
//         (the operator who runs the graft fills it in)
//
// Skip rules (v1):
//
//   - Beings with `password` set (human-cognition) are skipped.
//     Identity-bearing beings can't graft as anonymous facts; a
//     future "ghost being" mechanism might mint a placeholder identity
//     on graft, but v1 stays conservative. (Seeds preserve identity
//     correctly because plant runs in a fresh reality.)
//   - Seed spaces (dot-namespace) are skipped — they're substrate
//     furniture, not user content.
//
// See `bundle.js` for the bundle shape; see `graft.js` for the apply
// side.

import { ref, REF_INSERTION_POINT, REF_GRAFT_INITIATOR } from "../ref.js";
import { remapRefs } from "../refWalker.js";
import { redactSecrets } from "../redact.js";
import { emptyBundle } from "./bundle.js";

/**
 * Clone the subtree rooted at `scopeSpaceId` into a portable bundle.
 *
 * @param {string} scopeSpaceId       bare space-id of the subtree root
 * @param {object} opts
 * @param {string} [opts.branch]      branch to snapshot (default "0")
 * @param {string} [opts.scopeName]   human-friendly label for the bundle meta
 * @param {string} [opts.sourceReality] reality domain (for meta)
 * @param {string} [opts.operatorBeingId] who initiated (for audit meta)
 * @returns {Promise<object>} the clone bundle
 */
export async function cloneSubtree(scopeSpaceId, opts = {}) {
  if (!scopeSpaceId || typeof scopeSpaceId !== "string") {
    throw new Error("cloneSubtree: scopeSpaceId is required");
  }
  const branch = opts.branch || "0";
  // loadOrFold throughout this file: clone walks aggregates on the
  // source branch and captures their state for bundling. An aggregate
  // inherited from main onto the source branch lives only on main's
  // table until lineage cold-fold materializes it here; bare
  // loadProjection silently skipped (continue on !slot) those rows and
  // produced incomplete bundles. The walker only sees what loadOrFold
  // surfaces.
  const { loadProjection, loadOrFold } = await import("../projections.js");
  const { default: Projection } = await import("../branch/projection.js");

  // Direct projection query for "children of space X in branch B".
  // (The generic findByParent helper is being-specific; spaces don't
  // have a single substrate wrapper, so we query directly here.)
  const findSpaceChildren = async (parentId) => {
    return await Projection.find({
      branch, type: "space",
      "state.parent": parentId,
      tombstoned: { $ne: true },
    }).select("id").lean();
  };

  const rootSlot = await loadOrFold("space", scopeSpaceId, branch);
  if (!rootSlot) {
    throw new Error(`cloneSubtree: space "${scopeSpaceId}" not found in branch "${branch}"`);
  }

  const bundle = emptyBundle({
    sourceReality:      opts.sourceReality || null,
    sourceBranch:       branch,
    sourceScopeName:    opts.scopeName || rootSlot.state?.name || null,
    sourceScopeSpaceId: scopeSpaceId,
    operatorBeingId:    opts.operatorBeingId || null,
  });

  // ── 1. Walk the space subtree (BFS, depth-ascending) ──
  // The captured set defines what counts as "inside" the bundle for
  // remap purposes. Anything pointing outside this set becomes a
  // sentinel; anything inside becomes a sourceId-keyed Ref.
  const capturedSpaceIds = new Set();
  const capturedBeingIds = new Set();
  const capturedMatterIds = new Set();

  // Queue: [{ id, parentId, depth }]
  // depth 0 = scope root. We capture root + all descendants.
  const spaceQueue = [{ id: scopeSpaceId, parentId: null, depth: 0 }];
  while (spaceQueue.length > 0) {
    const { id, depth } = spaceQueue.shift();
    if (capturedSpaceIds.has(id)) continue;
    const slot = await loadOrFold("space", id, branch);
    if (!slot) continue;
    // Skip heaven spaces (dot-namespace) UNLESS this is the scope root
    // the operator explicitly chose. Two cases:
    //   - User clones the place root (`.` / SPACE_ROOT heavenSpace):
    //     include the root itself but skip its heavenSpace children
    //     (`.identity`, `.config`, `.tools`, etc. — substrate furniture
    //     that doesn't clone). The user's planted content under the
    //     root still travels.
    //   - User clones a regular space deep in the tree: no heavenSpace
    //     children to filter, just walk normally.
    const isScopeRoot = id === scopeSpaceId;
    if (!isScopeRoot && slot.state?.heavenSpace) continue;
    capturedSpaceIds.add(id);

    const children = await findSpaceChildren(id);
    for (const child of children) {
      spaceQueue.push({ id: child.id, parentId: id, depth: depth + 1 });
    }
  }

  // ── 2. Walk beings whose homeSpace is inside the captured set ──
  // A being's homeSpace is the canonical "is this in the subtree"
  // question. Two classes of being get filtered out:
  //
  //   - Human-cognition beings — replicating an operator's identity
  //     onto another reality is a security smell. They stay home.
  //
  //   - Seed delegates — cherub, arrival, llm-assigner, branch-manager,
  //     role-{manager,finder}, roleflow-composer, reality-manager,
  //     birther. Every reality already plants these at boot
  //     (seed/materials/being/seedDelegates.js); replicating them
  //     would duplicate-mint the receiver's existing delegates.
  //     Skipping them keeps each reality's substrate furniture local.
  //
  // Everything else — dancers, drummers, your own LLM/scripted beings
  // — travels. The earlier check gated on `state.password`, which is
  // present on every being (birthBeing hashes a credential for all
  // cognition kinds), so the filter excluded all beings.
  const { beingCognition } = await import("../being/identity/lookups.js");
  const { SEED_DELEGATES } = await import("../being/seedDelegates.js");
  const SEED_DELEGATE_NAMES = new Set(SEED_DELEGATES.map((d) => d.name));
  for (const spaceId of capturedSpaceIds) {
    const beingRows = await Projection.find({
      branch, type: "being",
      "state.homeSpace": spaceId,
      tombstoned: { $ne: true },
    }).lean();
    for (const row of beingRows) {
      const state = row.state || {};
      if (beingCognition(state) === "human") continue;
      if (state.name && SEED_DELEGATE_NAMES.has(state.name)) continue;
      capturedBeingIds.add(row.id);
    }
  }

  // ── 3. Walk matter whose spaceId is in the captured set ──
  for (const spaceId of capturedSpaceIds) {
    const matterRows = await Projection.find({
      branch, type: "matter",
      "state.spaceId": spaceId,
      tombstoned: { $ne: true },
    }).lean();
    for (const row of matterRows) {
      capturedMatterIds.add(row.id);
    }
  }

  // ── 4. Build the remap function. ──
  // For each captured aggregate id, produce a Ref whose id is the
  // sourceId (which equals the source-substrate id for v1; future
  // versions might re-key for privacy). For uncaptured ids, use the
  // appropriate sentinel.
  const isCapturedSpace  = (id) => capturedSpaceIds.has(id);
  const isCapturedBeing  = (id) => capturedBeingIds.has(id);
  const isCapturedMatter = (id) => capturedMatterIds.has(id);

  // Remap a space's owner for bundle export. Bundle-internal beings
  // become tagged Refs; out-of-bundle owners (or I_AM) collapse to
  // GRAFT_INITIATOR so the graft attributes them to the operator.
  const remapOwnerForBundle = (owner) => {
    if (!owner) return null;
    return tagId("being", String(owner), { uncapturedSentinel: REF_GRAFT_INITIATOR });
  };

  // Build a tagging function: turns a bare-string id (or null) into a
  // Ref (or sentinel, or null). Kind is given by the field's known type.
  const tagId = (kind, id, { uncapturedSentinel }) => {
    if (id === null || id === undefined) return null;
    if (typeof id !== "string") return id;  // already a Ref or other shape; pass through
    const inside =
      kind === "space"  ? isCapturedSpace(id)  :
      kind === "being"  ? isCapturedBeing(id)  :
      kind === "matter" ? isCapturedMatter(id) :
      false;
    if (inside) return ref(kind, id);
    return uncapturedSentinel;
  };

  // Walker for `qualities`: aggregate IDs inside qualities namespaces
  // need tagging too. The walker doesn't know what's an ID without a
  // hint, so for v1 we keep qualities as opaque (substrate doctrine:
  // qualities are extension-defined; the bundle preserves them
  // verbatim). Future versions might let extensions register a
  // namespace-level tagger.

  // ── 5. Capture spaces in depth order. ──
  // Sort by source depth so parents come before children in
  // bundle.content.spaces. The graft side relies on this ordering
  // to stamp create-space facts with already-existing parents.
  const spaceDepth = new Map();
  spaceDepth.set(scopeSpaceId, 0);
  {
    const q = [scopeSpaceId];
    while (q.length > 0) {
      const id = q.shift();
      const kids = await findSpaceChildren(id);
      for (const k of kids) {
        if (capturedSpaceIds.has(k.id) && !spaceDepth.has(k.id)) {
          spaceDepth.set(k.id, (spaceDepth.get(id) || 0) + 1);
          q.push(k.id);
        }
      }
    }
  }
  const orderedSpaceIds = [...capturedSpaceIds].sort(
    (a, b) => (spaceDepth.get(a) || 0) - (spaceDepth.get(b) || 0),
  );

  // Strip qualities.beings entries that point at uncaptured beings
  // (seed delegates we skipped, beings outside the captured subtree).
  // Without this, the bundle's qualities.beings on the scope root
  // would carry source-namespace beingIds for delegates the receiver
  // never sees, leaving dangling references after graft.
  const filterQualities = (qualities) => {
    if (!qualities || typeof qualities !== "object") return qualities || {};
    const out = qualities instanceof Map
      ? Object.fromEntries(qualities)
      : { ...qualities };
    if (out.beings && typeof out.beings === "object") {
      const beings = out.beings instanceof Map
        ? Object.fromEntries(out.beings)
        : { ...out.beings };
      for (const [name, entry] of Object.entries(beings)) {
        const eid = entry?.beingId;
        if (typeof eid === "string" && !capturedBeingIds.has(eid)) {
          delete beings[name];
        }
      }
      out.beings = beings;
    }
    return out;
  };

  for (const spaceId of orderedSpaceIds) {
    const slot = await loadOrFold("space", spaceId, branch);
    if (!slot) continue;
    const state = slot.state || {};
    bundle.content.spaces.push({
      sourceId:     spaceId,
      name:         state.name || null,
      type:         state.type || null,
      // parent → INSERTION_POINT if it's the scope root (its parent
      // sits outside); otherwise it's another captured space.
      parent:       spaceId === scopeSpaceId
        ? REF_INSERTION_POINT
        : tagId("space", state.parent, { uncapturedSentinel: REF_INSERTION_POINT }),
      // owner → tagged. Bundle-internal owners keep their Refs so the
      // graft remap preserves the relationship; out-of-bundle owners
      // (or I_AM) collapse to GRAFT_INITIATOR so the graft attributes
      // them to the operator.
      owner:        remapOwnerForBundle(state.owner),
      size:         state.size || null,
      coord:        state.coord || null,
      qualities:    redactSecrets(filterQualities(state.qualities)),
    });
  }

  // ── 6. Capture beings ──
  for (const beingId of capturedBeingIds) {
    const slot = await loadOrFold("being", beingId, branch);
    if (!slot) continue;
    const state = slot.state || {};
    bundle.content.beings.push({
      sourceId:      beingId,
      name:          state.name || null,
      defaultRole:   state.defaultRole || null,
      parentBeingId: tagId("being", state.parentBeingId, { uncapturedSentinel: REF_GRAFT_INITIATOR }),
      homeSpace:     tagId("space", state.homeSpace, { uncapturedSentinel: REF_INSERTION_POINT }),
      position:      tagId("space", state.position, { uncapturedSentinel: REF_INSERTION_POINT }),
      coord:         state.coord || null,
      // A clone travels over the wire / to disk for sharing — redact api
      // keys + credentials from being qualities (llmConnections, auth).
      qualities:     redactSecrets(state.qualities || {}),
    });
  }

  // ── 7. Capture matter ──
  let casRefCount = 0;
  for (const matterId of capturedMatterIds) {
    const slot = await loadOrFold("matter", matterId, branch);
    if (!slot) continue;
    const state = slot.state || {};
    if (state.content?.kind === "cas") casRefCount++;
    bundle.content.matter.push({
      sourceId:       matterId,
      name:           state.name || null,
      spaceId:        tagId("space", state.spaceId, { uncapturedSentinel: REF_INSERTION_POINT }),
      beingId:        tagId("being", state.beingId, { uncapturedSentinel: REF_GRAFT_INITIATOR }),
      parentMatterId: tagId("matter", state.parentMatterId, { uncapturedSentinel: null }),
      type:           state.type || "generic",
      content:        state.content || null,
      qualities:      redactSecrets(state.qualities || {}),
    });
  }
  // ── 7b. CAS blobs — the BYTES travel with the bundle ──
  // Every cas ref in captured matter gets its bytes inlined (base64)
  // under `casBlobs`, capped so one mp4 doesn't make every clone
  // gigantic. `casManifest` is the honest ledger: which hashes are
  // included, which were omitted (and why) — no silent truncation.
  // The graft side puts each blob through the content store and
  // verifies the recomputed hash equals the claimed hash BEFORE any
  // fact stamps; a lying blob refuses the whole graft cold.
  {
    const maxBlobBytes  = Number(opts.maxCasBlobBytes)  > 0 ? Number(opts.maxCasBlobBytes)  : 8 * 1024 * 1024;
    const maxTotalBytes = Number(opts.maxCasTotalBytes) > 0 ? Number(opts.maxCasTotalBytes) : 32 * 1024 * 1024;
    const wanted = new Map(); // hash → size
    for (const m of bundle.content.matter) {
      const c = m.content;
      if (c && typeof c === "object" && c.kind === "cas" && c.hash && !c.purged) {
        wanted.set(c.hash, typeof c.size === "number" ? c.size : null);
      }
    }
    bundle.casBlobs = {};
    bundle.casManifest = { included: [], omitted: [] };
    if (wanted.size > 0) {
      const { getContent } = await import("../matter/contentStore.js");
      let total = 0;
      for (const [hash, size] of wanted) {
        try {
          const buf = await getContent(hash);
          if (!buf) {
            bundle.casManifest.omitted.push({ hash, reason: "bytes not in local store" });
            continue;
          }
          if (buf.length > maxBlobBytes) {
            bundle.casManifest.omitted.push({ hash, size: buf.length, reason: `exceeds per-blob cap ${maxBlobBytes}` });
            continue;
          }
          if (total + buf.length > maxTotalBytes) {
            bundle.casManifest.omitted.push({ hash, size: buf.length, reason: `bundle cas budget ${maxTotalBytes} exhausted` });
            continue;
          }
          bundle.casBlobs[hash] = buf.toString("base64");
          bundle.casManifest.included.push({ hash, size: buf.length });
          total += buf.length;
        } catch (err) {
          bundle.casManifest.omitted.push({ hash, reason: err?.message || "read failed" });
        }
      }
      const { default: log } = await import("../../seedReality/log.js");
      if (bundle.casManifest.omitted.length > 0) {
        log.warn(
          "Clone",
          `casBlobs: ${bundle.casManifest.included.length}/${wanted.size} blob(s) travel; ` +
          `${bundle.casManifest.omitted.length} omitted — their refs graft but the bytes ` +
          `stay unresolvable until fetched (federation hash-fetch follow-up). ` +
          `Omissions: ${bundle.casManifest.omitted.map((o) => `${o.hash.slice(0, 12)}(${o.reason})`).join("; ")}`,
        );
      } else {
        log.info("Clone", `casBlobs: all ${wanted.size} content blob(s) travel with the bundle`);
      }
    }
  }

  // ── 8. Manifest — what the receiver must have for this clone to
  // function. Two derivations:
  //
  //   roles      — every role the captured beings reference
  //                (defaultRole, roleFlow clauses, granted roles).
  //                The graft side verifies they resolve.
  //   extensions — the owning extension of each referenced role
  //                (registry `origin`), plus any qualities namespace
  //                on captured aggregates that matches a loaded
  //                extension's name (extension-owned data riding the
  //                aggregates). Grafting without these loaded leaves
  //                beings that can't wake and data nothing consumes,
  //                so graft refuses when they're missing.
  const roleNames = new Set();
  for (const b of bundle.content.beings) {
    if (b.defaultRole) roleNames.add(String(b.defaultRole));
    const flow = b.qualities?.roleFlow;
    if (Array.isArray(flow)) {
      for (const clause of flow) {
        if (clause?.role) roleNames.add(String(clause.role));
      }
    }
    const granted = b.qualities?.rolesGranted;
    if (Array.isArray(granted)) {
      for (const g of granted) {
        if (g?.role) roleNames.add(String(g.role));
      }
    }
  }
  const extNames = new Set();
  try {
    const { getRole } = await import("../../present/roles/registry.js");
    for (const name of roleNames) {
      const origin = getRole(name)?.origin;
      if (origin && origin !== "seed" && origin !== "live") extNames.add(origin);
    }
  } catch { /* registry unavailable in standalone tools; roles list still travels */ }
  try {
    const { getLoadedExtensionNames } = await import("../../../extensions/loader.js");
    const loadedExt = new Set(getLoadedExtensionNames());
    const sweep = (qualities) => {
      if (!qualities || typeof qualities !== "object") return;
      for (const ns of Object.keys(qualities)) {
        if (loadedExt.has(ns)) extNames.add(ns);
      }
    };
    for (const s of bundle.content.spaces) sweep(s.qualities);
    for (const b of bundle.content.beings) sweep(b.qualities);
    for (const m of bundle.content.matter) sweep(m.qualities);
  } catch { /* loader absent (headless capture); role-origin derivation above still ran */ }
  bundle.manifest.roles = [...roleNames].sort();
  bundle.manifest.extensions = [...extNames].sort();

  // ── 9. Stamp completion meta + the bundle's own identity ──
  bundle.meta.createdAt = new Date().toISOString();

  // The bundle hash: one digest over everything semantic — manifest,
  // parameters, content, and the casManifest LEDGER (the blob bytes
  // verify individually by their own hashes; hashing the ledger means
  // omitting or substituting a blob still breaks the bundle hash).
  // This is the offer-to-delivery integrity anchor: federation offers
  // carry it in the manifest, deliver-bundle verifies the delivered
  // bundle recomputes it, graft refuses cold on mismatch. A clone's
  // identity IS its hash — same doctrine as facts and matter bytes.
  bundle.meta.bundleHash = await computeBundleHash(bundle);

  // The PUBKEY half: sign the bundle's identity (bundleHash) with the
  // producer's key, so a receiver proves WHO vouches for this snapshot
  // self-certifyingly, with no callback home. Unsigned when the operator
  // has no available key (e.g. a locked human signing session) — the
  // bundle still travels and is accepted under the transport sig.
  {
    const { signBundle } = await import("./bundleSig.js");
    await signBundle(bundle, opts.operatorBeingId || null, opts.branch || "0");
  }

  return bundle;
}

/**
 * Recompute a clone bundle's content hash. Pure — both sides of a
 * transfer call this: capture stamps it into meta, graft verifies
 * the received bundle reproduces it. Covers manifest + parameters +
 * content + casManifest + the identifying meta (source reality /
 * branch / scope, createdAt). Excludes casBlobs bytes (each blob is
 * verified against its own hash at put time) and bundleHash itself.
 */
export async function computeBundleHash(bundle) {
  const crypto = await import("crypto");
  const { canonicalize } = await import("../../past/fact/hash.js");
  const body = canonicalize({
    bundleVersion: bundle.meta?.bundleVersion ?? bundle.bundleVersion ?? null,
    sourceReality: bundle.meta?.sourceReality ?? null,
    sourceBranch:  bundle.meta?.sourceBranch ?? null,
    sourceScopeSpaceId: bundle.meta?.sourceScopeSpaceId ?? null,
    sourceScopeName:    bundle.meta?.sourceScopeName ?? null,
    createdAt:     bundle.meta?.createdAt ?? null,
    manifest:      bundle.manifest ?? null,
    parameters:    bundle.parameters ?? null,
    content:       bundle.content ?? null,
    casManifest:   bundle.casManifest ?? null,
  });
  return crypto.createHash("sha256").update(body).digest("hex");
}
