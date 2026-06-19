// connectHost.js — the host env for cherub-connect.word's `host:` escapes (8.md §6/§9).
//
// The CONTROL strand (foreach / if / mark / refuse / return) is the `.word`; the SESSION
// ops (search / verify / token / seat) STAY host. This is the thin adapter that wires
// cherub connectHandler's Mode-1 (anonymous credential) PRIMITIVES into ctx.env.host, so
// the `.word` reaches the REAL logic with ZERO stubs. It reimplements nothing — it calls
// the same imported functions connectHandler calls (findBeingCandidatesByName,
// verifyPassword, generateToken, unlockSigning); only the orchestration glue lives here,
// which is exactly the strand the connect cut will delete from connectHandler.
//
// callHost invokes each builtin as `fn({ args: [...] })` (the parser emits
// `host: fn(a,b) as c` → params:{args:["$a","$b"]}). No fact is laid by any of these
// (recall / CONTROL is private); the token + seat ride the §7 `return`, never the chain.

import { findBeingCandidatesByName } from "../../../materials/being/identity/lookups.js";
import { verifyPassword, generateToken } from "../../../materials/being/identity/credentials.js";
import { loadProjection } from "../../../materials/projections.js";
import { getStoryDomain } from "../../../ibp/address.js";

// cherub-connect.word holds MULTIPLE flows (credential, owned, …); the bridge runs the
// ONE that matches the connect mode. The credential flow declares a `password` bind; the
// owned flow does not (it keys on the signed-in `caller`). Selecting one flow keeps the
// evaluator from running both (flow 0 happening to return/refuse first is luck, not a
// contract).
export function selectConnectFlow(ir, kind) {
  const flows = (Array.isArray(ir) ? ir : [ir]).filter((n) => n.kind === "flow");
  if (kind === "credential") return flows.find((f) => (f.binds || []).includes("password"));
  const clauseOf = (f) => String(f.when?.event || f.when?.op?.clause || "");
  if (kind === "owned") return flows.find((f) => /\bowns?\b/i.test(clauseOf(f)));
  if (kind === "inherit") return flows.find((f) => /inherit|descendant/i.test(clauseOf(f)));
  return null;
}

