// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// birth.js — minting Being rows.
//
// A being IS its identity row. This file holds the single primitive
// that creates that row:
//
//   birthBeing             — validate, authorize, hash, stamp the
//                            be:birth Fact via emitFact. Returns the
//                            new being's id + name (and a pending
//                            view) when inside a moment; the fully
//                            materialized row when standalone.
//   generateUniqueName     — `<role><suffix>` retry pattern scaffolds
//                            use to auto-name AI beings whose role
//                            spec doesn't fix one.
//
// HOME SEPARATION (locked 2026-06-04): birthBeing requires `homeId`
// (an existing space) and `parentBeingId`. Callers that want a fresh
// child home for the new being create the space FIRST via
// do:create-space, then call birthBeing with the new space's id. Both
// facts join the same `summonCtx.deltaF` and seal atomically — the
// composition of two verbs (DO + BE), rather than a hidden second
// emission inside birth. Real-world analog: you build the room before
// you have the baby, not at the same time.
//
// The earlier `createBeingWithHome` orchestrator + `createBeing` /
// `createFirstBeing` aliases retired in this collapse. Three call
// sites that used `homeParent` (cherub register's first user +
// subsequent users; the BE wire handler for registration via @birther)
// now inline the create-space step themselves. Post-birth setup that
// also used to live inside `createBeingWithHome` (rootOwner on human
// home territories; qualities.beings registration on shared homes
// for non-humans; optional scaffolding callbacks) is the caller's
// responsibility — different callers want different shapes and
// pretending one helper covered them all hid those choices.
//
// Validation lives here because it's only called from this file.

import { escapeRegex } from "../../../utils.js";
import { IBP_ERR, IbpError } from "../../../ibp/protocol.js";
import log from "../../../seedReality/log.js";
import { emitFact } from "../../../past/fact/facts.js";
import { mintCredentialSpec, encryptCredential } from "./credentials.js";
import { generateBeingKeypair } from "./beingKeys.js";
import { I_AM } from "../seedBeings.js";
import { getRealityDomain } from "../../../ibp/address.js";

// ─────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────

const BEING_NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

function validateName(name) {
  if (!name || typeof name !== "string")
    throw new IbpError(IBP_ERR.INVALID_INPUT, "Name is required");
  const trimmed = name.trim();
  if (!BEING_NAME_RE.test(trimmed)) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "Name may only contain letters, numbers, hyphens, and underscores (1-32 chars)");
  }
  return trimmed;
}

// Validates a caller-supplied plaintext password. Null/undefined is
// permitted (the auto-generate path); only an actually-provided value
// is range-checked.
function validatePassword(password) {
  if (password === null || password === undefined) return;
  if (typeof password !== "string")
    throw new IbpError(IBP_ERR.INVALID_INPUT, "Password must be a string");
  if (password.length < MIN_PASSWORD)
    throw new IbpError(IBP_ERR.INVALID_INPUT, `Password must be at least ${MIN_PASSWORD} characters`);
  if (password.length > MAX_PASSWORD)
    throw new IbpError(IBP_ERR.INVALID_INPUT, `Password must be ${MAX_PASSWORD} characters or fewer`);
}

// Resolve an imported key into the full keypair. Two skins accepted:
// the exported PKCS8 PEM, or its 24-word BIP39 paper form (both come
// out of the key-export op). Same key, same beingId, deterministically.
async function resolveImportedKeypair(importKey, name) {
  if (typeof importKey !== "string" || !importKey.trim()) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, `birthBeing("${name}"): importKey must be a non-empty string`);
  }
  const text = importKey.trim();
  try {
    if (text.includes("PRIVATE KEY")) {
      const { keypairFromPrivateKeyPem } = await import("./beingKeys.js");
      return keypairFromPrivateKeyPem(text);
    }
    const { mnemonicToEntropy } = await import("./mnemonic.js");
    const { keypairFromSeed } = await import("./beingKeys.js");
    return keypairFromSeed(mnemonicToEntropy(text));
  } catch (err) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `birthBeing("${name}"): importKey is neither a valid ed25519 private-key PEM ` +
        `nor a valid 24-word recovery phrase (${err.message})`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// BIRTH
