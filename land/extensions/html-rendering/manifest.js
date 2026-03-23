export default {
  name: "html-rendering",
  version: "2.0.0",
  description: "Server-rendered HTML pages, share token auth, and a page registration API for other extensions",

  needs: {
    models: ["User", "Node"],
  },

  optional: {},

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [
      { key: "ENABLE_FRONTEND_HTML", required: false, default: "true", description: "Enable server-rendered HTML and share token auth. Set to false to disable all ?html routes, share token access, and extension HTML renderers. API endpoints still return JSON." },
    ],

    hooks: {
      fires: [],
      listens: ["afterRegister"],
    },

    // Documented exports (available via getExtension("html-rendering")?.exports)
    //
    // Page registration:
    //   registerPage(method, path, ...handlers)  - Add routes to the page router (mounted at /, not /api/v1).
    //                                              Other extensions use this to add their own server-rendered pages.
    //                                              Example: registerPage("get", "/my-dashboard", authenticate, handler)
    //
    // Share token auth:
    //   resolveHtmlShareAccess({ userId, nodeId, shareToken })  - Validate a share token for URL-based auth.
    //                                                              Returns { allowed, matchedUserId, scope, ... }
    //
    // Render functions (60+):
    //   All render functions from html/user.js, html/node.js, html/notes.js, html/values.js, html/chat.js, html/notFound.js
    //   Examples: renderValues(), renderEnergy(), renderChat(), renderUserNotes(), renderScriptDetail(),
    //             renderBookPage(), renderSolanaWallet(), errorHtml(), parseBool(), normalizeStatusFilters()
    //
    // Login/register pages:
    //   renderLoginPage(), renderRegisterPage(), renderForgotPasswordPage()
    //
    // Usage from other extensions:
    //   import { getExtension } from "../loader.js";
    //   const html = getExtension("html-rendering")?.exports || {};
    //   if (html.renderValues) res.send(html.renderValues({ ... }));
    //
    // If this extension is not installed, all consuming extensions fall back to JSON responses.
  },
};
