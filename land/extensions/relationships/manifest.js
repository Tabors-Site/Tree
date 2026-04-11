export default {
  name: "relationships",
  version: "1.0.1",
  builtFor: "TreeOS",
  description:
    "People in your life. Track who matters, what you did for them, what you " +
    "can do. Anytime you mention someone by name, the tree notices. Each person " +
    "gets a node. Interactions log what happened. Ideas capture things you want " +
    "to do for people. The AI builds awareness of your social world over time. " +
    "Type 'be' for a guided check-in: who haven't you reached out to lately?",

  territory: "people, friends, family, relationships, social interactions, someone, they, them",
  classifierHints: [
    /\b(my (mom|dad|brother|sister|wife|husband|partner|friend|boss|coworker|son|daughter|uncle|aunt|grandma|grandpa))\b/i,
    /\b(talked to|hung out|met with|called|texted|visited|saw|ran into)\b/i,
    /\b(birthday|anniversary|gift|favor|help them|check on|reach out|catch up)\b/i,
    /\b(relationships?|people|person|friends?|family|colleague)\b/i,
  ],

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "llm", "metadata"],
  },

  optional: {
    extensions: [
      "channels",
      "html-rendering",
      "treeos-base",
    ],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    modes: true,

    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },

    cli: [
      {
        command: "rel [message...]",
        scope: ["tree"],
        description: "Relationships. Talk about people.",
        method: "POST",
        endpoint: "/root/:rootId/chat",
        body: ["message"],
      },
    ],
  },
};