// ─────────────────────────────────────────────────────────────────────

/**
 * Mint a new Being. Stamps one be:birth Fact carrying the full spec
 * on the new being's reel; the new being is its own actor (single-
 * writer doctrine). Returns the new being's id + name and a pending-
 * view of the spec.
 *
 * When inside a moment (`summonCtx` threaded), the Fact joins
 * `summonCtx.deltaF` and commits atomically with the rest of the
 * moment at sealAct. When standalone, emitFact's singleton path
 * commits immediately.
 *
 * REQUIRED:
 *   spec.name           Being name (1-32 chars, [A-Za-z0-9_-])
 *   spec.parentBeingId  Who birthed this being. The being-tree is
 *                       rooted at the I-Am; every other being chains
 *                       back through its parent. Genesis (the I-Am
 *                       itself) bypasses this file and stamps its own
 *                       be:birth from sprout.ensureIAm.
 *   spec.homeId         The existing space this being calls home.
 *                       Create the space FIRST (do:create-space) if
 *                       you want a fresh one — birth doesn't build
 *                       homes. The home must either be already in
 *                       Mongo OR pending earlier in this moment's ΔF.
 *
 * OPTIONAL:
 *   spec.birthHere      bool (default false). Where to place this
 *                       being right now:
 *                         false → position = homeId (default; the
 *                                 being appears at its own home)
 *                         true  → position = the parent's current
 *                                 position (the being appears next
 *                                 to whoever birthed it; useful for
 *                                 spawning a companion right beside
 *                                 you rather than at their home)
 *   spec.password       Plaintext. Null/undefined → auto-generated and
 *                       stored encrypted at qualities.auth.credentialPlain
 *                       so the being / its being parent can retrieve later.
 *                       Explicit → bcrypt-hashed only; the chooser
 *                       carries the plaintext.
 *   spec.cognition      "llm" (default) | "human" | "scripted".
 *   spec.role           Birth role. Alias for spec.defaultRole; either
 *                       lands on Being.defaultRole. Non-human beings
 *                       MUST declare one (no LLM/scripted being can
 *                       wake without a fallback voice).
 *   spec.defaultRole    Same as spec.role.
 *   spec.coord          { x, y, z? } explicit grid coord. When absent,
 *                       birth picks a random in-bounds coord inside
 *                       the position space's size (falls through to
 *                       no coord when the space has no size — the
 *                       portal's hash-ring fallback handles that).
 *   spec.roleFlow       Initial roleFlow clauses; land at
 *                       qualities.roleFlow so the very first moment-
 *                       assign honors them.
 *   spec.qualities      Additional initial qualities. Deep-merged
 *                       with the auth + cognition + roleFlow seeds.
 *   spec.isRemote       For mirror-only beings (default false).
 *   spec.homeReality    URL of the reality where this being's
 *                       authoritative row lives (default null).
 *   spec.llmDefault     Per-being LLM connection key (default null).
 *   spec.father         { reality, beingId } | null. Recorded on the
 *                       child as qualities.father. The verified
 *                       identity tuple of a being from another world
 *                       who commissioned this birth via summon:mate
 *                       acceptance. Carries ONE structural right:
 *                       BE:connect eligibility (vessel right). NOT
 *                       in the identity chain; NOT authority over
 *                       the child. Null for solo births. See
 *                       seed/CROSS-WORLD.md + protocols/ibp/FEDERATION.md.
 *
 * @param {object} args
 * @param {object} args.spec         see fields above
 * @param {object} args.identity     { name, beingId } of the caller
 *                                   (must satisfy authorize against
 *                                   spec.homeId for verb=be op=create-being)
 * @param {object} [args.summonCtx]  the moment's context. Required for
 *                                   runtime calls; genesis-sequence
 *                                   callers (ensureSeedDelegates) pass
 *                                   their per-delegate withIAmAct ctx;
 *                                   standalone tools (migrations) pass
 *                                   null and accept immediate-commit
 *                                   semantics.
 * @param {string} [args.branch]     the branch this birth lands on, as
 *                                   resolved by the calling verb at its
 *                                   perimeter (resolveBranchForFact).
 *                                   One law, one resolution: verbs
 *                                   resolve, primitives receive. When
 *                                   absent, falls back to the moment's
 *                                   actorAct.branch (in-moment
 *                                   primitive callers), then main
 *                                   (standalone scaffold callers).
 *
 * @returns {Promise<{status, beingId, name, being}>} where `being` is
 *   either the pending-view (in-moment) or the materialized row
 *   (standalone).
 */
