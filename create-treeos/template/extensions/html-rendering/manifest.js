export default {
  name: "html-rendering",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Server-rendered HTML pages, share token auth, and a page registration API for other extensions.\n\n" +
    "Direct imports (used by extensions that build their own pages):\n" +
    "  import { page } from '../html-rendering/html/layout.js'\n" +
    "  import { esc, escapeHtml } from '../html-rendering/html/utils.js'\n" +
    "  import { baseStyles, glassHeaderStyles, glassCardStyles } from '../html-rendering/html/baseStyles.js'\n" +
    "  import { htmlOnly, buildQS, tokenQS } from '../html-rendering/htmlHelpers.js'\n" +
    "  import urlAuth from '../html-rendering/urlAuth.js'\n" +
    "  import authenticateLite from '../html-rendering/authenticateLite.js'\n" +
    "  import { isHtmlEnabled } from '../html-rendering/config.js'",

  needs: {
    models: ["User", "Node"],
    services: ["auth"],
  },

  optional: {},

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    authStrategies: true,
    env: [],

    cli: [
      {
        command: "cc", scope: ["tree", "land"],
        description: "Command center. Tools, modes, extensions at this position.",
        method: "GET",
        endpoint: "/node/:nodeId/command-center",
      },
    ],

    hooks: {
      fires: [],
      listens: ["afterRegister"],
    },

    // Documented exports (available via getExtension("html-rendering")?.exports)
    //
    // Infrastructure (no pages, no renderers):
    //   registerPage(method, path, ...handlers)  - Mount a page route on the page router (at /, not /api/v1)
    //   urlAuth                                  - Full auth middleware (JWT, share token, public, canopy)
    //   authenticateLite                         - Lightweight auth for HTML page API calls
    //   notFoundPage(req, res, message)          - Render a 404 error page
    //   errorHtml(status, title, message)        - Render a generic error page
    //   resolveHtmlShareAccess({ userId, nodeId, shareToken })  - Validate share tokens
    //   resolvePublicRoot(nodeId)                - Resolve public tree access
    //   isPublic(visibility)                     - Check if a visibility value is public
    //   hasTreeLlm(root)                         - Check if a tree has an LLM assigned
    //
    // Direct imports (used by extensions that build their own pages):
    //   import { page } from "../html-rendering/html/layout.js"       - Page wrapper with shared CSS
    //   import { esc, escapeHtml } from "../html-rendering/html/utils.js"  - HTML escaping
    //   import { htmlOnly, buildQS, tokenQS } from "../html-rendering/htmlHelpers.js"  - Route helpers
    //   import urlAuth from "../html-rendering/urlAuth.js"            - Auth middleware
    //
    // Each extension owns its own pages and routes. html-rendering is infrastructure only.
    // If this extension is not installed, all consuming extensions fall back to JSON responses.
  },
};
