export default {
  name: "treeos-cascade",
  version: "1.0.0",
  type: "bundle",
  builtFor: "seed",
  description:
    "The nervous system. Eight extensions that make cascade real. " +
    "\n\n" +
    "Without this bundle, cascade is just a kernel hook that fires and nothing listens. " +
    "The kernel provides the primitive: when content is written at a cascade-enabled node, " +
    "fire onCascade. That's it. The kernel doesn't propagate. It doesn't filter. It doesn't " +
    "compress. It doesn't monitor. It fires one hook and trusts extensions to do the rest. " +
    "\n\n" +
    "With this bundle, signals propagate outward through children, cross lands through " +
    "Canopy peers, get filtered by each node's perspective so trees only drink what they " +
    "care about, get compressed into shared codebooks so repeated patterns don't waste " +
    "bandwidth, get monitored for gaps where signals expected a listener and found none, " +
    "get health-checked by pulse so you know the nervous system is alive, and get recorded " +
    "in flow so you can see what moved and when. " +
    "\n\n" +
    "Propagation moves signals through the tree and across lands. Perspective-filter lets " +
    "nodes declare what signals they accept. Sealed-transport encrypts signals for " +
    "cross-land delivery. Codebook compresses repeated signal patterns into shared " +
    "vocabulary. Gap-detection surfaces missing capabilities when signals find no listener. " +
    "Long-memory gives the tree persistent context across conversation sessions. Pulse " +
    "monitors cascade health and alerts when the nervous system degrades. Flow visualizes " +
    "signal movement through the tree. " +
    "\n\n" +
    "Every land that turns on cascadeEnabled wants this. It's the first bundle most " +
    "operators install after the base TreeOS extensions. " +
    "\n\n" +
    "Install: treeos ext install treeos-cascade",

  needs: {
    extensions: [
      "propagation",
    ],
  },

  optional: {
    extensions: [
      "perspective-filter",
      "sealed-transport",
      "codebook",
      "gap-detection",
      "long-memory",
      "pulse",
      "flow",
    ],
  },

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