export async function birthBeing({ spec, identity, summonCtx = null, branch = null }) {
  if (!spec || typeof spec !== "object") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "birthBeing requires spec object");
  }

  // Accept bare-string identity shorthand (typically `I_AM` for
  // seed-internal births). normalizeIdentity returns the object shape
  // downstream code expects to read identity.beingId / identity.name.
  const { normalizeIdentity } = await import("../../../ibp/verbs/_shared.js");
  identity = normalizeIdentity(identity);

  // ── Required fields ──
  const name = validateName(spec.name);
  validatePassword(spec.password);

  const parentBeingId = spec.parentBeingId || null;
  if (!parentBeingId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `birthBeing("${name}"): spec.parentBeingId is required. The being-tree ` +
        `is rooted at the I-Am; every other being chains back through its ` +
        `parent. Pass identity.beingId or iAm._id. ` +
        `Genesis (I_AM itself) bypasses this file and stamps its own be:birth ` +
        `from ensureIAm.`,
    );
  }

  const homeId = spec.homeId || null;
  if (!homeId) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `birthBeing("${name}"): spec.homeId is required. The being's home is ` +
        `an existing space (or one created earlier in the same moment's ΔF). ` +
        `Real-world analog: build the room before you have the baby.`,
    );
  }

  const cognition = spec.cognition || "llm";
  if (cognition !== "human" && cognition !== "llm" && cognition !== "scripted") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `birthBeing("${name}"): cognition must be "llm" | "human" | "scripted" (got "${cognition}")`,
    );
  }

  // Non-human beings must declare a role at birth (their cognition
  // wakes through a role's fallback voice; humans cognize out-of-band).
  let defaultRole = spec.defaultRole || spec.role || null;
  if (!defaultRole && Array.isArray(spec.roles) && spec.roles.length > 0) {
    defaultRole = spec.roles[0];
  }
  if (cognition !== "human" && !defaultRole) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `birthBeing("${name}"): non-human beings require spec.role or spec.defaultRole`,
    );
  }

  // Branch resolution. The calling verb resolves the branch once at
  // its perimeter and passes it down; re-deriving here would be a
  // second resolution law that can disagree with the verb's (it did:
  // a branch-qualified birth address resolved one way in beVerb and
  // another way here). actorAct covers in-moment primitive callers
  // (cherub's handlers, withIAmAct delegates); the main tail covers
  // standalone scaffold callers only.
  branch = branch || summonCtx?.actorAct?.branch || "0";

  // No inline authorize call. `birthBeing` is a substrate primitive
  // called from already-authorized contexts:
  //   - The wire BE handler (verbs/be.js) gates `be:birth` at the wire
  //     and enforces the cherub-arrival vs birther-authenticated split
  //     inline before reaching this function.
  //   - Cherub's role.js calls this from within its authorized flow.
  //   - seedDelegates calls this at boot under the I_AM identity (the
  //     I_AM short-circuit covers it).
  // Re-authorizing here with a synthetic `be:create-being` operation
  // name was a defense-in-depth gate that polluted the BE namespace
  // with a non-protocol operation (BE dispatches only birth / connect /
  // release). The protections come from the authorized callers; this
  // primitive enforces state-consistency invariants below, not auth.
  // See seed/RolesAreAuth.md "Permissions vs invariants."

  // ── Parent exists (or is pending in this moment) ──
  // The being-tree's chain of causation needs every link to resolve.
  // loadOrFold walks the parent's lineage so a branch-side birth finds
  // a parent who lives in main; the deltaF check covers atomic births
  // where the parent's be:birth is earlier in the same ΔF.
  const { loadOrFold, findByName, findByNamePattern } = await import("../../projections.js");
  const parentSlot = await loadOrFold("being", parentBeingId, branch);
  if (!parentSlot) {
    const parentPending = summonCtx?.deltaF?.find(
      (f) =>
        f?.verb === "be" &&
        f?.action === "birth" &&
        f?.target?.kind === "being" &&
        String(f?.target?.id) === String(parentBeingId),
    );
    if (!parentPending) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `birthBeing("${name}"): parentBeingId "${String(parentBeingId).slice(0, 8)}" does not ` +
          `resolve to an existing being and is not pending earlier in this ` +
          `moment's ΔF. The being-tree would have a dangling reference.`,
      );
    }
  }

  // ── Home space exists (or is pending in this moment) ──
  // Same shape: an in-moment do:create-space for homeId is legitimate
  // because both facts commit in the same transaction.
  const homeSlot = await loadOrFold("space", homeId, branch);
  let pendingHomeSize = null;
  if (!homeSlot) {
    const homePending = summonCtx?.deltaF?.find(
      (f) =>
        f?.verb === "do" &&
        f?.action === "create-space" &&
        f?.target?.kind === "space" &&
        String(f?.target?.id) === String(homeId),
    );
    if (!homePending) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `birthBeing("${name}"): homeId "${String(homeId).slice(0, 8)}" does not resolve ` +
          `to an existing space and is not pending earlier in this moment's ΔF. ` +
          `Create the home space first (do:create-space) before birthing the being.`,
      );
    }
    pendingHomeSize = homePending?.params?.size ?? null;
  }

  // ── Name uniqueness (branch-view aware) ──
  // Two checks. The pattern query catches case-variant collisions on
  // the birth branch's own slots. findByName then catches inherited
  // collisions: the branch's VIEW includes lineage aggregates whose
  // slots were never lazily folded here, and a name that resolves in
  // the view is taken even though no branch-local slot carries it.
  // (findByName is exact-case; an inherited case-variant can slip
  // through — acceptable until the name index is materialized
  // per-branch.)
  const existingByName = await findByNamePattern(
    "being",
    new RegExp(`^${escapeRegex(name)}$`, "i"),
    branch,
  );
  if (existingByName.length > 0) {
    throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Name already taken");
  }
  const inheritedByName = await findByName("being", name, branch);
  if (inheritedByName) {
    throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Name already taken");
  }

  // ── Resolve position ──
  // birthHere=false (default): the being appears at their own home.
  // birthHere=true: the being appears next to the parent (parent's
  //   current position) — useful for spawning a companion right beside
  //   you. Reads the parent's projection slot for the live position.
  //
  let position = homeId;
  if (spec.birthHere === true) {
    const parentPositionId = parentSlot?.state?.position || parentSlot?.position || null;
    if (!parentPositionId) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `birthBeing("${name}"): birthHere=true but parent has no current position. ` +
          `The parent must be placed somewhere for "next to me" to mean anything.`,
      );
    }
    position = parentPositionId;
  }

  // ── Resolve coord (random in-bounds inside position space's size) ──
  const positionId = position;
  let resolvedCoord = spec.coord || null;
  if (!resolvedCoord && positionId) {
    try {
      let size = null;
      // If position is the freshly-pending home, read its size from
      // the pending create-space fact's spec. Otherwise load the
      // space's projection.
      if (positionId === homeId && pendingHomeSize) {
        size = pendingHomeSize;
      } else {
        const posSlot = await loadOrFold("space", positionId, branch);
        size = posSlot?.state?.size || null;
        if (!size) {
          const posPending = summonCtx?.deltaF?.find(
            (f) =>
              f?.verb === "do" &&
              f?.action === "create-space" &&
              f?.target?.kind === "space" &&
              String(f?.target?.id) === positionId,
          );
          size = posPending?.params?.size || null;
        }
      }
      if (size && Number.isFinite(size.x) && Number.isFinite(size.y) &&
          size.x > 0 && size.y > 0) {
        resolvedCoord = {
          x: Math.floor(Math.random() * size.x),
          y: Math.floor(Math.random() * size.y),
        };
      }
    } catch { /* defensive: any lookup failure leaves coord null */ }
  }

  // ── Identity keypair (the being is a wallet) ──
  // beingId IS the public key; the private key signs the being's acts.
  // The reality holds it encrypted (custodial, qualities.auth.privateKeyEnc)
  // and the owner can export it (the key-export op). I_AM is the one
  // exception (ensureIAm in sprout.js): its id is the literal "i-am" and
  // its signing key is the reality key. Every other being, including the
  // seed delegates, gets its own independent keypair here.
  //
  // IMPORT: a caller holding an exported key (the PEM, or its 24-word
  // paper form) births the being WITH that identity instead of a fresh
  // one — recovery, and moving your identity onto a reality you
  // control. Same id, because the id IS the key. Refused when the id
  // already lives here (that being exists; connect to it instead).
  // spec.importKey never reaches the fact: the wire layer holds it in
  // the secret stash and this file puts only the ENCRYPTED key into
  // qualities.
  let keypair;
  if (spec.importKey) {
    keypair = await resolveImportedKeypair(spec.importKey, name);
    const { loadOrFold } = await import("../../projections.js");
    const existing = await loadOrFold("being", keypair.beingId, branch).catch(() => null);
    if (existing) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `birthBeing("${name}"): this identity (${keypair.beingId.slice(0, 12)}…) ` +
          `already lives on this reality — BE:connect to it instead of importing`,
      );
    }
  } else {
    keypair = generateBeingKeypair();
  }
  const id = keypair.beingId;

  // ── Credentials ──
  const credential = await mintCredentialSpec(spec.password || null);

  // ── Qualities ──
  // Caller-provided initial qualities deep-merge with the seeds
  // (auth.credentialPlain, auth.privateKeyEnc, cognition.defaultKind,
  // optional roleFlow).
  const qualities = (spec.qualities && typeof spec.qualities === "object")
    ? { ...spec.qualities }
    : {};
  qualities.auth = {
    ...(qualities.auth || {}),
    privateKeyEnc: encryptCredential(keypair.privateKeyPem),
  };
  if (credential.plain) {
    qualities.auth.credentialPlain = credential.plain;
  }
  qualities.cognition = { ...(qualities.cognition || {}), defaultKind: cognition };
  if (Array.isArray(spec.roleFlow)) {
    qualities.roleFlow = spec.roleFlow;
  }

  // Cross-world citizenship: father tuple. Only when present (mate-
  // accepted birth, recorded on the child's qualities for the
  // BE:connect father-admit check downstream). Shape:
  // { reality: <foreign domain>, beingId: <foreign being id> }.
  // The mother (actor of be:birth) is the spec's parent; the father
  // (the summoner of summon:mate) is recorded here as a separate
  // tuple so it doesn't blur the identity chain. See FEDERATION.md.
  if (spec.father && typeof spec.father === "object") {
    if (
      typeof spec.father.reality !== "string" ||
      !spec.father.reality.length ||
      typeof spec.father.beingId !== "string" ||
      !spec.father.beingId.length
    ) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `birthBeing("${name}"): spec.father must be { reality: string, beingId: string }`,
      );
    }
    qualities.father = {
      reality: spec.father.reality,
      beingId: spec.father.beingId,
    };
  }

  // ── Stamp the be:birth Fact ──
  // SINGLE-WRITER: the Fact lands on the new being's reel with the
  // new being as its own actor. The lineage record (parentBeingId)
  // lives inside this fact's spec; findBeingParent walks the pointer
  // (no separate being-parent-side audit fact).
  //
  // parentBeingId in the stamped fact is the Ref (typed identity
  const factSpec = {
    name,
    password: credential.hash,
    defaultRole,
    parentBeingId,
    homeSpace: homeId,
    // Key scheme descriptor for cross-reality importers and rotation.
    // The public key IS target.id, so the raw key is not duplicated here.
    identity: { alg: "ed25519", keyEnc: "did:key:ed25519-multibase", v: 1 },
    // The being's home branch = the stamper's branch (the branch THIS
    // be:birth fact is being stamped on). Everything is relative: a
    // being birthed on #7a owns #7a as their present; BE:connect/
    // release/birth all seat the session to this.
    //
    // Read from the stamper's `branch` directly, NOT derived from
    // parentBeingId. The mother (parentBeingId, the actor of birth) is
    // always on this branch — her moment IS this moment. But the
    // father (qualities.father, when set) may live on a different
    // branch or a different reality entirely (cross-world mate-vessel
    // pattern). Deriving from "a parent" introduces ambiguity that
    // doesn't exist when we read from the one source that's always
    // authoritative — the branch this fact is landing on.
    homeBranch: branch,
    position,
    ...(resolvedCoord ? { coord: resolvedCoord } : {}),
    // Optional traits ride the fact only when SET. The reducer
    // (applyCreateBeing) defaults absent llmDefault → null,
    // isRemote → false, homeReality → null, so omission folds
    // identically and the chain stops carrying null/false noise on
    // every plain birth.
    ...(spec.llmDefault ? { llmDefault: spec.llmDefault } : {}),
    ...(spec.isRemote ? { isRemote: true } : {}),
    ...(spec.homeReality ? { homeReality: spec.homeReality } : {}),
    qualities,
  };

  try {
    await emitFact({
      verb:    "be",
      action:  "birth",
      beingId: id,
      target:  { kind: "being", id },
      params:  factSpec,
      actId:   summonCtx?.actId || null,
      branch,
    }, summonCtx);
  } catch (err) {
    if (err.code === 11000) {
      throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Name already taken");
    }
    throw err;
  }

  // ── Inherit role grants from both parents (dual-parent doctrine) ──
  //
  // The child auto-inherits every grant on the mother (parentBeingId
  // = the actor of be:birth) AND every grant on a same-reality father
  // (spec.father.reality === local). Each inherited grant is a fresh
  // grant fact on the child's reel, anchored at the same
  // anchorSpaceId / anchorBeingId as the parent's grant, with the
  // parent recorded as the grantor.
  //
  // Cross-reality fathers do NOT contribute role inheritance — we
  // can't read the foreign reality's projection synchronously. They
  // still get the connect-eligibility marker via qualities.father
  // (above). Same-reality fathers contribute roles AND get the marker.
  //
  // Self-birth (mother = self) and bootstrap births where the parent
  // has no grants yet are no-ops on this pass — no grants to inherit.
  // See seed/done/DualBeingParents for the doctrine.
  await _inheritParentRoles({
    childId: id,
    motherBeingId: parentBeingId,
    fatherBeingId: spec.father?.reality === getRealityDomain() ? spec.father?.beingId : null,
    summonCtx,
    branch,
  });

  // ── Anoint with the global role ──
  //
  // Per seed/RolesAreAuth.md "Single gate doctrine": the role-walk is
  // the only gate. For a being to do ANYTHING — including petition for
  // additional roles via ask-role / take-role — they must hold a role
  // that permits it. `global` is the universal baseline: every being
  // born into this reality gets it at the reality root with default
  // reach (host + descendants = reality-wide). Parent-inheritance above
  // already covers most paths; this stamps an UNCONDITIONAL global
  // grant so even bootstrap-case beings (parent = I-Am, no grants to
  // inherit) hold their petition surface.
  //
  // Idempotent at the reducer: a second global grant with the same
  // anchor + grantor folds as a duplicate and doesn't bloat
  // rolesGranted. Cherub's explicit registration-time grant of global
  // becomes the redundant-but-harmless case after this line.
  // @public is the structural placeholder being that never acts. Grants
  // on it are noise; skip the anoint. Every other being (including
  // seed delegates) gets global as their universal baseline.
  if (name !== "public") {
    await _anointGlobal({
      childId: id,
      branch,
      summonCtx,
    });
  }

  // In-moment: the row materializes at seal. Return the pending view
  // so callers can use the id + spec fields immediately.
  if (summonCtx) {
    return {
      status:  "created",
      beingId: id,
      name,
      being:   { _id: id, ...factSpec, _pending: true },
    };
  }

  // Standalone: emitFact's singleton path already committed. Read
  // back the materialized row so callers get the full shape including
  // any reducer-derived fields.
  const { loadProjection } = await import("../../projections.js");
  const slot = await loadProjection("being", id, branch);
  return {
    status:  "created",
    beingId: id,
    name,
    being:   slot ? { _id: slot.id, ...slot.state } : { _id: id, ...factSpec },
  };
}

