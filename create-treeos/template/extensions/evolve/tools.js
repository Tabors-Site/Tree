import { z } from "zod";
import { getPatterns, getProposals, dismissPattern, approveProposal, generateProposals } from "./core.js";

export default [
  {
    name: "evolve-status",
    description:
      "Show detected behavioral patterns and pending extension proposals. " +
      "The tree noticed what users do that no extension handles.",
    schema: {
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    handler: async () => {
      try {
        const patterns = await getPatterns();
        const proposals = await getProposals();

        if (patterns.length === 0 && proposals.length === 0) {
          return { content: [{ type: "text", text: "No patterns detected yet. The tree needs more usage data." }] };
        }

        const lines = [];
        if (patterns.length > 0) {
          lines.push(`Detected patterns (${patterns.length}):`);
          for (const p of patterns) {
            lines.push(`  [${p.id?.slice(0, 8)}] ${p.description} (${p.count}x, ${p.status})`);
          }
        }
        if (proposals.length > 0) {
          lines.push(`\nProposals (${proposals.length}):`);
          for (const p of proposals) {
            if (p.type === "install") {
              lines.push(`  [${p.id?.slice(0, 8)}] Install ${p.extensionName}${p.inRegistry ? " (in registry)" : " (not in registry)"}: ${p.reason}`);
            } else {
              lines.push(`  [${p.id?.slice(0, 8)}] New: "${p.spec?.name}" - ${p.spec?.description || p.reason}`);
            }
          }
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "evolve-dismiss",
    description: "Dismiss a detected pattern. The tree won't suggest it again.",
    schema: {
      patternId: z.string().describe("The pattern ID to dismiss."),
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    handler: async ({ patternId }) => {
      try {
        const result = await dismissPattern(patternId);
        if (!result) return { content: [{ type: "text", text: "Pattern not found." }] };
        return { content: [{ type: "text", text: `Dismissed: ${result.description}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
  {
    name: "evolve-approve",
    description: "Approve a proposal for building. Marks it as accepted.",
    schema: {
      proposalId: z.string().describe("The proposal ID to approve."),
      userId: z.string().describe("Injected by server. Ignore."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    handler: async ({ proposalId }) => {
      try {
        const result = await approveProposal(proposalId);
        if (!result) return { content: [{ type: "text", text: "Proposal not found." }] };
        if (result.type === "install") {
          return { content: [{ type: "text", text: `Approved: install ${result.extensionName}. Use land-ext-install to install it.` }] };
        }
        return { content: [{ type: "text", text: `Approved: "${result.spec?.name}" spec. Share it or build it.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Failed: ${err.message}` }] };
      }
    },
  },
];