export function connectHostEnv() {
  return {
    // searchByName(name) → the cross-branch candidate sweep, capped at 5 (the bcrypt
    // cost bound, connectHandler L312). isRemote is already a boolean in the projection
    // (reducerHelpers.js), but normalize defensively so the `.word`'s `isRemote equals
    // false` matches a native being (the JS skipped on truthiness: `if (isRemote) continue`).
    searchByName: async ({ args: [name] }) => {
      const candidates = (await findBeingCandidatesByName(name)).slice(0, 5);
      return candidates.map((c) => ({ ...c, isRemote: !!c.isRemote }));
    },

    // verifyPassword(candidate, password) → the real bcrypt check against the candidate's
    // stored hash (connectHandler L316).
    verifyPassword: async ({ args: [candidate, password] }) => verifyPassword(candidate, password),

    // generateToken(candidate) → mint the session token AND open the being's signing
    // session. In connectHandler (L325-331) the verified being's session is established as
    // one beat: token, then unlockSigning keyed by its trueName. The `.word`'s
    // "generateToken" IS that beat, so the unlock rides here rather than adding a pure
    // plumbing escape to the Word. The token is the visible return value; the unlock is the
    // host side-effect of establishing the session.
    generateToken: async ({ args: [candidate] }) => {
      const token = generateToken(candidate);
      if (candidate?.trueName) {
        const { unlockSigning } = await import("../../../materials/name/signingSession.js");
        unlockSigning(String(candidate.trueName));
      }
      return token;
    },

    // (seatBranch + ownerTrueName COLLAPSED to `see` verbs in cherub-connect.word: the
    // SEE verb reads homeBranch / trueName natively, no host escape — reads are verbs, 1.md.)

    // ── flow 3 (inherit-connect / father-admit, connectHandler Mode-3) ──────────────

    // extractTargetName(address) → the @name off a stance address (connectHandler L621).
    extractTargetName: ({ args: [address] }) => {
      if (typeof address !== "string") return null;
      const m = address.match(/@([a-z][a-z0-9-]*)$/i);
      return m ? m[1].toLowerCase() : null;
    },

    // findBeingCandidatesByName(target) → the inherit sweep: native beings only, capped at
    // 5 (connectHandler L442-444: `.filter(!isRemote).slice(0,5)`).
    findBeingCandidatesByName: async ({ args: [target] }) => {
      const c = await findBeingCandidatesByName(target);
      return c.filter((x) => !x.isRemote).slice(0, 5);
    },

    // (isAncestorOf COLLAPSED to a `see` PREDICATE in cherub-connect.word: `see whether the
    // caller is an ancestor of the candidate`, resolved natively by evalSee — no host escape.)

    // fatherMatch(candidate, caller) → THE father-admit decision, the EXACT JS local-vs-
    // cross logic (connectHandler L472-510). SECURITY-CRITICAL, kept HOST not .word: a
    // LOCAL father (father.story === this story) is authed by beingId; a CROSS-story
    // father is authed ONLY by the proven NAME + a verified envelope signature, NEVER by
    // beingId (a beingId match for a cross father is the vessel-takeover attack the JS
    // guards). `caller` is the identity object {beingId,nameId,story,beingSigVerified}.
    fatherMatch: ({ args: [candidate, caller] }) => {
      const father = candidate?.qualities?.father || null;
      if (!father?.story) return false;
      const localDomain = getStoryDomain();
      const requesterStory = caller?.story || localDomain;
      const storyMatches = String(father.story) === String(requesterStory);
      const isCrossStory = String(father.story) !== String(localDomain);
      if (storyMatches && isCrossStory) {
        return !!(father.nameId && caller?.nameId &&
          String(father.nameId) === String(caller.nameId) && caller?.beingSigVerified === true);
      }
      if (storyMatches) {
        return !!(father.beingId && String(father.beingId) === String(caller?.beingId));
      }
      return false;
    },

    // selectCandidate(candidate, ...) → the chosen being (the asFather decision rides the
    // candidateAsFather flag the .word marked, not this return).
    selectCandidate: ({ args: [candidate] }) => candidate,

    // displaceInhabitor(chosen, caller) → father-priority: stamp a be:release on the vessel
    // when a DIFFERENT being currently inhabits it (connectHandler L544-573). The ONE world
    // fact flow 3 lays; emitted into the moment (ctx.moment).
    displaceInhabitor: async ({ args: [chosen, caller] }, ctx) => {
      const current = chosen?.qualities?.connection?.inhabitedBy || null;
      if (!current || String(current) === String(caller?.beingId)) return false;
      const { emitFact } = await import("../../../past/fact/facts.js");
      const sc = ctx?.moment || null;
      await emitFact({
        verb: "be", act: "release", through: String(current),
        of: { kind: "being", id: String(chosen._id) },
        params: {
          releasedBy: "father-priority",
          fatherBeingId: String(caller?.beingId),
          fatherStory: chosen.qualities?.father?.story || getStoryDomain(),
        },
        actId: sc?.actId || null, branch: sc?.actorAct?.branch || "0",
      }, sc);
      return true;
    },

    // driverTrueNameForFather(chosen, caller) → the SIGNER is the inhabitor: the father
    // drives the vessel signing as HIMSELF (his local trueName, else his own id; never the
    // vessel's trueName, or a cross father would sign as the mother — connectHandler L587-594).
    driverTrueNameForFather: async ({ args: [chosen, caller] }) => {
      const proj = await loadProjection("being", String(caller?.beingId), chosen?.homeBranch || "0");
      return proj?.state?.trueName || String(caller?.beingId);
    },

    // driverTrueNameForVessel(chosen) → ancestor/inherit (non-father): the vessel's own
    // trueName drives (connectHandler L587 default).
    driverTrueNameForVessel: ({ args: [chosen] }) => chosen?.trueName ?? null,

    // generateInheritToken(chosen, driver) → the vessel's token, but signing as `driver`
    // (connectHandler L595: generateToken({ ...targetBeing, trueName: driverTrueName })).
    generateInheritToken: ({ args: [chosen, driver] }) => generateToken({ ...chosen, trueName: driver }),
  };
}