// ─────────────────────────────────────────────────────────────────────
// PARENT ROLE INHERITANCE
// ─────────────────────────────────────────────────────────────────────

/**
 * Stamp grant facts on a newly-born child that mirror both parents'
 * granted roles. Each inherited grant rides the SAME moment as the
 * be:birth (via summonCtx.deltaF) so birth + inheritance seal
 * atomically — the child either exists with both their birth and
 * their inheritance or neither.
 *
 * Same-reality only. Cross-reality fathers contribute the connect-
 * eligibility marker (qualities.father) but not role grants — the
 * foreign reality's projection isn't readable here.
 *
 * Dedup: when both parents have an identical grant
 * (same role + same anchor), only one grant fact is stamped.
 * Mother wins as grantor on ties.
 *
 * No-op when neither parent has any grants (the bootstrap case;
 * I-Am's grants are implicit via the I_AM bypass and not stored on
 * qualities.rolesGranted).
 *
 * @param {object} args
 * @param {string} args.childId
 * @param {string} args.motherBeingId       parentBeingId on the spec
 * @param {string|null} args.fatherBeingId  local beingId of same-reality father, or null
 * @param {object} args.summonCtx           in-flight moment ctx (required)
 * @param {string} args.branch
 */
async function _inheritParentRoles({ childId, motherBeingId, fatherBeingId, summonCtx, branch }) {
  // Read each parent's projection on the child's branch (loadOrFold
  // walks lineage so a sub-branch sees its effective view).
  const { loadOrFold } = await import("../../projections.js");
  const reads = await Promise.all([
    motherBeingId ? loadOrFold("being", String(motherBeingId), branch) : Promise.resolve(null),
    fatherBeingId ? loadOrFold("being", String(fatherBeingId), branch) : Promise.resolve(null),
  ]);
  const motherSlot = reads[0];
  const fatherSlot = reads[1];

  const motherGrants = _grantsFromSlot(motherSlot);
  const fatherGrants = _grantsFromSlot(fatherSlot);
  if (motherGrants.length === 0 && fatherGrants.length === 0) return;

  // Compose with mother-wins-on-tie. The dedup key includes role +
  // anchorSpaceId + anchorBeingId so a grant anchored at the same
  // place from both parents only stamps once.
  const seen = new Set();
  const composed = [];
  for (const g of motherGrants) {
    const key = _grantKey(g);
    if (seen.has(key)) continue;
    seen.add(key);
    composed.push({ grant: g, grantor: String(motherBeingId) });
  }
  for (const g of fatherGrants) {
    const key = _grantKey(g);
    if (seen.has(key)) continue;
    seen.add(key);
    composed.push({ grant: g, grantor: String(fatherBeingId) });
  }

  // Stamp one do:grant-role fact per composed entry, all riding the
  // child's reel within this same moment (no separate Acts; the
  // birth's actor stamps them in the birth's moment).
  for (const { grant, grantor } of composed) {
    await emitFact({
      verb:    "do",
      action:  "grant-role",
      beingId: grantor,
      target:  { kind: "being", id: String(childId) },
      params:  {
        role:           grant.role,
        anchorSpaceId:  grant.anchorSpaceId || null,
        anchorBeingId:  grant.anchorBeingId || null,
        grantedBy:      grantor,
        inheritedFrom:  grantor,   // forensic marker — this came from parent inheritance
      },
      actId:   summonCtx?.actId || null,
      branch,
    }, summonCtx);
  }
}

