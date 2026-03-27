export default {
  name: "treeos-intelligence",
  version: "1.0.0",
  type: "bundle",
  builtFor: "kernel",
  description:
    "Self-awareness. Four extensions that teach the tree to know itself. " +
    "\n\n" +
    "Without this bundle, a tree holds data and an AI talks about it. The AI " +
    "reads notes, navigates branches, answers questions. But the tree doesn't " +
    "know what it knows. It doesn't notice when two branches contradict each " +
    "other. It doesn't realize when a sprawling subtree could be compressed " +
    "into a cleaner structure. It doesn't learn which organizational patterns " +
    "work and which ones the user always restructures. It doesn't build a " +
    "model of who you are from how you interact with it. " +
    "\n\n" +
    "With this bundle, the tree develops self-awareness. " +
    "\n\n" +
    "Tree-compress monitors tree density and structure. When a subtree grows " +
    "beyond its usefulness, when branches duplicate meaning, when depth exceeds " +
    "navigability, compression suggests or executes structural consolidation. " +
    "It keeps trees from outgrowing the humans who tend them. A tree that can " +
    "prune itself stays useful. One that can't becomes a graveyard of good " +
    "intentions buried under layers of abandoned branches. " +
    "\n\n" +
    "Contradiction detects conflicting truths held in different parts of the tree. " +
    "A goal node says 'ship by March.' A plan node says 'Q3 delivery.' A status " +
    "node says 'blocked on legal review.' These live in different branches. No " +
    "single prompt sees all three. Contradiction scans across branches, surfaces " +
    "conflicts, and lets the user or the AI resolve them. A tree that silently " +
    "holds contradictions is a tree that lies by omission. " +
    "\n\n" +
    "Inverse-tree builds a model of the user from their interaction patterns. " +
    "Which branches do they visit? Which do they ignore? What types of nodes " +
    "do they create versus which do they delete? What questions do they ask? " +
    "The inverse tree is not the user's data. It's the shape of the user's " +
    "attention. It lives in metadata, never in the tree structure itself. " +
    "It informs how the AI responds, what it surfaces first, what it knows " +
    "the user cares about without being told every session. " +
    "\n\n" +
    "Evolution tracks structural changes over time. Which reorganizations " +
    "stuck? Which got reverted? Which node types survive and which get deleted " +
    "within days? Evolution teaches the tree how to grow by observing how the " +
    "user shapes it. Over time, the AI's structure suggestions improve because " +
    "they're informed by what actually worked, not by generic best practices. " +
    "\n\n" +
    "Intent is the capstone. It reads from every other intelligence extension. " +
    "Without them it has nothing to observe. With them it's the autonomous engine. " +
    "It synthesizes pulse health, evolution fitness, contradiction state, codebook " +
    "density, gap detection, and inverse-tree profiles into a queue of actions the " +
    "tree takes on its own. The tree doesn't sleep anymore. It grows while you're away. " +
    "\n\n" +
    "This bundle is for operators who want their land to be more than storage " +
    "with AI on top. It's the difference between a tree that holds data and a " +
    "tree that understands its own data. " +
    "\n\n" +
    "Install: treeos ext install treeos-intelligence",

  needs: {
    extensions: [
      "tree-compress",
      "contradiction",
      "inverse-tree",
      "evolution",
      "intent",
      "embed",
      "scout",
      "explore",
      "trace",
      "boundary",
      "competence",
      "phase",
    ],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
  },
};
