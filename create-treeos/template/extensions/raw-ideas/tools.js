import { z } from "zod";
import { getRawIdeas, convertRawIdeaToNote } from "./core.js";

const TimeWindowSchema = {
  startDate: z
    .string()
    .optional()
    .describe("ISO date/time. Include items created on or after this time."),
  endDate: z
    .string()
    .optional()
    .describe("ISO date/time. Include items created on or before this time."),
};

export default [
  {
    name: "raw-idea-filter-orchestrator",
    description: "Guides filtering and placing raw ideas into the tree. READ-ONLY.",
    schema: {
      userId: z
        .string()
        .describe("The user whose raw ideas will be processed."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({}) => {
      const instructions = `
You are entering **Raw Idea Filtering Mode**.

GOAL
Help the user take an unplaced raw idea and decide the *best hierarchical location* for it in their tree.
You must NEVER convert a raw idea automatically. Always wait for confirmation.

STEP-BY-STEP PROCESS

1️⃣ **Load Raw Ideas**
- Call get-raw-ideas-by-user(userId)
- Present a short list (titles or summaries).
- Ask the user which raw idea they want to process.
- If only one exists, you may auto-select it.

2️⃣ **Load User Roots**
- Call get-root-nodes-by-user(userId)
- If multiple roots exist:
  - Choose the most relevant root based on the raw idea
  - Ask the user to confirm or override

3️⃣ **Inspect Tree Structure**
- Call get-tree(rootId)
- Analyze where the raw idea logically belongs:

4️⃣ **Determine Best Placement**
- Decide:
  - Target node ID
- Explain *why* this location fits:
  - Purpose
  - Scope
  - Hierarchical logic

5️⃣ **Present Placement Proposal**
- Clearly state:
  - Raw idea summary
  - Target node name
- Ask the user explicitly:

  "Would you like me to convert this raw idea into a note under <Node Name>?"

6️⃣ **Wait for Confirmation**
- DO NOT call transfer-raw-idea-to-note yet.
- Only proceed if the user explicitly agrees.
- If confirmed:
  → call transfer-raw-idea-to-note(rawIdeaId, userId, nodeId)

RULES
- Never guess silently.
- Never place without consent.
- Never skip tree inspection.
- Prefer explaining structure over speed.
`;

      return {
        content: [{ type: "text", text: instructions }],
      };
    },
  },
  {
    name: "get-raw-ideas-by-user",
    description: "Fetches raw ideas (inbox) for a user. Read-only.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      limit: z
        .number()
        .optional()
        .describe("Optional limit for number of raw ideas by most recent."),
      ...TimeWindowSchema,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async ({ userId, limit, startDate, endDate }) => {
      try {
        if (typeof limit === "number" && limit > 30) {
          limit = 30;
        }

        const result = await getRawIdeas({
          userId,
          limit,
          startDate,
          endDate,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.rawIdeas, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch raw ideas: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
  {
    name: "transfer-raw-idea-to-note",
    description: "Converts a raw idea into a note on a specific node/version.",
    schema: {
      rawIdeaId: z.string().describe("ID of the raw idea to place."),
      userId: z.string().describe("Injected by server. Ignore."),
      chatId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      sessionId: z
        .string()
        .nullable()
        .optional()
        .describe("Injected by server. Ignore."),
      nodeId: z.string().describe("Target node ID."),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async ({ rawIdeaId, userId, nodeId, chatId, sessionId }) => {
      try {
        const result = await convertRawIdeaToNote({
          rawIdeaId,
          userId,
          nodeId,
          wasAi: true,
          chatId,
          sessionId,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to place raw idea: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
];