function _grantsFromSlot(slot) {
  const grants = slot?.state?.qualities?.rolesGranted;
  return Array.isArray(grants) ? grants : [];
}

function _grantKey(grant) {
  return [
    grant?.role || "",
    grant?.anchorSpaceId || "",
    grant?.anchorBeingId || "",
  ].join("|");
}

/**
 * Anoint a freshly-birthed being with the `global` role anchored at
 * the reality root. Every being gets this so the petition surface
 * (ask-role + take-role + the rest of global.canDo) is reachable
 * without parent-inheritance dependencies.
 *
 * Single-gate doctrine (seed/RolesAreAuth.md): the role-walk is the
 * only gate, so universal capabilities MUST live on a role every
 * being holds.
 */
async function _anointGlobal({ childId, branch, summonCtx }) {
  const { getSpaceRootId } = await import("../../../sprout.js");
  const { I_AM } = await import("../seedBeings.js");
  const rootId = getSpaceRootId();
  if (!rootId) return; // boot-window edge; the I-Am birth itself runs before root materializes
  await emitFact({
    verb:    "do",
    action:  "grant-role",
    beingId: I_AM,
    target:  { kind: "being", id: String(childId) },
    params:  {
      role:          "global",
      anchorSpaceId: String(rootId),
      anchorBeingId: null,
      grantedBy:     I_AM,
      grantedAt:     new Date().toISOString(),
    },
    actId:   summonCtx?.actId || null,
    branch,
  }, summonCtx);
}

