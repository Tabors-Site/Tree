/**
 * Dynamic Rename
 *
 * Listens for setup completion on any extension tree.
 * Reads the tree content, makes one background LLM call,
 * renames the root to something descriptive. Non-blocking.
 */

import log from "../../seed/log.js";

const GENERIC_NAMES = new Set([
  "Fitness", "Food", "Recovery", "Study", "KB", "Knowledge Base",
]);

export async function init(core) {
  const Node = core.models.Node;
  const runChat = core.llm?.runChat || null;

  core.hooks.register("afterMetadataWrite", async ({ nodeId, extName, data }) => {
    // Only fire on setup completion
    if (data?.setupPhase !== "complete") return;

    // Only for root nodes
    const root = await Node.findById(nodeId).select("name rootOwner children").lean();
    if (!root?.rootOwner) return;

    // Don't overwrite a name the user or AI already set
    if (!GENERIC_NAMES.has(root.name)) return;

    // Read tree content for context
    const children = await Node.find({ parent: nodeId })
      .select("name children").lean();

    let summary = `Extension: ${extName}\nChildren: ${children.map(c => c.name).join(", ")}`;

    // Read grandchildren for more context (topics, exercises, substances, etc.)
    const grandchildIds = children.flatMap(c => c.children || []);
    if (grandchildIds.length > 0) {
      const grandchildren = await Node.find({ _id: { $in: grandchildIds.slice(0, 20) } })
        .select("name").lean();
      if (grandchildren.length > 0) {
        summary += `\nTopics/Items: ${grandchildren.map(g => g.name).join(", ")}`;
      }
    }

    // One background LLM call
    if (!runChat) return;
    try {
      const { answer } = await runChat({
        userId: String(root.rootOwner),
        username: "system",
        message: `Rename this tree. Return ONLY the new name. 2-4 words. No quotes. No explanation.\n\n${summary}\n\nExamples: "Strength Training", "Keto Tracking", "Learning React", "Nicotine Recovery", "Team Wiki"`,
        mode: "home:default",
        llmPriority: core.llm.LLM_PRIORITY.BACKGROUND,
      });

      const newName = (answer || "").trim().replace(/^["']|["']$/g, "").slice(0, 60);
      if (newName && newName.length >= 2 && newName !== root.name) {
        await Node.findByIdAndUpdate(nodeId, { $set: { name: newName } });
        log.info("DynamicRename", `Renamed "${root.name}" to "${newName}"`);
      }
    } catch (err) {
      log.debug("DynamicRename", `Rename failed for ${nodeId}: ${err.message}`);
    }
  }, "dynamic-rename");

  log.info("DynamicRename", "Loaded. Trees get named after setup.");
  return {};
}
