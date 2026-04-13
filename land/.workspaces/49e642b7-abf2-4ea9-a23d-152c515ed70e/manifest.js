export default {
  name: "todo",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Track todos as nodes in your tree. Add, toggle completion, and remove todos. " +
    "Each todo is a node with completion status in metadata. Simple, persistent, tree-native.",

  territory: "tasks, to-dos, things to do, actionable items, checklists",

  vocabulary: {
    verbs: [
      /\b(todo|todos?|task|tasks?|add|add.*todo|create.*todo|complete.*todo|finish.*todo|cross.*off|check.*off)\b/i,
      /\b(done|finish|complete|check|toggle|mark)\b/i,
    ],
    nouns: [
      /\b(todo|todos?|task|tasks?|thing|things?|checklist|checklists?|item|items?|action)\b/i,
    ],
    adjectives: [
      /\b(pending|completed|done|unchecked|checked|incomplete)\b/i,
    ],
  },

  needs: {
    models: ["Node", "Note"],
    services: ["metadata"],
  },

  optional: {
    extensions: ["treeos-base"],
  },

  provides: {
    tools: true,
  },
};
