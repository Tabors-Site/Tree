// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// llm-assigner DO operations.
//
// The llm-assigner being is scripted (it IS its code, no factory
// frame). When its handlers turn around and act on substrate, they
// do so AS THEMSELVES — going through the same DO verbs any other
// caller uses, under the llm-assigner's own identity. No direct
// Mongo writes; every substrate touch is grammar.
//
// First demonstration of the matter-crossing-worlds shape: the
// matter's origin is `web` and its content is just a YouTube URL —
// substrate holds the reference + lifecycle; the bytes live on the
// web; the 3D portal renders it as a real placed object next to
// the llm-assigner being.
//
// Naming convention: ops owned by a role use the `<role>:<action>`
// prefix, same shape extensions use. ownerExtension is set to the
// role name so the registry tracks who shipped them.

import log from "../../parentReality/log.js";
import Matter from "../../materials/matter/matter.js";
import { registerOperation } from "../../ibp/operations.js";
import { doVerb } from "../../ibp/verbs.js";
import { findBeingByName } from "../../materials/being/identity.js";
import { getMatter } from "../../materials/matter/matters.js";
import {
  LLM_ASSIGNER_TUTORIAL_MARK,
  LLM_ASSIGNER_TUTORIAL_URL,
  LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
} from "./llmAssigner.js";

const OWNER = "llm-assigner";

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

// The llm-assigner being's row, used as the author/owner stamp on
// tutorial matter. Goes through `findBeingByName` (the canonical
// being lookup) rather than reaching for Mongoose directly.
// Cached after first read.
let _llmAssignerCache = null;
async function getLlmAssigner() {
  if (_llmAssignerCache) return _llmAssignerCache;
  const row = await findBeingByName("llm-assigner");
  if (!row) throw new Error("llm-assigner being not found on this place");
  _llmAssignerCache = row;
  return row;
}

// Locate this place's tutorial matter at a space, scoped by the
// marker so we never touch unrelated matter authored by the
// llm-assigner. Returns the lean row, or null.
async function findTutorialMatter(spaceId, llmAssignerId) {
  return Matter.findOne({
    beingId: String(llmAssignerId),
    spaceId,
    "qualities.tutorial.purpose": LLM_ASSIGNER_TUTORIAL_MARK,
  }).lean();
}

// Two-part ownership gate: the matter must be authored by the
// llm-assigner being AND carry the tutorial marker. Returns the
// matter row when valid; throws otherwise. The save-playback and
// complete-tutorial ops both gate through here.
async function assertTutorialMatter(matterId, errPrefix) {
  const matter = await getMatter(matterId);
  if (!matter) throw new Error(`${errPrefix}: Matter ${matterId} not found`);

  const llmAssigner = await getLlmAssigner();
  const tutorialMeta = matter.qualities instanceof Map
    ? matter.qualities.get("tutorial")
    : matter.qualities?.tutorial;

  if (
    String(matter.beingId) !== String(llmAssigner._id) ||
    tutorialMeta?.purpose !== LLM_ASSIGNER_TUTORIAL_MARK
  ) {
    throw new Error(`${errPrefix} only acts on llm-assigner tutorial matter`);
  }

  return { matter, tutorialMeta: tutorialMeta || {} };
}

// ────────────────────────────────────────────────────────────────────
// Registration
// ────────────────────────────────────────────────────────────────────

