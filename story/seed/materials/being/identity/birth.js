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
//   generateUniqueName     — `<able><suffix>` retry pattern scaffolds
//                            use to auto-name AI beings whose able
//                            spec doesn't fix one.
//
// HOME SEPARATION (locked 2026-06-04): birthBeing requires `homeId`
// (an existing space) and `parentBeingId`. Callers that want a fresh
// child home for the new being create the space FIRST via
// do:create-space, then call birthBeing with the new space's id. Both
// facts join the same `moment.deltaF` and seal atomically — the
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
import log from "../../../seedStory/log.js";
import { emitFact } from "../../../past/fact/facts.js";
import { mintCredentialSpec } from "./credentials.js";
import { beingContentId } from "../beingId.js";
import { I } from "../seedBeings.js";
import { getStoryDomain } from "../../../ibp/address.js";

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
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "Name may only contain letters, numbers, hyphens, and underscores (1-32 chars)",
    );
  }
  return trimmed;
}

// Validates a caller-supplied plaintext password. The password is OPTIONAL:
// null/undefined (the auto-generate path) AND "" (a form field left blank — the
// portal sends the empty string, not null) both mean "no password". Only an
// actually-provided, non-empty value is range-checked. Downstream already
// normalizes `spec.password || null`, so blank lands on the keypair-only path.
function validatePassword(password) {
  if (password === null || password === undefined || password === "") return;
  if (typeof password !== "string")
    throw new IbpError(IBP_ERR.INVALID_INPUT, "Password must be a string");
  if (password.length < MIN_PASSWORD)
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `Password must be at least ${MIN_PASSWORD} characters`,
    );
  if (password.length > MAX_PASSWORD)
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `Password must be ${MAX_PASSWORD} characters or fewer`,
    );
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
 * When inside a moment (`moment` threaded), the Fact joins
 * `moment.deltaF` and commits atomically with the rest of the
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
 *   spec.able           Birth able. Alias for spec.defaultAble; either
 *                       lands on Being.defaultAble. Non-human beings
 *                       MUST declare one (no LLM/scripted being can
 *                       wake without a fallback voice).
 *   spec.defaultAble    Same as spec.able.
 *   spec.coord          { x, y, z? } explicit grid coord. When absent,
 *                       birth picks a random in-bounds coord inside
 *                       the position space's size (falls through to
 *                       no coord when the space has no size — the
 *                       portal's hash-ring fallback handles that).
 *   spec.flow       Initial flow clauses; land at
 *                       qualities.flow so the very first moment-
 *                       assign honors them.
 *   spec.qualities      Additional initial qualities. Deep-merged
 *                       with the auth + cognition + flow seeds.
 *   spec.isRemote       For mirror-only beings (default false).
 *   spec.homeStory    URL of the story where this being's
 *                       authoritative row lives (default null).
 *   spec.father         { story, beingId } | null. Recorded on the
 *                       child as qualities.father. The verified
 *                       identity tuple of a being from another world
 *                       who commissioned this birth via summon:mate
 *                       acceptance. Carries ONE structural right:
 *                       BE:connect eligibility (being right). NOT
 *                       in the identity chain; NOT authority over
 *                       the child. Null for solo births. See
 *                       seed/CROSS-WORLD.md + protocols/ibp/FEDERATION.md.
 *
 * @param {object} args
 * @param {object} args.spec         see fields above
 * @param {object} args.identity     { name, beingId } of the caller
 *                                   (must satisfy authorize against
 *                                   spec.homeId for verb=be op=create-being)
 * @param {object} [args.moment]  the moment's context. Required for
 *                                   runtime calls; genesis-sequence
 *                                   callers (ensureSeedDelegates) pass
 *                                   their per-delegate withIAmAct ctx;
 *                                   standalone tools (migrations) pass
 *                                   null and accept immediate-commit
 *                                   semantics.
 * @param {string} [args.history]    the history this birth lands on, as
 *                                   resolved by the calling verb at its
 *                                   perimeter (resolveHistoryForFact).
 *                                   One law, one resolution: verbs
 *                                   resolve, primitives receive. When
 *                                   absent, falls back to the moment's
 *                                   actorAct.history (in-moment
 *                                   primitive callers), then main
 *                                   (standalone scaffold callers).
 *
 * @returns {Promise<{status, beingId, name, being}>} where `being` is
 *   either the pending-view (in-moment) or the materialized row
 *   (standalone).
 */
