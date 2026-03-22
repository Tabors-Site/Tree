/**
 * Scripts extension migrations.
 * Migration 1: Move scripts from node.scripts array to metadata.scripts.list
 */

export default [
  {
    version: 1,
    description: "Move scripts from node.scripts to metadata.scripts",
    async up(core) {
      const Node = core.models.Node;

      const nodes = await Node.find({
        "scripts.0": { $exists: true },
      });

      let migrated = 0;

      for (const node of nodes) {
        const list = node.scripts.map(s => ({
          _id: s._id,
          name: s.name,
          script: s.script,
        }));

        if (!node.metadata) node.metadata = new Map();

        if (node.metadata instanceof Map) {
          node.metadata.set("scripts", { list });
        } else {
          node.metadata.scripts = { list };
        }

        node.scripts = [];
        node.markModified("metadata");
        node.markModified("scripts");
        await node.save();
        migrated++;
      }

      console.log(`[scripts migration] Moved scripts for ${migrated} nodes`);
    },
  },
];
