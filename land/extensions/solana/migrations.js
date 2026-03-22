/**
 * Solana extension migrations.
 * Migration 1: Move wallet data from versions[].wallet to metadata.solana.wallets
 */

export default [
  {
    version: 1,
    description: "Move wallet data from versions[].wallet to metadata.solana",
    async up(core) {
      const Node = core.models.Node;

      // Find nodes that have wallet data in any version
      const nodes = await Node.find({
        "versions.wallet.publicKey": { $exists: true, $ne: null },
      });

      let migrated = 0;

      for (const node of nodes) {
        const wallets = {};
        let hasWallet = false;

        for (let i = 0; i < node.versions.length; i++) {
          const v = node.versions[i];
          if (v.wallet?.publicKey) {
            wallets[i] = {
              publicKey: v.wallet.publicKey,
              encryptedPrivateKey: v.wallet.encryptedPrivateKey,
              createdAt: v.wallet.createdAt,
            };
            hasWallet = true;

            // Clear old field
            v.wallet = undefined;
          }
        }

        if (hasWallet) {
          if (!node.metadata) node.metadata = new Map();
          const existing = node.metadata instanceof Map
            ? node.metadata.get("solana") || {}
            : node.metadata?.solana || {};
          existing.wallets = wallets;

          if (node.metadata instanceof Map) {
            node.metadata.set("solana", existing);
          } else {
            node.metadata.solana = existing;
          }

          node.markModified("metadata");
          node.markModified("versions");
          await node.save();
          migrated++;
        }
      }

      console.log(`[solana migration] Moved wallet data for ${migrated} nodes`);
    },
  },
];
