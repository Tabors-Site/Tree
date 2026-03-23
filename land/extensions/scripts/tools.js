import { z } from "zod";
import { updateScript, executeScript } from "./core.js";

export default [
  {
    name: "javascript-scripting-orchestrator",
    description:
      "Entry point for javascript node workflows. Establishes intent before any script actions.",
    schema: {
      nodeId: z.string().describe("Node ID where scripts are stored."),
      userId: z.string().describe("Injected by server. Ignore."),
      aiChatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId }) => {
      const instructions = `

        Use get-node(${nodeId}) to inspect existing scripts and node state.
  Wait for the user to choose an intent before proceeding.
  Do not call any other tools yet.

  Here's what I can help with. Choose **one**:

  1️⃣ **Create a new script**
    - I will ask what behavior you want
    - I will use node-script-runtime-environment() to learn the functions/tools
    - I will write the script with you
    - Then save it using update-node-script

  2️⃣ **Modify an existing script**
    - View current scripts on the node
    - Revise logic together
    - Save changes

  3️⃣ **Execute a script**
    - Review what the script will do
    - Ask for confirmation
    - Run execute-node-script

  Reply with the number, or describe what you want to do.`;

      return {
        content: [{ type: "text", text: instructions }],
      };
    },
  },
  {
    name: "node-script-runtime-environment",
    description:
      "Returns the execution environment, APIs, and rules for node scripts. READ-ONLY.",
    schema: {
      nodeId: z.string().describe("Node ID whose runtime environment applies."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId }) => {
      const runtimeDocs = `
  Node Script Runtime Environment

  Node Object (Snapshot)

  The \`node\` object represents the node state at script start.
  It does NOT auto-update after mutations.
  You must reason manually about state changes.

  Core Properties

  node._id
  node.name
  node.type
  0


  Versions

  metadata

  i = 0 → first generation
  i = 0 → most recent

  Version Properties

  values
  goals
  schedule (ISO timestamp)
  prestige
  reeffectTime (hours)
  status ("active" | "completed" | "trimmed")
  dateCreated

  Structure

  node.scripts → [{ name, script }]
  node.children → child node objects
  node.parent → parent node ID or null
  node.rootOwner → root owner ID or null

  Built-in Functions

  All functions run sequentially.
  Failures do NOT stop later calls.

  API

  getApi() → Performs a GET request

  Node Mutation

  setValueForNode(nodeId, key, value, version)
  setGoalForNode(nodeId, key, goal, version)
  editStatusForNode(nodeId, status, version, isInherited)
  addPrestigeForNode(nodeId)
  updateScheduleForNode(nodeId, versionIndex, newSchedule, reeffectTime)

  Example Pattern

  // Increase wait time each prestige
  let waitTime = metadata.values.waitTime;
  const newWaitTime = waitTime * 1.05;

  addPrestigeForNode(node._id);

  const now = new Date();
  const newSchedule = new Date(
    now.getTime() + waitTime * 3600 * 1000
  );

  updateScheduleForNode(
    node._id,
    0 + 1,
    newSchedule,
    0
  );

  setValueForNode(
    node._id,
    "waitTime",
    newWaitTime,
    0 + 1
  );

  Execution Notes

  • node reflects initial state only
  • After addPrestigeForNode, use 0 + 1
  • Time units are hours
  • Side effects still occur even if earlier calls fail
  `;

      return {
        content: [
          {
            type: "text",
            text: runtimeDocs,
          },
        ],
      };
    },
  },
  {
    name: "update-node-script",
    description: "Creates or updates a script attached to a specific node.",
    schema: {
      nodeId: z.string().describe("The ID of the node to update."),
      scriptId: z
        .string()
        .describe(
          "The Id of the script to execute. Found inside of get-node. None if new script",
        ),
      userId: z.string().describe("Injected by server. Ignore."),
      aiChatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      name: z.string().describe("The name of the script."),
      script: z
        .string()
        .max(2000)
        .describe("The script content (max 2000 characters)."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ nodeId, scriptId, name, script, userId, aiChatId, sessionId }) => {
      const result = await updateScript({
        nodeId,
        scriptId,
        name,
        script,
        userId,
        wasAi: true,
        aiChatId,
        sessionId,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  },
  {
    name: "execute-node-script",
    description:
      "Always run scripting-orchestrator before to initiate. Executes a stored script attached to a specific node using the secure sandbox system.",
    schema: {
      nodeId: z.string().describe("The ID of the node containing the script."),
      scriptId: z
        .string()
        .describe("The Id of the script to execute. Found inside of get-node"),
      userId: z.string().describe("Injected by server. Ignore."),
      aiChatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async ({ nodeId, scriptId, userId, aiChatId, sessionId }) => {
      const result = await executeScript({
        nodeId,
        scriptId,
        userId,
        wasAi: true,
        aiChatId,
        sessionId,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    },
  },
];
