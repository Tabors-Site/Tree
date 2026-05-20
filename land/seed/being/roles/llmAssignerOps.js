// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// llm-assigner DO operations.
//
// The llm-assigner being is programmatic but acts on substrate through
// the same DO surface an LLM-driven being would use. These two ops are
// its tools — `create-artifact` and `delete-artifact` (the kernel
// primitives) wrapped with the tutorial-marker logic so the being can
// spawn / consume its own intro artifact.
//
// Naming convention: ops owned by a role use the `<role>:<action>`
// prefix, same shape extensions use. ownerExtension is set to the
// role name so the registry tracks who shipped them.
//
// First demonstration of the artifact-crossing-worlds shape: the
// artifact's origin is `web` and its content is just a YouTube URL —
// substrate holds the reference + lifecycle; the bytes live on the
// web; the 3D portal renders it as a real placed object next to the
// llm-assigner being.

import log from "../core/log.js";
import Being from "../models/being.js";
import Artifact from "../models/artifact.js";
import { registerOperation } from "../core/operations.js";
import {
  LLM_ASSIGNER_TUTORIAL_MARK,
  LLM_ASSIGNER_TUTORIAL_URL,
  LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
} from "../core/systemBeings.js";

const OWNER = "llm-assigner";

export function registerLlmAssignerOps() {
  // Spawn the intro tutorial artifact at the addressed node (typically
  // the land root). Idempotent: returns the existing artifact when
  // one with the marker is already present.
  registerOperation("llm-assigner:start-tutorial", {
    targets: ["node"],
    ownerExtension: OWNER,
    handler: async ({ target }) => {
      log.info("llm-assigner", `start-tutorial hit at node=${String(target?._id || target?.nodeId || "?").slice(0, 8)}`);
      const nodeId = String(target?._id || target?.nodeId || target);
      if (!nodeId || nodeId === "[object Object]") {
        throw new Error("llm-assigner:start-tutorial: node target required");
      }

      const llmAssigner = await Being.findOne({ name: "llm-assigner" })
        .select("_id").lean();
      if (!llmAssigner) {
        throw new Error("llm-assigner being not found on this land");
      }

      // Idempotent — return the existing one if it's already there.
      const existing = await Artifact.findOne({
        beingId: String(llmAssigner._id),
        nodeId,
        "metadata.tutorial.purpose": LLM_ASSIGNER_TUTORIAL_MARK,
      }).select("_id").lean();
      if (existing) {
        return {
          artifactId: String(existing._id),
          videoId:    LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
          url:        LLM_ASSIGNER_TUTORIAL_URL,
          created:    false,
        };
      }

      // Authored by the llm-assigner being so the eventual deletion
      // passes the ownership gate.
      const artifact = await Artifact.create({
        nodeId,
        beingId: String(llmAssigner._id),
        name:    "Setting up an LLM connection",
        origin:  "web",
        content: {
          contentType: "video/youtube",
          url:         LLM_ASSIGNER_TUTORIAL_URL,
          videoId:     LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
          title:       "Setting up an LLM connection",
        },
        parentArtifactId: null,
        metadata: new Map([
          ["tutorial", { purpose: LLM_ASSIGNER_TUTORIAL_MARK }],
        ]),
      });

      log.info("llm-assigner",
        `spawned tutorial artifact ${String(artifact._id).slice(0, 8)} at ${nodeId.slice(0, 8)}`);

      return {
        artifactId: String(artifact._id),
        videoId:    LLM_ASSIGNER_TUTORIAL_VIDEO_ID,
        url:        LLM_ASSIGNER_TUTORIAL_URL,
        created:    true,
      };
    },
  });

  // Persist YouTube playback position on the tutorial artifact so a
  // page reload or navigation away/back resumes at the right spot.
  // Idempotent overwrite; the marker check keeps this op scoped to the
  // llm-assigner tutorial only.
  registerOperation("llm-assigner:save-playback", {
    targets: ["artifact", "node"],
    ownerExtension: OWNER,
    handler: async ({ target, params }) => {
      log.info("llm-assigner", `save-playback hit: artifactId=${params?.artifactId} t=${params?.currentTime}`);
      const artifactId = String(
        params?.artifactId || target?._id || target?.artifactId || target,
      );
      const currentTime = Number(params?.currentTime);
      if (!artifactId || artifactId === "[object Object]") {
        throw new Error("llm-assigner:save-playback: artifactId required");
      }
      if (!Number.isFinite(currentTime) || currentTime < 0) {
        throw new Error("llm-assigner:save-playback: currentTime (number, seconds) required");
      }

      const artifact = await Artifact.findById(artifactId).lean();
      if (!artifact) throw new Error(`Artifact ${artifactId} not found`);

      const llmAssigner = await Being.findOne({ name: "llm-assigner" })
        .select("_id").lean();
      const tutorialMeta = artifact.metadata instanceof Map
        ? artifact.metadata.get("tutorial")
        : artifact.metadata?.tutorial;
      if (
        String(artifact.beingId) !== String(llmAssigner?._id) ||
        tutorialMeta?.purpose !== LLM_ASSIGNER_TUTORIAL_MARK
      ) {
        throw new Error("llm-assigner:save-playback only writes to llm-assigner tutorial artifacts");
      }

      const nextMeta = { ...(tutorialMeta || {}), playbackSeconds: currentTime };
      await Artifact.updateOne(
        { _id: artifactId },
        { $set: { "metadata.tutorial": nextMeta } },
      );
      return { saved: true, artifactId, currentTime };
    },
  });

  // Consume the tutorial artifact when the user finishes watching.
  // Verifies the marker so the op stays narrowly scoped; calls
  // `deleteArtifactAndFile` internally acting as llm-assigner so the
  // ownership gate (author or root-owner) passes.
  registerOperation("llm-assigner:complete-tutorial", {
    targets: ["artifact", "node"],
    ownerExtension: OWNER,
    handler: async ({ target, params }) => {
      log.info("llm-assigner", `complete-tutorial hit: artifactId=${params?.artifactId}`);
      const artifactId = String(
        params?.artifactId || target?._id || target?.artifactId || target,
      );
      if (!artifactId || artifactId === "[object Object]") {
        throw new Error("llm-assigner:complete-tutorial: artifactId required");
      }

      const artifact = await Artifact.findById(artifactId).lean();
      if (!artifact) throw new Error(`Artifact ${artifactId} not found`);

      const llmAssigner = await Being.findOne({ name: "llm-assigner" })
        .select("_id").lean();
      const tutorialMeta = artifact.metadata instanceof Map
        ? artifact.metadata.get("tutorial")
        : artifact.metadata?.tutorial;
      if (
        String(artifact.beingId) !== String(llmAssigner?._id) ||
        tutorialMeta?.purpose !== LLM_ASSIGNER_TUTORIAL_MARK
      ) {
        throw new Error("llm-assigner:complete-tutorial only consumes llm-assigner tutorial artifacts");
      }

      const { deleteArtifactAndFile } = await import("../tree/artifacts.js");
      await deleteArtifactAndFile({
        artifactId,
        beingId: String(llmAssigner._id),
      });

      log.info("llm-assigner",
        `consumed tutorial artifact ${String(artifactId).slice(0, 8)}`);
      return { consumed: true, artifactId };
    },
  });

  log.verbose("llm-assigner", "registered 3 DO ops (start-tutorial, save-playback, complete-tutorial)");
}
