import { z } from "zod";
import mongoose from "mongoose";
import {
  createUnderstandingRun,
  listUnderstandingRuns,
  getNextCompressionPayloadForLLM,
  commitCompressionResult,
} from "./core.js";

export default [
  {
    name: "understanding-create",
    description: "Create an understanding run (shadow tree + merge rules).",
    schema: {
      rootNodeId: z.string().describe("Root node to build understanding from."),
      perspective: z
        .string()
        .optional()
        .default("general")
        .describe("Perspective for this understanding run."),
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
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async ({ rootNodeId, perspective, userId, aiChatId, sessionId }) => {
      const result = await createUnderstandingRun(
        rootNodeId,
        userId,
        perspective,
        true,
        aiChatId,
        sessionId,
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                message: "Understanding run created",
                ...result,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    name: "understanding-list",
    description: "Lists existing understanding runs (perspectives) for a given root node.",
    schema: {
      rootNodeId: z
        .string()
        .describe("Root node ID to list understandings for."),
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
    handler: async ({ rootNodeId }) => {
      try {
        const data = await listUnderstandingRuns(rootNodeId);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to list understandings: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    },
  },
  {
    name: "understanding-next",
    description: "Get the next summarization payload for the LLM.",
    schema: {
      understandingRunId: z.string().describe("UnderstandingRun ID."),
      rootNodeId: z.string().describe("Root node of this understanding run"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async ({ understandingRunId, rootNodeId }) => {
      // 1. Load run to get perspective (authoritative)
      const run = await mongoose.models.UnderstandingRun.findById(understandingRunId).lean();
      if (!run) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "UnderstandingRun not found" },
                null,
                2,
              ),
            },
          ],
        };
      }

      // 2. Get next compression payload (pure logic)
      const payload = await getNextCompressionPayloadForLLM(understandingRunId);

      if (!payload) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  done: true,
                  message: "No more summarization steps remaining.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // 3. Build explicit LLM instructions (THIS IS THE KEY)
      const instructions = `
You are performing a summarization step for an "understanding run".

Perspective:
"${run.perspective}"
CRITICAL RULES:
- You MUST NOT invent or guess any IDs or layer numbers.
- For LEAF mode:
  - Use mode = "leaf"
  - Use understandingNodeId exactly as provided in target.understandingNodeId
  - Do NOT provide currentLayer (it will be assumed as 0)
- For MERGE mode:
  - Use mode = "merge"
  - You MUST set currentLayer EXACTLY equal to target.nextLayer
  - Do NOT change or recompute the layer number

Summarization Rules:
- Summarize STRICTLY from this perspective.
- Ignore information not relevant to this perspective.
- Preserve key facts, definitions, procedures, and distinctions.
- Do NOT add new information.
- Do NOT speculate or infer beyond the inputs.
- Output must be suitable for hierarchical merging.

Return ONLY the summary text. The system will handle structure.
Then IMMEDIATELY call understanding-capture with:
  mode: "${payload.mode}"
  understandingRunId: "${understandingRunId}"
  rootNodeId: "${rootNodeId}"
  ${
    payload.mode === "leaf"
      ? `understandingNodeId: "${payload.target.understandingNodeId}"`
      : `currentLayer: ${payload.target.nextLayer}`
  }
  encoding: <your summary>
`.trim();

      // 4. Attach instructions to payload (LLM-facing)
      const llmPayload = {
        ...payload,
        instructions,
      };

      // 5. Return to LLM
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(llmPayload, null, 2),
          },
        ],
      };
    },
  },
  {
    name: "understanding-capture",
    description: "capture a summarized understanding result.",
    schema: {
      mode: z.enum(["leaf", "merge"]),

      understandingRunId: z.string(),

      // leaf only
      understandingNodeId: z.string().optional(),
      rootNodeId: z.string().describe("Root node of this understanding run"),

      // merge only
      currentLayer: z
        .number()
        .optional("EXACTLY equal to target.nextLayer from next"),

      encoding: z.string(),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async ({
      mode,
      understandingRunId,
      understandingNodeId,
      currentLayer,
      encoding,
      rootNodeId,
      userId,
      aiChatId,
      sessionId,
    }) => {
      await commitCompressionResult({
        mode,
        understandingRunId,
        understandingNodeId,
        currentLayer,
        encoding,
        userId,
        wasAi: true,
        aiChatId,
        sessionId,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                message: "Understanding captured successfully",
                mode,
                understandingRunId,
                understandingNodeId,
                currentLayer,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  },
  {
    name: "understanding-process",
    description:
      "Process understanding: commits previous summary (if any) and returns next task. IMMEDIATELY call this tool again with your summary — do not output to chat.",
    schema: {
      understandingRunId: z.string().describe("The understanding run ID"),
      rootNodeId: z.string().describe("Root node ID"),
      previousResult: z
        .object({
          mode: z.enum(["leaf", "merge"]),
          encoding: z.string().describe("Your summary text goes here"),
          understandingNodeId: z
            .string()
            .optional()
            .describe("From target.understandingNodeId"),
          currentLayer: z
            .number()
            .optional()
            .describe("Required for merge mode — from target.nextLayer"),
        })
        .optional()
        .describe(
          "Omit on first call. Include your summary from previous task on subsequent calls.",
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
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async ({
      understandingRunId,
      rootNodeId,
      previousResult,
      userId,
      aiChatId,
      sessionId,
    }) => {
      // 1. Commit previous result if provided
      if (previousResult) {
        try {
          await commitCompressionResult({
            mode: previousResult.mode,
            understandingRunId,
            encoding: previousResult.encoding,
            understandingNodeId: previousResult.understandingNodeId,
            currentLayer: previousResult.currentLayer,
            userId,
            wasAi: true,
            aiChatId,
            sessionId,
          });
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    error: "Failed to commit previous result",
                    details: err.message,
                    action: "Fix the parameters and retry.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      }

      // 2. Load run
      const run = await mongoose.models.UnderstandingRun.findById(understandingRunId).lean();
      if (!run) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { error: "UnderstandingRun not found" },
                null,
                2,
              ),
            },
          ],
        };
      }

      // 3. Get next payload
      const payload = await getNextCompressionPayloadForLLM(
        understandingRunId,
        userId,
      );

      // 4. Done
      if (!payload) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  done: true,
                  understandingRunId,
                  message:
                    "Understanding complete. All nodes summarized to root.",
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // 5. Build response — INSTRUCTION FIRST then data.
      //    LLMs attend to the beginning. Leading with a clear action
      //    prevents the model from outputting JSON as chat text.
      const isLeaf = payload.mode === "leaf";

      const lines = [
        `ACTION: Summarize, then CALL understanding-process. Do NOT write to chat.`,
        ``,
        `Perspective: "${run.perspective}"`,
        `Mode: ${payload.mode}`,
        ``,
        `Your next tool call MUST be:`,
        `  understanding-process(`,
        `    understandingRunId: "${understandingRunId}",`,
        `    rootNodeId: "${rootNodeId}",`,
        `    previousResult: {`,
        `      mode: "${payload.mode}",`,
        `      encoding: "<YOUR SUMMARY>",`,
        `      understandingNodeId: "${payload.target.understandingNodeId}"${isLeaf ? "" : ","}`,
      ];

      if (!isLeaf) {
        lines.push(`      currentLayer: ${payload.target.nextLayer}`);
      }

      lines.push(`    }`);
      lines.push(`  )`);
      lines.push(``);

      if (isLeaf) {
        lines.push(`Summarize these notes:`);
      } else {
        lines.push(
          `Merge these child summaries into one summary for node "${payload.inputs[0]?.nodeName}":`,
        );
      }

      lines.push(``);
      lines.push(JSON.stringify(payload.inputs, null, 2));

      return {
        content: [
          {
            type: "text",
            text: lines.join("\n"),
          },
        ],
      };
    },
  },
];