// ─────────────────────────────────────────────────────────────────────
// AUTO-NAMING
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate an unused `<role><suffix>` name. Used by scaffolds (seed
 * delegates, harmony's dancer roster) that auto-name AI beings whose
 * spec doesn't fix one.
 *
 * Strategy: try sequential numeric suffixes starting at the count of
 * existing same-role beings; bump until a free slot is found. Cheap
 * because the projection collection has a name index; bounded by
 * MAX_RETRIES so a pathological state can't loop forever.
 *
 * @param {string} role          base name (e.g. "dancer")
 * @param {object} [opts]
 * @param {string} [opts.branch] branch to check against (default "0")
 * @returns {Promise<string>}    e.g. "dancer3"
 */
export async function generateUniqueName(role, opts = {}) {
  if (!role || typeof role !== "string") {
    throw new IbpError(IBP_ERR.INVALID_INPUT, "generateUniqueName requires a role string");
  }
  const safeRole = role.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeRole) {
    throw new IbpError(IBP_ERR.INVALID_INPUT, `Role "${role}" produces no safe-name prefix`);
  }
  const branch = opts.branch || "0";
  const { findByNamePattern } = await import("../../projections.js");

  const sameRolePrefix = new RegExp(`^${escapeRegex(safeRole)}[0-9]*$`, "i");
  const existing = await findByNamePattern("being", sameRolePrefix, branch);
  let n = existing.length;
  const MAX_RETRIES = 10000;
  for (let i = 0; i < MAX_RETRIES; i++) {
    const candidate = `${safeRole}${n}`;
    const collision = await findByNamePattern(
      "being",
      new RegExp(`^${escapeRegex(candidate)}$`, "i"),
      branch,
    );
    if (collision.length === 0) return candidate;
    n++;
  }
  throw new IbpError(IBP_ERR.INTERNAL, `generateUniqueName exhausted ${MAX_RETRIES} retries for role "${role}"`);
}