export async function birthBeing({
  spec,
  identity,
  moment = null,
  history = null,
}) {
  if (!spec || typeof spec !== "object") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "birthBeing requires spec object",
    );
  }

  // Accept bare-string identity shorthand (typically `I` for
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
        `Genesis (I itself) bypasses this file and stamps its own be:birth ` +
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
  if (
    cognition !== "human" &&
    cognition !== "llm" &&
    cognition !== "scripted"
  ) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `birthBeing("${name}"): cognition must be "llm" | "human" | "scripted" (got "${cognition}")`,
    );
  }

  // Non-human beings must declare a able at birth (their cognition
  // wakes through a able's fallback voice; humans cognize out-of-band).
  let defaultAble = spec.defaultAble || spec.able || null;
  if (!defaultAble && Array.isArray(spec.ables) && spec.ables.length > 0) {
    defaultAble = spec.ables[0];
  }
  if (cognition !== "human" && !defaultAble) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `birthBeing("${name}"): non-human beings require spec.able or spec.defaultAble`,
    );
  }

  // History resolution. The calling verb resolves the history once at
  // its perimeter and passes it down; re-deriving here would be a
  // second resolution law that can disagree with the verb's (it did:
  // a history-qualified birth address resolved one way in beVerb and
  // another way here). actorAct covers in-moment primitive callers
  // (cherub's handlers, withIAmAct delegates); the main tail covers
  // standalone scaffold callers only.
  history = history || moment?.actorAct?.history || "0";

  // No inline authorize call. `birthBeing` is a substrate primitive
  // called from already-authorized contexts:
  //   - The wire BE handler (verbs/be.js) gates `be:birth` at the wire
  //     and enforces the cherub-arrival vs birther-authenticated split
  //     inline before reaching this function.
  //   - Cherub's able.js calls this from within its authorized flow.
  //   - seedDelegates calls this at boot under the I identity (the
  //     I short-circuit covers it).
  // Re-authorizing here with a synthetic `be:create-being` operation
  // name was a defense-in-depth gate that polluted the BE namespace
  // with a non-protocol operation (BE dispatches only birth / connect /
  // release). The protections come from the authorized callers; this
  // primitive enforces state-consistency invariants below, not auth.
  // See seed/AblesAreAuth.md "Permissions vs invariants."

  // ── Parent exists (or is pending in this moment) ──
  // The being-tree's chain of causation needs every link to resolve.
  // loadOrFold walks the parent's lineage so a history-side birth finds
  // a parent who lives in main; the deltaF check covers atomic births
  // where the parent's be:birth is earlier in the same ΔF.
  const { loadOrFold, findByName, findByNamePattern } =
    await import("../../projections.js");
  const parentSlot = await loadOrFold("being", parentBeingId, history);
  const parentPending = parentSlot
    ? null
    : moment?.deltaF?.find(
        (f) =>
          f?.verb === "be" &&
          f?.act === "birth" &&
          f?.of?.kind === "being" &&
          String(f?.of?.id) === String(parentBeingId),
      );
  if (!parentSlot && !parentPending) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `birthBeing("${name}"): parentBeingId "${String(parentBeingId).slice(0, 8)}" does not ` +
        `resolve to an existing being and is not pending earlier in this ` +
        `moment's ΔF. The being-tree would have a dangling reference.`,
    );
  }

  // The being expresses the MOTHER's trueName — the name that births it
  // (parentSlot for a folded mother; the pending be:birth's spec for a
  // mother born earlier in this same ΔF). No fallback: a mother with no
  // trueName is a wiring gap to SEE, not to paper over.
  const motherTrueName = parentSlot
    ? parentSlot.state?.trueName
    : parentPending?.params?.trueName;
  if (!motherTrueName) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `birthBeing("${name}"): the mother (parentBeingId ` +
        `"${String(parentBeingId).slice(0, 8)}") carries no trueName; a being ` +
        `must express the name that births it.`,
    );
  }

  // BIRTH-GATE (inheritation). You may attach a child under a being-tree
  // position only where you have authority over it. Three cases are
  // inherently allowed and skip the walk:
  //   • root admission   (parent = I) — how new top-level beings enter;
  //                       WHO may do this is gated at the SUMMON/BE layer
  //                       (cherub's arrival able), not by the being-tree.
  //   • self-birth       (parent = the minter) — a being births its own
  //                       children; self-authority is implicit.
  //   • pending parent   (mother born earlier in this same ΔF) — an atomic
  //                       seed-internal multi-birth; inherently trusted.
  // For a birth under ANY OTHER position, the MINTER's Name (the identity
  // performing the birth, not the child's owner) must cover the parent —
  // own it or an ancestor, or hold an inheritation point on it. This is
  // what stops a Name grafting a child under a subtree it doesn't control.
  {
    const minterBeingId = identity?.beingId ? String(identity.beingId) : null;
    const isIAmMinter = minterBeingId === String(I) || identity?.name === I;
    const underRoot = String(parentBeingId) === String(I);
    const underSelf = minterBeingId && String(parentBeingId) === minterBeingId;
    if (!isIAmMinter && !underRoot && !underSelf && !parentPending) {
      let gateHistory = history;
      if (!gateHistory) {
        const { getDefaultHistory } =
          await import("../../history/historyRegistry.js");
        gateHistory = await getDefaultHistory();
      }
      // The minter's Name: its nameId if the act carried one, else the
      // minter being's trueName.
      let minterName = identity?.nameId ? String(identity.nameId) : null;
      if (!minterName && minterBeingId) {
        const { loadProjection } = await import("../../projections.js");
        const minterSlot = await loadProjection(
          "being",
          minterBeingId,
          gateHistory,
        );
        minterName = minterSlot?.state?.trueName
          ? String(minterSlot.state.trueName)
          : null;
      }
      const { hasAuthorityOver } = await import("./inheritation.js");
      const covered = minterName
        ? await hasAuthorityOver(minterName, String(parentBeingId), gateHistory)
        : false;
      if (!covered) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          `birthBeing("${name}"): the minting Name has no authority over parent ` +
            `position "${String(parentBeingId).slice(0, 8)}" — you may only birth under a ` +
            `position you own or hold an inheritation point on.`,
        );
      }
    }
  }

  // SOVEREIGN OVERRIDE. By default a being expresses the MOTHER's trueName
  // (a being of the one that birthed it). An EXPLICIT spec.trueName makes the
  // being the NAMED's OWN instead — sovereign, owned directly by that Name.
  // This is how a name births its FIRST being through cherub (summon:mate):
  // the child's trueName = the summoner's NAME, so the name owns it and
  // be:connects passwordless (owned). The named Name must be declared here and
  // not banished. (FORK 1: "birth takes an explicit trueName for sovereign
  // beings, overriding the mother's-name default.")
  let effectiveTrueName = motherTrueName;
  if (spec.trueName && String(spec.trueName) !== String(motherTrueName)) {
    const { loadProjection } = await import("../../projections.js");
    const nameSlot = await loadProjection("name", String(spec.trueName), "0");
    if (!nameSlot?.state) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `birthBeing("${name}"): explicit trueName "${String(spec.trueName).slice(0, 12)}…" ` +
          `is not a declared Name on this story.`,
      );
    }
    const { isNameBanished } = await import("../../name/closure.js");
    if (await isNameBanished(String(spec.trueName))) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `birthBeing("${name}"): trueName "${String(spec.trueName).slice(0, 12)}…" is banished.`,
      );
    }
    effectiveTrueName = String(spec.trueName);
  }

  // ── Home space exists (or is pending in this moment) ──
  // Same shape: an in-moment do:create-space for homeId is legitimate
  // because both facts commit in the same transaction.
  const homeSlot = await loadOrFold("space", homeId, history);
  let pendingHomeSize = null;
  if (!homeSlot) {
    const homePending = moment?.deltaF?.find(
      (f) =>
        f?.verb === "do" &&
        f?.act === "create-space" &&
        f?.of?.kind === "space" &&
        String(f?.of?.id) === String(homeId),
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

  // ── Name uniqueness (history-view aware) ──
  // Two checks. The pattern query catches case-variant collisions on
  // the birth history's own slots. findByName then catches inherited
  // collisions: the history's VIEW includes lineage aggregates whose
  // slots were never lazily folded here, and a name that resolves in
  // the view is taken even though no history-local slot carries it.
  // (findByName is exact-case; an inherited case-variant can slip
  // through — acceptable until the name index is materialized
  // per-history.)
  const existingByName = await findByNamePattern(
    "being",
    new RegExp(`^${escapeRegex(name)}$`, "i"),
    history,
  );
  if (existingByName.length > 0) {
    throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Name already taken");
  }
  const inheritedByName = await findByName("being", name, history);
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
    const parentPositionId =
      parentSlot?.state?.position || parentSlot?.position || null;
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
        const posSlot = await loadOrFold("space", positionId, history);
        size = posSlot?.state?.size || null;
        if (!size) {
          const posPending = moment?.deltaF?.find(
            (f) =>
              f?.verb === "do" &&
              f?.act === "create-space" &&
              f?.of?.kind === "space" &&
              String(f?.of?.id) === positionId,
          );
          size = posPending?.params?.size || null;
        }
      }
      if (
        size &&
        Number.isFinite(size.x) &&
        Number.isFinite(size.y) &&
        size.x > 0 &&
        size.y > 0
      ) {
        resolvedCoord = {
          x: Math.floor(Math.random() * size.x),
          y: Math.floor(Math.random() * size.y),
        };
      }
    } catch {
      /* defensive: any lookup failure leaves coord null */
    }
  }

  // ── Identity belongs to the NAME, not the being ──
  // A being holds NO key. Its _id is the CAS hash of its birth (computed
  // below from the finalized spec, the same way matter's id is content-
  // addressed); the NAME it expresses (trueName) is the keypair that signs
  // its acts. Importing an identity is a NAME concern (declare a name with
  // an imported key, then hand a being to it), so it never reaches birth.
  if (spec.importKey) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `birthBeing("${name}"): importKey is not a birth concern — an identity is a ` +
        `Name; declare it (the NAME verb) and hand a being to it, don't import at birth`,
    );
  }

  // ── Credentials ──
  const credential = await mintCredentialSpec(spec.password || null);

  // ── Qualities ──
  // Caller-provided initial qualities deep-merge with the seeds
  // (auth.credentialPlain, cognition.defaultKind, optional flow). No
  // signing key here — the key lives on the Name (trueName), not the being.
  const qualities =
    spec.qualities && typeof spec.qualities === "object"
      ? { ...spec.qualities }
      : {};
  if (credential.plain) {
    qualities.auth = {
      ...(qualities.auth || {}),
      credentialPlain: credential.plain,
    };
  }
  qualities.cognition = {
    ...(qualities.cognition || {}),
    defaultKind: cognition,
  };
  if (Array.isArray(spec.flow)) {
    qualities.flow = spec.flow;
  }

  // Cross-world citizenship: father tuple. Only when present (mate-
  // accepted birth, recorded on the child's qualities for the
  // BE:connect father-admit check downstream). Shape:
  // { story: <foreign domain>, beingId: <foreign being id> }.
  // The mother (actor of be:birth) is the spec's parent; the father
  // (the summoner of summon:mate) is recorded here as a separate
  // tuple so it doesn't blur the identity chain. See FEDERATION.md.
  if (spec.father && typeof spec.father === "object") {
    if (
      typeof spec.father.story !== "string" ||
      !spec.father.story.length ||
      typeof spec.father.beingId !== "string" ||
      !spec.father.beingId.length
    ) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `birthBeing("${name}"): spec.father must be { story: string, beingId: string }`,
      );
    }
    qualities.father = {
      story: spec.father.story,
      beingId: spec.father.beingId,
      // The father's NAME — what cherub's cross-story father-admit matches
      // against (the cryptographically-proven id), NOT the beingId. Defaults
      // to the beingId for a pre-split father whose being id IS his pubkey.
      nameId: spec.father.nameId || spec.father.beingId,
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
    defaultAble,
    // The trueName this being expresses: the MOTHER's trueName by default
    // (the name that births it), OR an explicit sovereign override (the being
    // is the named's own — e.g. a name's first being through cherub). Beings
    // under i-am inherit i-am.
    trueName: effectiveTrueName,
    parentBeingId,
    homeSpace: homeId,
    // The being's home history = the stamper's history (the history THIS
    // be:birth fact is being stamped on). Everything is relative: a
    // being birthed on #7a owns #7a as their present; BE:connect/
    // release/birth all seat the session to this.
    //
    // Read from the stamper's `history` directly, NOT derived from
    // parentBeingId. The mother (parentBeingId, the actor of birth) is
    // always on this history — her moment IS this moment. But the
    // father (qualities.father, when set) may live on a different
    // history or a different story entirely (cross-world mate-being
    // pattern). Deriving from "a parent" introduces ambiguity that
    // doesn't exist when we read from the one source that's always
    // authoritative — the history this fact is landing on.
    homeHistory: history,
    position,
    ...(resolvedCoord ? { coord: resolvedCoord } : {}),
    // Optional traits ride the fact only when SET. The reducer
    // (applyCreateBeing) defaults absent isRemote → false,
    // homeStory → null, so omission folds identically and the
    // chain stops carrying false/null noise on every plain birth.
    ...(spec.isRemote ? { isRemote: true } : {}),
    ...(spec.homeStory ? { homeStory: spec.homeStory } : {}),
    qualities,
  };

  // The being's id IS the content hash of its BIRTH EVENT — the one
  // immutable thing about a being (its live attributes all change). Who
  // birthed it + its birth name + history + the birth MOMENT (bornAt = this
  // moment's act id, which makes each birth unique). Frozen here, carried
  // as of.id below; later set-being / be:rename rewrite the row, never
  // this id, so the reel stays intact. The shareable IDENTITY is the Name
  // (trueName); this is just the local presence handle. See ../beingId.js.
  const id = beingContentId({ ...factSpec, bornAt: moment?.actId ?? null });

  // NOTE: be:birth does NOT mint a trueName. A trueName is its own thing,
  // minted separately through the NAME verb (declare-name) — the way an
  // actId is minted in its own beat, not derived per-fact. Birth only
  // REFERENCES one: the being expresses the MOTHER's trueName
  // (factSpec.trueName above), the name that births it. Under i-am, every
  // being inherits i-am until a separate name is declared and a being is
  // handed to it (be:rename).
  try {
    await emitFact(
      {
        verb: "be",
        act: "birth",
        through: id,
        of: { kind: "being", id },
        params: factSpec,
        actId: moment?.actId || null,
        history: history,
      },
      moment,
    );
  } catch (err) {
    if (err.code === 11000) {
      throw new IbpError(IBP_ERR.RESOURCE_CONFLICT, "Name already taken");
    }
    throw err;
  }

  // ── Inherit able grants from both parents (dual-parent doctrine) ──
  //
  // The child auto-inherits every grant on the mother (parentBeingId
  // = the actor of be:birth) AND every grant on a same-story father
  // (spec.father.story === local). Each inherited grant is a fresh
  // grant fact on the child's reel, anchored at the same
  // anchorSpaceId / anchorBeingId as the parent's grant, with the
  // parent recorded as the grantor.
  //
  // Cross-story fathers do NOT contribute able inheritance — we
  // can't read the foreign story's projection synchronously. They
  // still get the connect-eligibility marker via qualities.father
  // (above). Same-story fathers contribute ables AND get the marker.
  //
  // Self-birth (mother = self) and bootstrap births where the parent
  // has no grants yet are no-ops on this pass — no grants to inherit.
  // See seed/done/DualBeingParents for the doctrine.
  // One word = one moment (philosophy/word/623): a being's grants are SEPARATE words from its birth.
  // Lay them as their OWN moments AFTER the be:birth commits — queued onto moment.afterSeal so the
  // child exists on-chain before it's granted to (laying them inline, before the caller's be:birth
  // seals, would order a grant ahead of the birth on the child's reel). Standalone (no moment): the
  // birth already committed via the singleton path, so lay them inline now.
  const _layBirthGrants = async () => {
    await _inheritParentAbles({
      childId: id,
      motherBeingId: parentBeingId,
      fatherBeingId:
        spec.father?.story === getStoryDomain() ? spec.father?.beingId : null,
      history,
    });
    // `global` is the universal baseline; @public never acts, so it gets none.
    if (name !== "public") await _anointGlobal({ childId: id, history });
  };
  if (moment && Array.isArray(moment.afterSeal)) moment.afterSeal.push(_layBirthGrants);
  else await _layBirthGrants();

  // ── Anoint with the global able ──
  //
  // Per seed/AblesAreAuth.md "Single gate doctrine": the able-walk is
  // the only gate. For a being to do ANYTHING — including petition for
  // additional ables via ask-able / take-able — they must hold a able
  // that permits it. `global` is the universal baseline: every being
  // born into this story gets it at the story root with default
  // reach (host + descendants = story-wide). Parent-inheritance above
  // already covers most paths; this stamps an UNCONDITIONAL global
  // grant so even bootstrap-case beings (parent = I-Am, no grants to
  // inherit) hold their petition surface.
  //
  // Idempotent at the reducer: a second global grant with the same
  // anchor + grantor folds as a duplicate and doesn't bloat
  // ablesGranted. Cherub's explicit registration-time grant of global
  // becomes the redundant-but-harmless case after this line.
  // @public is the structural placeholder being that never acts. Grants
  // on it are noise; skip the anoint. Every other being (including
  // seed delegates) gets global as their universal baseline.
  // (the global anoint + parent-inherited grants now run inside _layBirthGrants above — each its
  // own moment, sealed AFTER the be:birth via afterSeal. One word = one moment.)

  // In-moment: the row materializes at seal. Return the pending view
  // so callers can use the id + spec fields immediately.
  if (moment) {
    return {
      status: "created",
      beingId: id,
      name,
      being: { _id: id, ...factSpec, _pending: true },
    };
  }

  // Standalone: emitFact's singleton path already committed. Read
  // back the materialized row so callers get the full shape including
  // any reducer-derived fields.
  const { loadProjection } = await import("../../projections.js");
  const slot = await loadProjection("being", id, history);
  return {
    status: "created",
    beingId: id,
    name,
    being: slot ? { _id: slot.id, ...slot.state } : { _id: id, ...factSpec },
  };
}

