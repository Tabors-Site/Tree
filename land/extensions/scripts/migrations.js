/**
 * Scripts extension migrations.
 * Migration 1: Move scripts from node.scripts array to metadata.scripts.list
 */

export default [
  {
    version: 1,
    description: "Move scripts from node.scripts to metadata.scripts",
    async up(core) {
      const collection = core.models.Node.collection;

      const nodes = await collection.find(
        { "scripts.0": { $exists: true } },
        { projection: { _id: 1, scripts: 1, metadata: 1 } }
      ).toArray();

      let migrated = 0;

      for (const node of nodes) {
        const list = node.scripts.map(s => ({
          _id: s._id,
          name: s.name,
          script: s.script,
        }));

        const metadata = node.metadata || {};
        metadata.scripts = { list };

        await collection.updateOne(
          { _id: node._id },
          { $set: { metadata }, $unset: { scripts: "" } }
        );
        migrated++;
      }

      console.log(`[scripts migration] Moved scripts for ${migrated} nodes`);
    },
  },
];
