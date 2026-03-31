export default [
  {
    name: "go-to",
    description:
      "Navigate to a node by name or intent. Searches across all trees. " +
      "Use when the user says 'go to workout', 'take me to food', 'navigate to study'. " +
      "Returns the destination node ID and path for navigation.",
    inputSchema: {
      type: "object",
      properties: {
        destination: {
          type: "string",
          description: "What to navigate to. Extension name, tree name, or node name.",
        },
      },
      required: ["destination"],
    },
  },
];