// ─────────────────────────────────────────────────────────────────────
// PARENT ABLE INHERITANCE
// ─────────────────────────────────────────────────────────────────────

/**
 * Stamp grant facts on a newly-born child that mirror both parents'
 * granted ables. Each inherited grant rides the SAME moment as the
 * be:birth (via moment.deltaF) so birth + inheritance seal
 * atomically — the child either exists with both their birth and
 * their inheritance or neither.
 *
 * Same-story only. Cross-story fathers contribute the connect-
 * eligibility marker (qualities.father) but not able grants — the
 * foreign story's projection isn't readable here.
 *
 * Dedup: when both parents have an identical grant
 * (same able + same anchor), only one grant fact is stamped.
 * Mother wins as grantor on ties.
 *
 * No-op when neither parent has any grants (the bootstrap case;
 * I-Am's grants are implicit via the I bypass and not stored on
 * qualities.ablesGranted).
 *
 * @param {object} args
 * @param {string} args.childId
 * @param {string} args.motherBeingId       parentBeingId on the spec
 * @param {string|null} args.fatherBeingId  local beingId of same-story father, or null
 * @param {object} args.moment           in-flight moment ctx (required)
 * @param {string} args.history
 */
async function _inheritParentAbles({
  childId,
  motherBeingId,
  fatherBeingId,
  history,
}) {
  // Read each parent's projection on the child's history (loadOrFold
  // walks lineage so a sub-history sees its effective view).
  const { loadOrFold } = await import("../../projections.js");
  const reads = await Promise.all([
    motherBeingId
      ? loadOrFold("being", String(motherBeingId), history)
      : Promise.resolve(null),
    fatherBeingId
      ? loadOrFold("being", String(fatherBeingId), history)
      : Promise.resolve(null),
  ]);
  const motherSlot = reads[0];
  const fatherSlot = reads[1];

  const motherGrants = _grantsFromSlot(motherSlot);
  const fatherGrants = _grantsFromSlot(fatherSlot);
  if (motherGrants.length === 0 && fatherGrants.length === 0) return;

  // Compose with mother-wins-on-tie. The dedup key includes able +
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

  // One word = one moment (philosophy/word/623): each inherited grant is its OWN word — its own
  // moment / act / fact, signed THROUGH the grantor (the parent who held it). Not pooled with the
  // birth (a run-on the stamper now refuses); a SENTENCE of grants run one at a time on the child's
  // reel. (Called from birthBeing's afterSeal, so the child already exists on-chain.)
  const { withBeingAct } = await import("../../../sprout.js");
  for (const { grant, grantor } of composed) {
    await withBeingAct(
      String(grantor),
      `grant ${grant.able} to ${String(childId).slice(0, 8)}`,
      history,
      (ctx) =>
        emitFact(
          {
            verb: "do",
            act: "grant-able",
            through: grantor,
            of: { kind: "being", id: String(childId) },
            params: {
              able: grant.able,
              anchorSpaceId: grant.anchorSpaceId || null,
              anchorBeingId: grant.anchorBeingId || null,
              grantedBy: grantor,
              inheritedFrom: grantor, // forensic marker — this came from parent inheritance
            },
            actId: ctx.actId,
            history,
          },
          ctx,
        ),
    );
  }
}

