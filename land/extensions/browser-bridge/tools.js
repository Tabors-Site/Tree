/**
 * Browser Bridge Tools
 *
 * 7 MCP tools the AI can call to interact with the user's browser.
 * Read tools: always allowed. Write tools: site-scoped, approve-gated.
 */

import { z } from "zod";
import { sendRequest, isConnected, getCurrentUrl, checkSiteAccess, logAction } from "./core.js";

function requireBrowser(userId) {
  if (!isConnected(userId)) {
    throw new Error("No browser connected. The user needs to install the TreeOS Chrome extension and connect it.");
  }
}

export default function getTools() {
  return [
    // ── READ TOOLS ──────────────────────────────────────────────────

    {
      name: "browser-get-state",
      description:
        "Get the current page's accessibility tree from the user's browser. " +
        "Returns interactive elements with IDs (e1, e2, etc.) that can be used with browser-click and browser-type. " +
        "Call this first to understand what's on the page before taking any action.",
      annotations: { readOnlyHint: true },
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
      },
      handler: async ({ userId }) => {
        requireBrowser(userId);
        const result = await sendRequest(userId, "getPageState", {});
        return typeof result === "string" ? result : JSON.stringify(result);
      },
    },

    {
      name: "browser-extract",
      description:
        "Extract the text content of the current page. Returns clean text without HTML markup. " +
        "Use for reading articles, documentation, wiki pages, or any text-heavy content.",
      annotations: { readOnlyHint: true },
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
      },
      handler: async ({ userId }) => {
        requireBrowser(userId);
        const result = await sendRequest(userId, "executeAction", {
          action: { type: "extract" },
        });
        return typeof result === "string" ? result : JSON.stringify(result);
      },
    },

    {
      name: "browser-screenshot",
      description:
        "Take a screenshot of the current browser tab. Returns base64 encoded image data. " +
        "Use to see what the user sees, verify page state, or capture visual content.",
      annotations: { readOnlyHint: true },
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
      },
      handler: async ({ userId }) => {
        requireBrowser(userId);
        const result = await sendRequest(userId, "screenshot", {});
        return typeof result === "string" ? result : JSON.stringify(result);
      },
    },

    // ── WRITE TOOLS ─────────────────────────────────────────────────

    {
      name: "browser-click",
      description:
        "Click an element in the user's browser. Use the element ID from browser-get-state (e.g. 'e5'). " +
        "Always call browser-get-state first to see available elements and their IDs.",
      annotations: { readOnlyHint: false, destructiveHint: true },
      schema: {
        elementId: z.string().describe("Element ID from the accessibility tree (e.g. 'e5')"),
        nodeId: z.string().describe("Injected by server. Ignore."),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      handler: async ({ elementId, nodeId, userId }) => {
        requireBrowser(userId);
        const result = await sendRequest(userId, "executeAction", {
          action: { type: "click", elementId },
        });
        await logAction(nodeId, userId, { type: "click", elementId }, getCurrentUrl(userId), result);
        return typeof result === "string" ? result : JSON.stringify(result);
      },
    },

    {
      name: "browser-type",
      description:
        "Type text into an input field in the user's browser. Use the element ID from browser-get-state. " +
        "The element must be a text input, textarea, or contenteditable element.",
      annotations: { readOnlyHint: false, destructiveHint: true },
      schema: {
        elementId: z.string().describe("Element ID of the input field (e.g. 'e12')"),
        text: z.string().describe("Text to type into the field"),
        nodeId: z.string().describe("Injected by server. Ignore."),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      handler: async ({ elementId, text, nodeId, userId }) => {
        requireBrowser(userId);
        const result = await sendRequest(userId, "executeAction", {
          action: { type: "type", elementId, text },
        });
        await logAction(nodeId, userId, { type: "type", elementId }, getCurrentUrl(userId), result);
        return typeof result === "string" ? result : JSON.stringify(result);
      },
    },

    {
      name: "browser-navigate",
      description:
        "Navigate the user's browser to a URL. Use for opening documentation, websites, or web apps. " +
        "The URL must be allowed by the site scoping configuration at this tree position.",
      annotations: { readOnlyHint: false, destructiveHint: true },
      schema: {
        url: z.string().describe("The URL to navigate to"),
        nodeId: z.string().describe("Injected by server. Ignore."),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      handler: async ({ url, nodeId, userId }) => {
        requireBrowser(userId);
        // Check site access against the TARGET url specifically
        const access = await checkSiteAccess(nodeId, url);
        if (access.blocked) {
          return `Blocked: ${access.reason}. This site is not allowed at this tree position.`;
        }
        const result = await sendRequest(userId, "executeAction", {
          action: { type: "navigate", url },
        });
        await logAction(nodeId, userId, { type: "navigate", url }, url, result);
        return typeof result === "string" ? result : JSON.stringify(result);
      },
    },

    {
      name: "browser-scroll",
      description:
        "Scroll the page in the user's browser. Use to reveal more content below or above the current viewport.",
      annotations: { readOnlyHint: false },
      schema: {
        direction: z.enum(["up", "down", "left", "right"]).describe("Scroll direction"),
        amount: z.number().optional().describe("Pixels to scroll. Default: one viewport height."),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      handler: async ({ direction, amount, userId }) => {
        requireBrowser(userId);
        const result = await sendRequest(userId, "executeAction", {
          action: { type: "scroll", direction, amount },
        });
        return typeof result === "string" ? result : JSON.stringify(result);
      },
    },
  ];
}
