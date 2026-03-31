export default {
  name: "transactions",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Nodes can trade value with each other. A transaction is a two-sided exchange: node A sends " +
    "values to node B, and node B sends values back to node A. Or one side is OUTSIDE, " +
    "representing an external source like a Solana wallet. The extension handles the full " +
    "lifecycle: proposal, approval, execution, and rejection." +
    "\n\n" +
    "Four approval policies govern who can authorize transactions on a tree. OWNER_ONLY: only " +
    "the root owner can approve. ANYONE: any contributor can approve with a single vote. " +
    "MAJORITY: more than half of all members (owner plus contributors) must approve. ALL: " +
    "unanimous consent required. The policy is set per tree root. The proposer auto-approves " +
    "their own side if they are an eligible approver. If that single approval satisfies the " +
    "policy, the transaction executes immediately without waiting." +
    "\n\n" +
    "Execution is atomic. Both sides are debited and credited in a single operation. If " +
    "either side has insufficient balance for what it is sending, the transaction fails and " +
    "is marked rejected. Values are read from and written to node metadata through the values " +
    "extension's storage format. Denial works symmetrically: an eligible approver can deny " +
    "instead of approve. Under OWNER_ONLY, ANYONE, or ALL policies, a single denial kills " +
    "the transaction. Under MAJORITY, denials must reach the same threshold as approvals." +
    "\n\n" +
    "Every state change is logged as a contribution on both participating nodes with full " +
    "metadata: which side, what role (proposer, approver, denier, system), which event " +
    "(created, approved, denied, execution_started, succeeded, failed, accepted_by_policy, " +
    "rejected_by_policy), and the values sent and received. The transaction detail endpoint " +
    "returns the full contribution timeline for audit.",

  needs: {
    services: ["contributions", "auth"],
    models: ["Node", "Contribution"],
  },

  optional: {
    services: ["energy"],
    extensions: ["html-rendering", "treeos-base"],
  },

  provides: {
    models: {
      Transaction: "./model.js",
    },
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {
      transaction: { cost: 1 },
    },
    sessionTypes: {},
    schemaVersion: 1,
    migrations: "./migrations.js",
    cli: [
      { command: "transactions", scope: ["tree"], description: "List transactions for current node", method: "GET", endpoint: "/node/:nodeId/:version/transactions" },
    ],
  },
};