function _grantsFromSlot(slot) {
  const grants = slot?.state?.qualities?.ablesGranted;
  return Array.isArray(grants) ? grants : [];
}

function _grantKey(grant) {
  return [
    grant?.able || "",
    grant?.anchorSpaceId || "",
    grant?.anchorBeingId || "",
  ].join("|");
}

/**
 * Anoint a freshly-birthed being with the `global` able anchored at
 * the story root. Every being gets this so the petition surface
 * (ask-able + take-able + the rest of global.canDo) is reachable
 * without parent-inheritance dependencies.
 *
 * Single-gate doctrine (seed/AblesAreAuth.md): the able-walk is the
 * only gate, so universal capabilities MUST live on a able every
 * being holds.
 */
async function _anointGlobal({ childId, history }) {
  const { getSpaceRootId, withIAmAct } = await import("../../../sprout.js");
  const { I } = await import("../seedBeings.js");
  const rootId = getSpaceRootId();
  if (!rootId) return; // boot-window edge; the I-Am birth itself runs before root materializes
  // One word = one moment: the global anoint is its OWN act (I grants), not pooled with the birth.
  await withIAmAct(`anoint ${String(childId).slice(0, 8)} with global`, (ctx) =>
    emitFact(
      {
        verb: "do",
        act: "grant-able",
        through: I,
        of: { kind: "being", id: String(childId) },
        params: {
          able: "global",
          anchorSpaceId: String(rootId),
          anchorBeingId: null,
          grantedBy: I,
        },
        actId: ctx.actId,
        history,
      },
      ctx,
    ),
  );
}

