export default {
  name: "backup",
  version: "1.0.0",
  description: "Full and snapshot backup/restore for lands",
  needs: {
    models: ["Node", "User", "Note", "Contribution"],
    services: ["hooks", "protocol"],
  },
  optional: {
    models: ["Chat"],
  },
  provides: {
    cli: [
      {
        command: "backup",
        description: "Backup and restore land data",
        subcommands: [
          { command: "full", description: "Full backup (all data)", bodyMap: { output: 0 } },
          { command: "snapshot", description: "Snapshot (structure + metadata only)", bodyMap: { output: 0 } },
          { command: "restore", description: "Restore from backup file", bodyMap: { file: 0 } },
          { command: "list", description: "List available backups" },
        ],
      },
    ],
    env: [],
  },
};
