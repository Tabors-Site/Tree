export default {
  name: "boundary",
  version: "1.0.0",
  description:
    "The tree knows where one concern ends and another begins. Branches grow " +
    "organically. Over time the edges blur. Authentication code creeps into the " +
    "API branch. Nutrition notes scatter across fitness, cooking, and health. " +
    "A project plan fragment sits orphaned under a personal journal entry. The " +
    "tree holds all of it but nobody mapped the zones. " +
    "\n\n" +
    "Boundary does structural cohesion analysis. For a given tree or subtree, it " +
    "extracts the topic of each branch by examining node names, note content, " +
    "compress essences, and codebook relationships. Then it builds a similarity " +
    "matrix comparing all sibling branches pairwise. If the embed extension is " +
    "installed, similarity uses vector cosine distance. Otherwise it falls back " +
    "to LLM-based semantic comparison. " +
    "\n\n" +
    "Three patterns detected. Blurred boundaries: two sibling branches overlap " +
    "significantly on the same topic. The user created both but didn't realize " +
    "they're doing the same work in two places. Fragmented concepts: the same " +
    "topic appears in three or more disconnected branches. Nobody consolidated. " +
    "Orphaned nodes: individual nodes whose content is semantically distant from " +
    "their parent branch's topic. A node about SSL certificates sitting under " +
    "Marketing. It ended up there by accident and nobody moved it. " +
    "\n\n" +
    "Orphan detection degrades gracefully based on available infrastructure. " +
    "With embed installed, per-node analysis runs on any branch size via cosine " +
    "math. Without embed on small branches (20 nodes or fewer), LLM batch queries " +
    "handle it. Without embed on large branches, per-node orphan detection is " +
    "skipped entirely. The report notes the gap and suggests installing embed. " +
    "Branch-level patterns (blurred, fragmented) always run regardless. " +
    "\n\n" +
    "Each branch gets a coherence score from 0 to 1. How tightly focused is the " +
    "content? Low coherence means the branch mixes multiple concerns. High means " +
    "every node in the branch is about the same thing. The tree root gets an " +
    "overall coherence score. " +
    "\n\n" +
    "Findings feed directly into reroot. Orphaned nodes become move candidates. " +
    "Fragmented concepts become consolidation targets. Blurred boundaries become " +
    "merge suggestions. Boundary tells reroot WHY to move things instead of " +
    "asking the AI to guess. Evidence-based reorganization instead of vibes. " +
    "\n\n" +
    "enrichContext injects boundary findings so the AI knows about structural " +
    "issues at the current position. afterNote marks the analysis as stale when " +
    "content changes. The analysis is on-demand or scheduled through the " +
    "optional background job. Not at boot. Trees don't need boundary analysis " +
    "every time the land restarts.",

  needs: {
    services: ["llm", "hooks", "contributions"],
    models: ["Node", "Note"],
  },

  optional: {
    services: ["energy"],
    extensions: ["embed", "reroot", "evolution", "codebook", "tree-compress"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: true,
    orchestrator: false,
    energyActions: {
      boundaryAnalyze: { cost: 3 },
      boundaryBranchScan: { cost: 1 },
    },
    sessionTypes: {},

    hooks: {
      fires: [],
      listens: ["enrichContext", "afterNote"],
    },

    cli: [
      {
        command: "boundary [action]",
        description:
          "Structural cohesion analysis. Actions: status, branch.",
        method: "POST",
        endpoint: "/root/:rootId/boundary/analyze",
        subcommands: {
          status: {
            method: "GET",
            endpoint: "/root/:rootId/boundary",
            description: "Last analysis results and coherence scores",
          },
          branch: {
            method: "POST",
            endpoint: "/node/:nodeId/boundary/analyze",
            description: "Analyze from current node down (subtree only)",
          },
        },
      },
    ],
  },
};
