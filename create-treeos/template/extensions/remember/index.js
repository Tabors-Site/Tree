import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
const MAX_DEPARTED = 50;

export async function init(core) {
  // beforeNodeDelete: write one line to the parent before the child is gone
  core.hooks.register("beforeNodeDelete", async ({ node, nodeId }) => {
    if (!node && !nodeId) return;

    try {
      const doc = node || await Node.findById(nodeId).select("_id name parent metadata").lean();
      if (!doc || !doc.parent) return;
      if (doc.systemRole) return; // don't memorialize system nodes

      const parentDoc = await Node.findById(doc.parent);
      if (!parentDoc) return;

      const meta = core.metadata.getExtMeta(parentDoc, "remember") || {};
      if (!meta.departed) meta.departed = [];

      // Check if prune absorbed essence
      const nodeMeta = doc.metadata instanceof Map
        ? Object.fromEntries(doc.metadata)
        : (doc.metadata || {});
      const wasPruned = !!nodeMeta.prune;
      const hadEssence = !!nodeMeta.compress?.essence;

      let note = "";
      if (wasPruned && hadEssence) {
        note = "Pruned. Essence preserved in parent.";
      } else if (wasPruned) {
        note = "Pruned. Gone quiet.";
      } else {
        note = "Removed.";
      }

      meta.departed.push({
        name: doc.name || "unnamed",
        pruned: wasPruned,
        date: new Date().toISOString().slice(0, 10),
        note,
      });

      // Cap the memorial
      if (meta.departed.length > MAX_DEPARTED) {
        meta.departed = meta.departed.slice(-MAX_DEPARTED);
      }

      await core.metadata.setExtMeta(parentDoc, "remember", meta);
    } catch (err) {
      log.debug("Remember", `beforeNodeDelete memorial failed: ${err.message}`);
    }
  }, "remember");

  // Listen for split events via afterMetadataWrite on the split extension
  // When split writes history to a root, we can detect it and memorialize
  core.hooks.register("afterMetadataWrite", async ({ nodeId, extName, data }) => {
    if (extName !== "split") return;
    if (!data?.history) return;

    try {
      const latest = Array.isArray(data.history) ? data.history[data.history.length - 1] : null;
      if (!latest || !latest.branchName) return;

      const node = await Node.findById(nodeId);
      if (!node) return;

      const meta = core.metadata.getExtMeta(node, "remember") || {};
      if (!meta.departed) meta.departed = [];

      // Don't duplicate if already memorialized
      const already = meta.departed.some(
        d => d.name === latest.branchName && d.splitTo
      );
      if (already) return;

      meta.departed.push({
        name: latest.branchName,
        splitTo: "own root",
        date: new Date().toISOString().slice(0, 10),
        note: "Outgrew this tree. Became its own.",
      });

      if (meta.departed.length > MAX_DEPARTED) {
        meta.departed = meta.departed.slice(-MAX_DEPARTED);
      }

      await core.metadata.setExtMeta(node, "remember", meta);
    } catch (err) {
      log.debug("Remember", `afterMetadataWrite split memorial failed: ${err.message}`);
    }
  }, "remember");

  // enrichContext: the tree knows what used to be here
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const remember = meta?.remember;
    if (!remember?.departed?.length) return;

    context.departed = remember.departed.map(d => ({
      name: d.name,
      date: d.date,
      note: d.note,
    }));
  }, "remember");

  log.verbose("Remember", "Remember loaded");

  return {};
}
