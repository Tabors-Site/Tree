export default {
  name: "gateway-tree",
  version: "1.0.1",
  builtFor: "treeos-connect",
  description:
    "Tree-to-tree gateway channel. Connects a tree on this land to a tree on " +
    "another land, without Canopy federation. Canopy is infrastructure-level " +
    "peering between land operators. Gateway-tree is user-level connection " +
    "between tree owners. You don't need your land operator to peer with their " +
    "land operator. You just need your tree to talk to their tree. " +
    "\n\n" +
    "The channel handles auth, rate limiting, and energy through the existing " +
    "gateway framework. Two users connect their trees without any admin involvement. " +
    "Land A's tree writes a note. The gateway-tree channel formats it and POSTs it " +
    "to Land B's receiver endpoint. Land B's gateway processes it through the normal " +
    "conversation loop. The AI responds. The response flows back in the HTTP response. " +
    "Land A receives the reply as a gateway result. " +
    "\n\n" +
    "Output: sends tree content to a remote tree as a gateway message. The local " +
    "tree's cascade signals, notes, or AI outputs become input for the remote tree. " +
    "Input: receives messages from remote trees. The remote tree's output arrives " +
    "as a gateway message on this land. processGatewayMessage fires. The AI at the " +
    "connected node reads it, generates a response, and the response is returned " +
    "to the caller in the HTTP response body. " +
    "\n\n" +
    "Input-output: bidirectional. Both trees talk to each other. A research tree " +
    "on Land A asks questions. A knowledge tree on Land B answers. The conversation " +
    "history lives on both sides as notes and contributions. Two trees, two lands, " +
    "one conversation. No admin involvement. No federation required. " +
    "\n\n" +
    "Auth: the channel stores an API key or share token for the remote land. " +
    "The remote land's gateway-tree extension verifies it against the receiving " +
    "channel's webhook secret. Energy budget of the local channel owner covers " +
    "outbound calls. Energy budget of the remote channel owner covers AI processing. " +
    "Each side pays for its own work.",

  needs: {
    extensions: ["gateway"],
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
    env: [
      { key: "TREE_GATEWAY_SECRET", required: false, secret: true, autoGenerate: true, description: "Shared secret for verifying inbound tree-to-tree gateway messages" },
    ],
    cli: [],
  },
};
