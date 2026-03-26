export default {
  name: "backup",
  version: "1.0.0",
  description: "Full and snapshot backup/restore for lands",
  needs: {
    models: ["Node", "User", "Note", "Contribution"],
  },
  optional: {
    models: ["Chat"],
  },
  provides: {
    cli: [
      { command: "backup", description: "Full backup (all data)", method: "POST", endpoint: "/backup/full", bodyMap: { output: 0 } },
      { command: "backup-snapshot", description: "Snapshot (structure + metadata only)", method: "POST", endpoint: "/backup/snapshot", bodyMap: { output: 0 } },
      { command: "backup-restore", description: "Restore from backup file", method: "POST", endpoint: "/backup/restore", bodyMap: { file: 0 } },
      { command: "backup-list", description: "List available backups", method: "GET", endpoint: "/backup/list" },
    ],
    env: [],
  },
};