// ─────────────────────────────────────────────────────────────────────
// AUTO-NAMING
// ─────────────────────────────────────────────────────────────────────

/**
 * Generate an unused `<able><suffix>` name. Used by scaffolds (seed
 * delegates, harmony's dancer roster) that auto-name AI beings whose
 * spec doesn't fix one.
 *
 * Strategy: try sequential numeric suffixes starting at the count of
 * existing same-able beings; bump until a free slot is found. Cheap
 * because the projection collection has a name index; bounded by
 * MAX_RETRIES so a pathological state can't loop forever.
 *
 * @param {string} able          base name (e.g. "dancer")
 * @param {object} [opts]
 * @param {string} [opts.history] history to check against (default "0")
 * @returns {Promise<string>}    e.g. "dancer3"
 */
export async function generateUniqueName(able, opts = {}) {
  if (!able || typeof able !== "string") {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "generateUniqueName requires a able string",
    );
  }
  const safeAble = able.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeAble) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `Able "${able}" produces no safe-name prefix`,
    );
  }
  const history = opts.history || "0";
  const { findByNamePattern } = await import("../../projections.js");

  const sameAblePrefix = new RegExp(`^${escapeRegex(safeAble)}[0-9]*$`, "i");
  const existing = await findByNamePattern("being", sameAblePrefix, history);
  let n = existing.length;
  const MAX_RETRIES = 10000;
  for (let i = 0; i < MAX_RETRIES; i++) {
    const candidate = `${safeAble}${n}`;
    const collision = await findByNamePattern(
      "being",
      new RegExp(`^${escapeRegex(candidate)}$`, "i"),
      history,
    );
    if (collision.length === 0) return candidate;
    n++;
  }
  throw new IbpError(
    IBP_ERR.INTERNAL,
    `generateUniqueName exhausted ${MAX_RETRIES} retries for able "${able}"`,
  );
}
