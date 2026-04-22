// Direct test: invoke runBranchSwarm with a fake runBranch closure that
// logs the session.currentNodeId at multiple points. This bypasses the
// classifier and hits the actual dispatch code path I changed.

import "dotenv/config";
import mongoose from "mongoose";
const MONGO_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/treeos";
await mongoose.connect(MONGO_URI);

// Boot extensions so swarm + plan are loaded.
const { default: services } = await import("./seed/services.js");
const { initLandRoot } = await import("./seed/landRoot.js");
const land = await initLandRoot();
const { loadExtensions } = await import("./extensions/loader.js");
await loadExtensions({ services: services({ land }), land });
console.log("Extensions loaded");

const { setCurrentNodeId, getCurrentNodeId } = await import("./seed/llm/conversation.js");
const { getExtension } = await import("./extensions/loader.js");
const swarm = getExtension("swarm")?.exports;
if (!swarm) { console.error("swarm not loaded"); process.exit(1); }

// Use real flaptest node id.
const Node = (await import("./seed/models/node.js")).default;
const flap = await Node.findOne({ name: "flaptest" }).lean();
console.log("flaptest:", flap._id);

// Initialize flaptest as a swarm project (sets role=project, plan namespace).
await swarm.ensureProject({ rootId: flap._id, systemSpec: "test compound" });

// Define a fake runBranch closure that logs the session's currentNodeId
// at the moments my pin should affect.
const visitorId = `test-pin:${Date.now()}`;
const fakeRunBranch = async ({ mode, branchNodeId, message }) => {
  console.log(`\n=== fakeRunBranch CALLED ===`);
  console.log(`  branchNodeId param =`, branchNodeId);
  console.log(`  visitorId =`, visitorId);
  console.log(`  Before any pinning: getCurrentNodeId =`, getCurrentNodeId(visitorId));

  // SIMULATE what dispatch.js's runBranch closure does:
  setCurrentNodeId(visitorId, String(branchNodeId));
  console.log(`  After setCurrentNodeId(branch): getCurrentNodeId =`, getCurrentNodeId(visitorId));

  // Re-pin (my belt+suspenders)
  setCurrentNodeId(visitorId, String(branchNodeId));
  console.log(`  After re-pin: getCurrentNodeId =`, getCurrentNodeId(visitorId));

  return { answer: "fake done" };
};

// Build a tiny plan with one branch.
const branches = [
  { name: "testbranch", spec: "test branch spec", path: "testbranch", files: ["foo.js"], mode: "tree:code-plan" },
];

console.log("\n=== Calling runBranchSwarm ===");
const result = await swarm.runBranchSwarm({
  branches,
  rootProjectNode: flap,
  rootChatId: null,
  sessionId: "test-session",
  visitorId,
  userId: "test-user",
  username: "tabor",
  rootId: flap._id,
  signal: null,
  slot: null,
  socket: null,
  userRequest: "test compound",
  rt: null,
  emitStatus: () => {},
  runBranch: fakeRunBranch,
  defaultBranchMode: "tree:code-plan",
});

console.log("\n=== Result ===");
console.log("success:", result.success);
console.log("results:", JSON.stringify(result.results, null, 2));

await mongoose.disconnect();
process.exit(0);
