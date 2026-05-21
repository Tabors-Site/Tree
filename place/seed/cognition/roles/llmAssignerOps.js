// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// llm-assigner DO operations.
//
// The llm-assigner being is programmatic but acts on substrate through
// the same DO surface an LLM-driven being would use. These ops are its
// tools — `create-matter` and `delete-matter` (the kernel primitives)
// wrapped with the tutorial-marker logic so the being can spawn /
// consume its own intro matter.
//
// Naming convention: ops owned by a role use the `<role>:<action>`
// prefix, same shape extensions use. ownerExtension is set to the
// role name so the registry tracks who shipped them.
//
// First demonstration of the matter-crossing-worlds shape: the matter's
// origin is `web` and its content is just a YouTube URL — substrate
// holds the reference + lifecycle; the bytes live on the web; the 3D
// portal renders it as a real placed object next to the llm-assigner
// being.

import log from "../../system/log.js";
import Being from "../../models/being.js";
import Matter from "../../models/matter.js";
import { registerOperation } from "../../ibp/operations.js";
import {
  LLM_ASSIGNER_TUTORIAL_MARK,
  LLM_ASSIGNER_TUTORIAL_URL,
  LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
} from "./llmAssigner.js";

const OWNER = "llm-assigner";

export function registerLlmAssignerOps() {
  // Spawn the intro tutorial matter at the addressed space (typically
  // the place root). Idempotent: returns the existing matter when one
  // with the marker is already present.
  registerOperation("llm-assigner:start-tutorial", {
    targets: ["space"],
    ownerExtension: OWNER,
    handler: async ({ target }) => {
      log.info("llm-assigner", `start-tutorial hit at space=${String(target?._id || target?.spaceId || "?").slice(0, 8)}`);
      const spaceId = String(target?._id || target?.spaceId || target);
      if (!spaceId || spaceId === "[object Object]") {
        throw new Error("llm-assigner:start-tutorial: space target required");
      }

      const llmAssigner = await Being.findOne({ name: "llm-assigner" })
        .select("_id").lean();
      if (!llmAssigner) {
        throw new Error("llm-assigner being not found on this place");
      }

      // Idempotent — return the existing one if it's already there.
      const existing = await Matter.findOne({
        beingId: String(llmAssigner._id),
        spaceId,
        "qualities.tutorial.purpose": LLM_ASSIGNER_TUTORIAL_MARK,
      }).select("_id").lean();
      if (existing) {
        return {
          matterId: String(existing._id),
          videoId:  LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
          url:      LLM_ASSIGNER_TUTORIAL_URL,
          created:  false,
        };
      }

      // Authored by the llm-assigner being so the eventual deletion
      // passes the ownership gate.
      const matter = await Matter.create({
        spaceId,
        beingId: String(llmAssigner._id),
        name:    "Setting up an LLM connection",
        origin:  "web",
        content: {
          contentType: "video/youtube",
          url:         LLM_ASSIGNER_TUTORIAL_URL,
          videoId:     LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
          title:       "Setting up an LLM connection",
        },
        parentMatterId: null,
        qualities: new Map([
          ["tutorial", { purpose: LLM_ASSIGNER_TUTORIAL_MARK }],
        ]),
      });

      log.info("llm-assigner",
        `spawned tutorial matter ${String(matter._id).slice(0, 8)} at ${spaceId.slice(0, 8)}`);

      return {
        matterId: String(matter._id),
        videoId:  LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
        url:      LLM_ASSIGNER_TUTORIAL_URL,
        created:  true,
      };
    },
  });

  // Persist YouTube playback position on the tutorial matter so a page
  // reload or navigation away/back resumes at the right spot.
  // Idempotent overwrite; the marker check keeps this op scoped to the
  // llm-assigner tutorial only.
  registerOperation("llm-assigner:save-playback", {
    targets: ["matter", "space"],
    ownerExtension: OWNER,
    handler: async ({ target, params }) => {
      log.info("llm-assigner", `save-playback hit: matterId=${params?.matterId} t=${params?.currentTime}`);
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

      const matter = await Matter.findById(matterId).lean();
      if (!matter) throw new Error(`Matter ${matterId} not found`);

      const llmAssigner = await Being.findOne({ name: "llm-assigner" })
        .select("_id").lean();
      const tutorialMeta = matter.qualities instanceof Map
        ? matter.qualities.get("tutorial")
        : matter.qualities?.tutorial;
      if (
        String(matter.beingId) !== String(llmAssigner?._id) ||
        tutorialMeta?.purpose !== LLM_ASSIGNER_TUTORIAL_MARK
      ) {
        throw new Error("llm-assigner:save-playback only writes to llm-assigner tutorial matter");
      }

      const nextMeta = { ...(tutorialMeta || {}), playbackSeconds: currentTime };
      await Matter.updateOne(
        { _id: matterId },
        { $set: { "qualities.tutorial": nextMeta } },
      );
      return { saved: true, matterId, currentTime };
    },
  });

  // Consume the tutorial matter when the user finishes watching.
  // Verifies the marker so the op stays narrowly scoped; calls
  // `deleteMatterAndFile` internally acting as llm-assigner so the
  // ownership gate (author or root-owner) passes.
  registerOperation("llm-assigner:complete-tutorial", {
    targets: ["matter", "space"],
    ownerExtension: OWNER,
    handler: async ({ target, params }) => {
      log.info("llm-assigner", `complete-tutorial hit: matterId=${params?.matterId}`);
      const matterId = String(
        params?.matterId || target?._id || target?.matterId || target,
      );
      if (!matterId || matterId === "[object Object]") {
        throw new Error("llm-assigner:complete-tutorial: matterId required");
      }

      const matter = await Matter.findById(matterId).lean();
      if (!matter) throw new Error(`Matter ${matterId} not found`);

      const llmAssigner = await Being.findOne({ name: "llm-assigner" })
        .select("_id").lean();
      const tutorialMeta = matter.qualities instanceof Map
        ? matter.qualities.get("tutorial")
        : matter.qualities?.tutorial;
      if (
        String(matter.beingId) !== String(llmAssigner?._id) ||
        tutorialMeta?.purpose !== LLM_ASSIGNER_TUTORIAL_MARK
      ) {
        throw new Error("llm-assigner:complete-tutorial only consumes llm-assigner tutorial matter");
      }

      const { deleteMatterAndFile } = await import("../matter/matters.js");
      await deleteMatterAndFile({
        matterId,
        beingId: String(llmAssigner._id),
      });

      log.info("llm-assigner",
        `consumed tutorial matter ${String(matterId).slice(0, 8)}`);
      return { consumed: true, matterId };
    },
  });

  log.verbose("llm-assigner", "registered 3 DO ops (start-tutorial, save-playback, complete-tutorial)");
}
