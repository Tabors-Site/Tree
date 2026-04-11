/**
 * Browser Bridge Tools
 *
 * 7 MCP tools the AI can call to interact with the user's browser.
 * Read tools: always allowed. Write tools: site-scoped, approve-gated.
 */

import { z } from "zod";
import { sendRequest, isConnected, getCurrentUrl, checkSiteAccess, logAction } from "./core.js";

function text(str) {
  return { content: [{ type: "text", text: String(str) }] };
}

function json(data) {
  const str = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return text(truncate(str));
}

// Cap tool results to prevent token overload
const MAX_RESULT_CHARS = 6000;

function truncate(str) {
  if (typeof str !== "string") str = JSON.stringify(str, null, 2);
  if (str.length > MAX_RESULT_CHARS) {
    return str.slice(0, MAX_RESULT_CHARS) + "\n\n[truncated, " + str.length + " total chars. Page is large. Use browser-extract for text content or ask about specific elements.]";
  }
  return str;
}

function requireBrowser(userId) {
  if (!isConnected(userId)) {
    throw new Error("No browser connected. The user needs to install the TreeOS Chrome extension and connect it.");
  }
}

export default function getTools() {
  return [
    // ── READ TOOLS ──────────────────────────────────────────────────

    {
      name: "browser-read",
      description:
        "Read the current page in the user's browser. Returns the page URL, title, text content, " +
        "and interactive elements with IDs (e1, e2, etc.) for clicking and typing. " +
        "Call this first to understand what's on the page before taking any action.",
      annotations: { readOnlyHint: true },
      schema: {
        userId: z.string().describe("Injected by server. Ignore."),
      },
      handler: async ({ userId }) => {
        requireBrowser(userId);

        // Get page state (accessibility tree + metadata)
        const stateResult = await sendRequest(userId, "getPageState", {});
        const state = stateResult?.data || stateResult;

        // Get text content
        let pageText = "";
        try {
          const extractResult = await sendRequest(userId, "executeAction", { action: { type: "extract" } });
          const content = extractResult?.data?.text || extractResult?.text || extractResult?.data || extractResult;
          pageText = typeof content === "string" ? content : JSON.stringify(content);
        } catch {}

        // Extract only useful interactive elements
        // Skip: unnamed spans, unnamed links, sidebar/footer noise
        const SKIP_ROLES = new Set(["presentation", "img", "complementary", "contentinfo", "navigation"]);
        const interactiveElements = [];
        function walkTree(nodes) {
          if (!nodes) return;
          const list = Array.isArray(nodes) ? nodes : [nodes];
          for (const node of list) {
            if (node.id && !SKIP_ROLES.has(node.role)) {
              // Only include elements with names, or key roles (button, textbox, link with name)
              const hasName = node.name && node.name.trim().length > 0;
              const isAction = node.role === "button" || node.role === "textbox" || node.role === "searchbox" || node.role === "combobox";
              if (hasName || isAction) {
                interactiveElements.push({
                  id: node.id,
                  role: node.role,
                  name: node.name ? node.name.slice(0, 60) : undefined,
                });
              }
            }
            if (node.children) walkTree(node.children);
          }
        }
        walkTree(state?.tree);

        // Cap at 40 elements max
        const elements = interactiveElements.slice(0, 40);

        // Put interactive elements FIRST (AI needs these to act), text SECOND (gets truncated first)
        const combined = {
          url: state?.url || "unknown",
          title: state?.title || "unknown",
          elements,
          pageText: pageText.slice(0, 2000),
        };

        return json(combined);
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
        userId: z.string().describe("Injected by server. Ignore."),
      },
      handler: async ({ elementId, nodeId, userId }) => {
        requireBrowser(userId);
        const result = await sendRequest(userId, "executeAction", {
          action: { type: "click", elementId },
        });
        logAction(nodeId, userId, { type: "click", elementId }, getCurrentUrl(userId), result).catch(() => {});
        return json(result);
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
        userId: z.string().describe("Injected by server. Ignore."),
      },
      handler: async ({ elementId, text, nodeId, userId }) => {
        requireBrowser(userId);
        const result = await sendRequest(userId, "executeAction", {
          action: { type: "type", elementId, text },
        });
        logAction(nodeId, userId, { type: "type", elementId }, getCurrentUrl(userId), result).catch(() => {});
        return json(result);
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
        userId: z.string().describe("Injected by server. Ignore."),
      },
      handler: async ({ url, nodeId, userId }) => {
        requireBrowser(userId);
        // Check site access against the TARGET url specifically
        const access = await checkSiteAccess(nodeId, url);
        if (access.blocked) {
          return text(`Blocked: ${access.reason}. This site is not allowed at this tree position.`);
        }
        const result = await sendRequest(userId, "executeAction", {
          action: { type: "navigate", url },
        });
        logAction(nodeId, userId, { type: "navigate", url }, url, result).catch(() => {});
        return json(result);
      },
    },

    {
      name: "browser-comment",
      description:
        "Post a comment or reply on the current page. Works on Reddit, forums, and social sites. " +
        "Automatically finds the reply button, clicks it, types your text, and submits. " +
        "One tool call does the full flow. No need to manually find buttons.",
      annotations: { readOnlyHint: false, destructiveHint: true },
      schema: {
        commentText: z.string().describe("The text to post as a comment or reply"),
        replyTo: z.string().optional().describe("Username to reply to (e.g. 'u/someone'). If omitted, posts to the main post."),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      handler: async ({ commentText, replyTo, userId }) => {
        requireBrowser(userId);
        const result = await sendRequest(userId, "executeAction", {
          action: { type: "comment", text: commentText, replyTo: replyTo || null },
        });
        const res = result?.data || result;
        if (res?.success && res?.submitted) {
          return text(`Comment posted: "${commentText}"`);
        } else if (res?.typed && !res?.submitted) {
          return text(`Typed "${commentText}" but could not find submit button. Click it manually.`);
        }
        return text(`Failed to post comment: ${res?.error || "unknown error"}`);
      },
    },

    {
      name: "browser-fetch",
      description:
        "Fetch a URL and return the raw response. Works with JSON APIs, RSS feeds, or any URL. " +
        "Server-side fetch, no browser needed. Use this for structured data instead of browser-read.",
      annotations: { readOnlyHint: true },
      schema: {
        url: z.string().describe("URL to fetch"),
        userId: z.string().describe("Injected by server. Ignore."),
      },
      handler: async ({ url, userId }) => {
        if (!url) return text("URL required.");

        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 15000);

          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              "User-Agent": "TreeOS/1.0",
              "Accept": "application/json, text/html, */*",
            },
          });
          clearTimeout(timeout);

          const contentType = response.headers.get("content-type") || "";
          const body = await response.text();

          // Cap at 16KB
          const capped = body.length > 16384
            ? body.slice(0, 16384) + "\n... (truncated)"
            : body;

          return text(`[${response.status}] ${contentType}\n\n${capped}`);
        } catch (err) {
          return text(`Fetch failed: ${err.message}`);
        }
      },
    },

  ];
}
