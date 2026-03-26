export default {
  name: "codebook",
  version: "1.0.0",
  description:
    "What makes two nodes faster together over time. Listens to afterNote on any node. Tracks " +
    "conversation patterns between specific users and specific nodes. When patterns recur, when " +
    "the same concepts are referenced repeatedly, when shorthand emerges, the extension " +
    "periodically runs a compression pass. The compression pass is an AI call using runChat. " +
    "The prompt says: here are the last N conversations at this node with this user, extract " +
    "recurring concepts, shorthand, compressed references, and produce a dictionary. The " +
    "dictionary writes to metadata.codebook on the node, namespaced per user. enrichContext " +
    "injects the codebook into the AI system prompt when that user is active at that node. " +
    "The AI picks up the compressed language without needing the full conversation history. " +
    "The codebook is the relationship memory. Dense. Compact. Earned through repeated " +
    "interaction. The dependency on long memory is soft but important. Long memory tells the " +
    "codebook extension which relationships are active and how frequently nodes interact. " +
    "Without long memory, codebook would have to track all of that itself. With long memory, " +
    "it reads metadata.memory and knows which node-user pairs have enough history to justify " +
    "a compression pass. The compression runs after a threshold of new conversations, not " +
    "after every note. Most notes do not trigger compression. Only when enough new material " +
    "has accumulated does the extension spend tokens to update the codebook.",

  needs: {
    models: ["Node"],
  },

  optional: {
    extensions: ["long-memory"],
  },

  provides: {
    models: {},
    routes: false,
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],

    hooks: {
      fires: [],
      listens: ["afterNote", "enrichContext"],
    },
  },
};