export function registerLlmAssignerOps() {
  // Spawn the intro tutorial matter at the addressed space (typically
  // the place root). Idempotent: returns the existing matter when one
  // with the marker is already present. The new matter is created
  // through the seed `create-matter` DO op under the llm-assigner's
  // own identity, so beforeMatter / afterMatter hooks fire and a Fact
  // lands.
  registerOperation("llm-assigner:start-tutorial", {
    targets: ["space"],
    ownerExtension: OWNER,
    handler: async ({ target }) => {
      const spaceId = String(target?._id || target?.spaceId || target);
      if (!spaceId || spaceId === "[object Object]") {
        throw new Error("llm-assigner:start-tutorial: space target required");
      }

      log.info("llm-assigner",
        `start-tutorial hit at space=${spaceId.slice(0, 8)}`);

      const llmAssigner = await getLlmAssigner();

      // Idempotent — return the existing tutorial matter if one is
      // already present at this space.
      const existing = await findTutorialMatter(spaceId, llmAssigner._id);
      if (existing) {
        return {
          matterId: String(existing._id),
          videoId:  LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
          url:      LLM_ASSIGNER_TUTORIAL_URL,
          created:  false,
        };
      }

      // The llm-assigner being itself is the actor. Calling
      // create-matter under its own identity makes it the matter's
      // author (so the ownership gate on later delete passes) and
      // routes the write through the verb (afterMatter fires, Fact
      // is stamped).
      const llmAssignerIdentity = {
        beingId: String(llmAssigner._id),
        name:    "llm-assigner",
      };
      const result = await doVerb(
        target,
        "birth",
        {
          kind: "matter",
          spec: {
            name:    "Setting up an LLM connection",
            origin:  "web",
            content: {
              contentType: "video/youtube",
              url:         LLM_ASSIGNER_TUTORIAL_URL,
              videoId:     LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
              title:       "Setting up an LLM connection",
            },
            qualities: {
              tutorial: { purpose: LLM_ASSIGNER_TUTORIAL_MARK },
            },
          },
        },
        { identity: llmAssignerIdentity },
      );

      log.info("llm-assigner",
        `spawned tutorial matter ${result.matterId.slice(0, 8)} at ${spaceId.slice(0, 8)}`);

      return {
        matterId: result.matterId,
        videoId:  LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
        url:      LLM_ASSIGNER_TUTORIAL_URL,
        created:  true,
      };
    },
  });

  // Persist YouTube playback position on the tutorial matter so a
  // page reload or navigation resumes at the right spot. Fact-driven
  // (Slice 3, 2026-05-23): routes through do.set on the matter's
  // reel so the playback-seconds advance lands in the fact chain.
  // skipAudit on the outer op so only the inner do.set Fact stamps.
  registerOperation("llm-assigner:save-playback", {
    targets: ["matter", "space"],
    ownerExtension: OWNER,
    skipAudit: true,
    handler: async ({ target, params, identity, summonCtx }) => {
      log.info("llm-assigner",
        `save-playback hit: matterId=${params?.matterId} t=${params?.currentTime}`);

      const matterId = String(
        params?.matterId || target?._id || target?.matterId || target,
      );
      const currentTime = Number(params?.currentTime);
      if (!matterId || matterId === "[object Object]") {
        throw new Error("llm-assigner:save-playback: matterId required");
      }
      if (!Number.isFinite(currentTime) || currentTime < 0) {
        throw new Error("llm-assigner:save-playback: currentTime (number, seconds) required");
      }

      const { matter, tutorialMeta } = await assertTutorialMatter(
        matterId, "llm-assigner:save-playback",
      );

      const value = { ...tutorialMeta, playbackSeconds: currentTime };
      const opts = identity ? { identity, summonCtx } : { scaffold: true };
      await doVerb(
        matter,
        "set",
        { field: "qualities.tutorial", value, merge: false },
        opts,
      );
      return { saved: true, matterId, currentTime };
    },
  });

  // Consume the tutorial matter when the user finishes watching.
  // Goes through the seed `delete-matter` DO under the llm-
  // assigner's own identity (it IS the matter's author, so the
  // ownership gate inside deleteMatterAndFile passes). The deletion
  // is stamped as a Fact and afterMatter fires.
  registerOperation("llm-assigner:complete-tutorial", {
    targets: ["matter", "space"],
    ownerExtension: OWNER,
    handler: async ({ target, params }) => {
      log.info("llm-assigner",
        `complete-tutorial hit: matterId=${params?.matterId}`);

      const matterId = String(
        params?.matterId || target?._id || target?.matterId || target,
      );
      if (!matterId || matterId === "[object Object]") {
        throw new Error("llm-assigner:complete-tutorial: matterId required");
      }

      const { matter } = await assertTutorialMatter(
        matterId, "llm-assigner:complete-tutorial",
      );

      const llmAssigner = await getLlmAssigner();
      await doVerb(
        matter,
        "death",
        {},
        {
          identity: {
            beingId: String(llmAssigner._id),
            name:    "llm-assigner",
          },
        },
      );

      log.info("llm-assigner",
        `consumed tutorial matter ${matterId.slice(0, 8)}`);
      return { consumed: true, matterId };
    },
  });

  log.verbose("llm-assigner", "registered 3 DO ops (start-tutorial, save-playback, complete-tutorial)");
}
