// Layout
//
// Every server-rendered page in html-rendering uses this wrapper.
// It provides the HTML document skeleton, meta tags, and shared CSS.
// Pages supply their title, page-specific styles, body content, and scripts.
//
// Usage from a page file:
//
//   import { page } from "./layout.js";
//
//   export function renderMyPage({ name }) {
//     return page({
//       title: `${name} -- My Page`,
//       css: `.my-class { color: white; }`,
//       body: `<div class="container"><h1>${esc(name)}</h1></div>`,
//       js: `console.log("page loaded");`,
//     });
//   }
//
// Options:
//   title    - Page title (appears in browser tab)
//   css      - Page-specific CSS (injected after shared styles)
//   body     - Page body HTML
//   js       - Client-side JavaScript (injected in a <script> block)
//   bare     - Skip shared styles entirely. For pages with custom themes
//              (command center, query page). Default: false.
//
// Other extensions register pages via:
//   const html = getExtension("html-rendering");
//   html.exports.registerPage("get", "/my-page", authenticate, handler);
//
// Their handlers can import layout from this file or build raw HTML.

import {
  baseStyles,
  backNavStyles,
  glassHeaderStyles,
  glassCardStyles,
  emptyStateStyles,
  glassCardPanelStyles,
  glassFormStyles,
  statGridStyles,
  statusBarStyles,
  responsiveBase,
} from "./baseStyles.js";

const shared = [
  baseStyles,
  backNavStyles,
  glassHeaderStyles,
  glassCardStyles,
  emptyStateStyles,
  glassCardPanelStyles,
  glassFormStyles,
  statGridStyles,
  statusBarStyles,
  responsiveBase,
].join("\n");

export function page({ title = "TreeOS", css = "", body = "", js = "", bare = false }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, interactive-widget=resizes-visual">
  <meta name="theme-color" content="#0d1117">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${title}</title>
  <style>
${bare ? "" : shared}
${css}
  </style>
</head>
<body>
${body}
${js ? `<script>\n${js}\n</script>` : ""}
</body>
</html>`;
}
