/**
 * Transactions extension migrations.
 * Migration 1: Move transactionPolicy from Node field to metadata.transactions.policy
 */

export default [
  {
    version: 1,
    description: "Move transactionPolicy from Node schema to metadata.transactions",
    async up(core) {
      const Node = core.models.Node;

      // Find root nodes that have a non-default transactionPolicy
      const nodes = await Node.find({
        transactionPolicy: { $exists: true, $nin: [null, "OWNER_ONLY"] },
      });

      let migrated = 0;

      for (const node of nodes) {
        if (!node.metadata) node.metadata = new Map();

        const existing = node.metadata instanceof Map
          ? node.metadata.get("transactions") || {}
          : node.metadata?.transactions || {};

        existing.policy = node.transactionPolicy;

        if (node.metadata instanceof Map) {
          node.metadata.set("transactions", existing);
        } else {
          node.metadata.transactions = existing;
        }

        node.markModified("metadata");
        await node.save();
        migrated++;
      }

      console.log(`[transactions migration] Moved policy for ${migrated} root nodes`);
    },
  },
];
