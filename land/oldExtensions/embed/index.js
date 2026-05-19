import log from "../../seed/log.js";
import tools from "./tools.js";
import { setServices, embedNote, findSimilar, getEmbedConfig } from "./core.js";
import { ARTIFACT_ORIGIN } from "../../seed/protocol.js";

export async function init(core) {
  setServices({
    getClientForUser: core.llm.getClientForUser,
  });

  // ── afterArtifact: embed every new ibp-origin artifact ─────────────
  core.hooks.register("afterArtifact", async ({ artifact, nodeId, beingId, origin, action }) => {
    if (origin !== ARTIFACT_ORIGIN.IBP) return;
    if (action !== "create" && action !== "edit") return;
    if (!beingId || beingId === "SYSTEM") return;

    // Skip system nodes
    try {
      const Node = core.models.Node;
      const node = await Node.findById(nodeId).select("systemRole").lean();
      if (node?.systemRole) return;
    } catch { return; }

    // Embed in background, don't block artifact write
    embedNote(artifact._id || artifact.id, beingId).catch((err) => {
      log.debug("Embed", `Background embedding failed for artifact at ${nodeId}: ${err.message}`);
    });
  }, "embed");

  // ── enrichContext: inject semantically related notes ────────────────
  core.hooks.register("enrichContext", async ({ context, node, meta, beingId }) => {
    if (!beingId) return;
    if (node.systemRole) return;

    // Don't run expensive search on every enrichContext. Only if the node
    // has notes with embeddings. Check meta for cached related or skip.
    const embedMeta = meta.embed;
    if (!embedMeta) return;

    // Find the tree root
    let rootId;
    if (node.rootOwner) {
      rootId = node._id;
    } else {
      try {
        const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
        const root = await resolveRootNode(node._id);
        rootId = root?._id;
      } catch { return; }
    }
    if (!rootId) return;

    // Get the most recent note's vector at this node
    const Artifact = core.models.Artifact;
    const recentNote = await Artifact.findOne({
      nodeId: node._id,
      origin: ARTIFACT_ORIGIN.IBP,
      "metadata.embed.vector": { $exists: true },
    })
      .sort({ createdAt: -1 })
      .select("_id metadata")
      .lean();

    if (!recentNote) return;

    const vector = recentNote.metadata instanceof Map
      ? recentNote.metadata.get("embed")?.vector
      : recentNote.metadata?.embed?.vector;

    if (!vector) return;

    try {
      const config = await getEmbedConfig();
      const related = await findSimilar(vector, rootId, {
        maxResults: 5,
        threshold: config.similarityThreshold,
        excludeNoteIds: [recentNote._id],
        nodeId: node._id,
      });

      if (related.length > 0) {
        context.relatedNotes = related.map((r) => ({
          nodeName: r.nodeName,
          similarity: r.similarity,
          snippet: r.snippet,
        }));
      }
    } catch (err) {
      log.debug("Embed", "Related notes enrichment failed:", err.message);
    }
  }, "embed");

  const { default: router } = await import("./routes.js");

  return {
    router,
    tools,
    exports: {
      embedNote,
      findSimilar,
      findRelatedAtNode: (await import("./core.js")).findRelatedAtNode,
      generateEmbedding: (await import("./core.js")).generateEmbedding,
    },
  };
}
