// Intake tools: URL fetching + text extraction.
//
// Kept minimal and read-only. Intake is the drone role; writes happen
// downstream in the domain architect + workers. These tools exist so
// the intake mode can actually ingest what the user pointed at —
// otherwise it'd just paraphrase the URL string.
//
// Future additions (when demand-pulled):
//   - read-file  (for uploaded note attachments)
//   - transcribe (for audio / video input)
//   - pdf-extract (for PDFs via pdfjs or similar)

import { z } from "zod";
import log from "../../seed/log.js";

const MAX_FETCH_BYTES = 256 * 1024; // 256 KB cap on fetched content
const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT = "TreeOS-Intake/0.1";

/**
 * Strip HTML down to readable text. Cheap, no dependency on a parser.
 * Drops <script> / <style> blocks wholesale, strips tags, decodes common
 * entities, normalizes whitespace. For rich structured extraction (e.g.
 * Readability-style), a future pass could swap this for a real parser.
 */
function stripHtml(html) {
  if (typeof html !== "string") return "";
  let text = html;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<!--[\s\S]*?-->/g, "");
  // Replace block-level closing tags with newlines before stripping
  text = text.replace(/<\/(p|div|section|article|li|h[1-6]|br|blockquote|pre)>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]+>/g, " ");
  // Decode the commonest entities
  const entities = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"", "&#39;": "'",
    "&apos;": "'", "&nbsp;": " ", "&mdash;": "—", "&ndash;": "–",
    "&hellip;": "…", "&ldquo;": "\u201C", "&rdquo;": "\u201D",
  };
  text = text.replace(/&[a-z]+;|&#\d+;/gi, (m) => entities[m] ?? m);
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n\s*\n\s*\n+/g, "\n\n");
  text = text.trim();
  return text;
}

function text(s) {
  return { content: [{ type: "text", text: String(s) }] };
}

export default function getIntakeTools() {
  return [
    {
      name: "fetch-url",
      description:
        "Fetch a URL and return the page's visible text content. Read-only; " +
        "does not modify anything. Useful when the user points at a blog " +
        "post, documentation, or any web resource you need to ingest. " +
        "Returns the first " + Math.round(MAX_FETCH_BYTES / 1024) + " KB of " +
        "text after stripping HTML. If the page is very long, the tail is " +
        "truncated — the preview is enough to extract the gist for premise " +
        "distillation.",
      schema: {
        url: z.string().url().describe("Fully-qualified http(s) URL to fetch."),
      },
      annotations: { readOnlyHint: true },
      async handler({ url }) {
        if (!/^https?:\/\//i.test(url)) {
          return text(`fetch-url: only http(s) URLs are allowed. Got: ${url}`);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          const res = await fetch(url, {
            method: "GET",
            headers: {
              "User-Agent": USER_AGENT,
              "Accept": "text/html,application/xhtml+xml,text/plain,*/*;q=0.5",
            },
            redirect: "follow",
            signal: controller.signal,
          });
          if (!res.ok) {
            return text(`fetch-url failed: ${res.status} ${res.statusText} for ${url}`);
          }
          const contentType = res.headers.get("content-type") || "";
          const reader = res.body?.getReader();
          if (!reader) {
            const body = await res.text();
            return text(renderFetched(url, contentType, body.slice(0, MAX_FETCH_BYTES)));
          }
          const chunks = [];
          let received = 0;
          while (received < MAX_FETCH_BYTES) {
            const { value, done } = await reader.read();
            if (done) break;
            received += value.length;
            chunks.push(value);
            if (received >= MAX_FETCH_BYTES) break;
          }
          try { reader.cancel(); } catch {}
          const buf = new Uint8Array(Math.min(received, MAX_FETCH_BYTES));
          let offset = 0;
          for (const chunk of chunks) {
            const room = buf.length - offset;
            if (room <= 0) break;
            const slice = chunk.length > room ? chunk.subarray(0, room) : chunk;
            buf.set(slice, offset);
            offset += slice.length;
          }
          const body = new TextDecoder().decode(buf);
          return text(renderFetched(url, contentType, body));
        } catch (err) {
          log.debug("Intake", `fetch-url ${url} failed: ${err.message}`);
          return text(`fetch-url error: ${err.message}`);
        } finally {
          clearTimeout(timer);
        }
      },
    },
  ];
}

function renderFetched(url, contentType, raw) {
  const isHtml = /html/i.test(contentType) || /<html[\s>]/i.test(raw.slice(0, 2000));
  const body = isHtml ? stripHtml(raw) : raw;
  const truncatedNote = body.length >= MAX_FETCH_BYTES - 100
    ? `\n\n[Content truncated at ${Math.round(MAX_FETCH_BYTES / 1024)}KB.]`
    : "";
  return `Fetched: ${url}\nContent-Type: ${contentType || "(none)"}\n\n${body}${truncatedNote}`;
}
