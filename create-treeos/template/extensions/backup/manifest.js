export default {
  name: "backup",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Two backup modes. Full backup serializes every document in the database to a " +
    "single JSON file: nodes, users, notes, contributions, chats, LLM connections, " +
    "canopy peers, extension models. Snapshot backup captures only structure and " +
    "metadata, omitting note content and chat history, producing a smaller file " +
    "suitable for frequent automated runs." +
    "\n\n" +
    "Restore reads a backup file, validates its format, drops existing collections, " +
    "and rebuilds the database. After restore the extension triggers index rebuilds, " +
    "tree integrity checks, ancestor cache invalidation, and fires afterRestore so " +
    "other extensions can reinitialize. The restore flag is cleared automatically " +
    "after post-restore boot completes." +
    "\n\n" +
    "Automatic snapshots run on a configurable interval when backupInterval is set " +
    "in land config (milliseconds). Output directory is configurable via backupPath " +
    "(defaults to ./backups). All operations are admin-only.",

  needs: {
    models: ["Node", "User", "Note", "Contribution"],
  },
  optional: {
    models: ["Chat"],
  },
  provides: {
    routes: true,
    hooks: { fires: ["afterRestore"], listens: ["afterBoot"] },
    cli: [
      { command: "backup", scope: ["home"], description: "Full backup (all data)", method: "POST", endpoint: "/backup/full", bodyMap: { output: 0 } },
      { command: "backup-snapshot", scope: ["home"], description: "Snapshot (structure + metadata only)", method: "POST", endpoint: "/backup/snapshot", bodyMap: { output: 0 } },
      { command: "backup-restore", scope: ["home"], description: "Restore from backup file", method: "POST", endpoint: "/backup/restore", bodyMap: { file: 0 } },
      { command: "backup-list", scope: ["home"], description: "List available backups", method: "GET", endpoint: "/backup/list" },
    ],
    env: [],
  },
};
