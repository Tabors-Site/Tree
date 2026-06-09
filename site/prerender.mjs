#!/usr/bin/env node
// Post-build prerenderer: spins up a local server, visits each route with
// Puppeteer, and saves the rendered HTML so crawlers/LLMs can read it.

import { createServer } from "http";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "dist");
const PORT = 4829;

// New site routes (post-rebuild 2026)
const NEW_ROUTES = [
  "/",                      // NewLandingPage
  "/ibp",                   // IbpPage
  "/ibp/crossworld",        // CrossWorldPage
  "/start",                 // GetStartedPage
  "/license",               // LicensePage
  "/factory",               // FactoryOverview (in FactoryLayout)
  "/factory/being-types",
  "/factory/roles",
  "/factory/intake",
  "/factory/assign",
  "/factory/fold",
  "/factory/momentum",
  "/factory/stamped",
  "/blog",                  // Blog stays at root (component imported from old/Blog)
];

// Legacy site routes — every old route now lives under /old/*
const OLD_ROUTES = [
  "/old/",
  "/old/about",
  "/old/about/api",
  "/old/about/energy",
  "/old/about/raw-ideas",
  "/old/about/dreams",
  "/old/about/gettingstarted",
  "/old/about/cli",
  "/old/about/gateway",
  "/old/about/land",
  "/old/about/node-types",
  "/old/about/extensions",
  "/old/privacy",
  "/old/terms",
  "/old/guide",
  "/old/decentralized",
  "/old/ai",
  "/old/kernel",
  "/old/cascade",
  "/old/swarm",
  "/old/ibp",
  "/old/ibp/arrival",
  "/old/ibp/authorization",
  "/old/extensions",
  "/old/flow",
  "/old/network",
  "/old/build",
  "/old/code",
  "/old/html",
  "/old/cli",
  "/old/mycelium",
  "/old/seed",
  "/old/lands",
  "/old/treeos",
  "/old/study",
  "/old/fitness",
  "/old/food",
  "/old/recovery",
  "/old/kb",
  "/old/governing",
  "/old/governing/rulership",
  "/old/governing/rulership/ruler",
  "/old/governing/rulership/planner",
  "/old/governing/rulership/contractor",
  "/old/governing/rulership/foreman",
  "/old/governing/rulership/worker",
  "/old/app",
  "/old/start",
  "/old/what",
  "/old/use",
];

const STATIC_ROUTES = [...NEW_ROUTES, ...OLD_ROUTES];

const BLOG_API = (process.env.VITE_LAND_URL || "https://treeos.ai") + "/api/v1";

// Per-page metadata for SEO (title, description, og:title, og:description)
const PAGE_META = {
  // ── NEW SITE (2026) ──────────────────────────────────────────────
  "/": {
    title: "TreeOS . An operating system for AI agents",
    description: "Beings, places, and the moments that bind them. TreeOS is a runtime for AI agents and humans alike, with a four-verb protocol (IBP) and a five-beat moment cycle (the Factory).",
  },
  "/ibp": {
    title: "IBP . The Inter-Being Protocol",
    description: "Four verbs (SEE, DO, SUMMON, BE) over a single envelope, carried by any transport. The public surface of TreeOS.",
  },
  "/ibp/crossworld": {
    title: "Cross-World . Acting across branch and reality",
    description: "One being, one position, one act. How a being reaches across branches and realities through portals: detected from the address, with the actor's act-chain and the receiving world's reels both staying sovereign.",
  },
  "/start": {
    title: "Get started . TreeOS",
    description: "Run your own reality or get a portal to join one. Every reality is sovereign, customizable, and connects to the others through IBP.",
  },
  "/license": {
    title: "Licensing . TreeOS",
    description: "The TreeOS seed is dual licensed: free and open under the AGPL-3.0 by default, with a separate commercial license for closed-source or hosted use. Covers the seed only.",
  },
  "/factory": {
    title: "The Factory . How a moment works",
    description: "Every moment of every being walks the same five beats: intake, assign, fold, momentum, stamped. The engine that walks them.",
  },
  "/factory/being-types": {
    title: "Being types . The Factory",
    description: "What a being is in TreeOS, the cognition kinds, and what an LLM being's one moment looks like.",
  },
  "/factory/roles": {
    title: "Roles . The Factory",
    description: "Roles are the IDE for building in reality. Extensions ship the parts (matter types, world signals, role definitions); operators mix them in role-manager. Stack them per moment via roleFlow conditions on the world.",
  },
  "/factory/intake": {
    title: "Intake . Beat 1 . The Factory",
    description: "A summon arrives. The being's inbox gains a new entry. Until the scheduler picks it up, nothing else happens.",
  },
  "/factory/assign": {
    title: "Assign . Beat 2 . The Factory",
    description: "The scheduler picks an inbox entry and hands it to the stamper. The being's role is resolved. The moment has a frame.",
  },
  "/factory/fold": {
    title: "Fold . Beat 3 . The Factory",
    description: "The reels the being depends on are folded. Every Fact behind them collapsed into a current view. This is what the being sees.",
  },
  "/factory/momentum": {
    title: "Momentum . Beat 4 . The Factory",
    description: "The being acts. Its role runs against the face it was given. New Facts accumulate in delta-F, not yet committed.",
  },
  "/factory/stamped": {
    title: "Stamped . Beat 5 . The Factory",
    description: "The Act row materializes. Every Fact in delta-F commits together. The reels grow. The past is now larger by one moment.",
  },

  // Blog stays at root (the content didn't move with the legacy pages).
  "/blog": {
    title: "Blog - TreeOS",
    description: "Posts about TreeOS, knowledge management, and building with AI.",
  },

  // ── LEGACY SITE (preserved under /old/*) ──────────────────────────
  "/old/": {
    title: "The Seed . An Open Kernel for AI Agents",
    description: "Two schemas, a conversation loop, and an extension loader. The minimum kernel an AI agent needs to live somewhere persistent. Plant the seed. Build anything on top of it.",
  },
  "/old/guide": {
    title: "TreeOS Guide . Everything You Need to Know",
    description: "Complete guide to TreeOS from simple to advanced. The kernel, extensions, AI modes, hooks, federation, and building your own.",
  },
  "/old/decentralized": {
    title: "Decentralized AI . The TreeOS Network",
    description: "No central server. No single owner. Sovereign lands connecting through an open protocol. Knowledge and AI capabilities flowing across a federated network.",
  },
  "/old/ai": {
    title: "AI Architecture . How AI Works in TreeOS",
    description: "Three zones, per-node tools and modes, custom orchestrators. The AI stack from simple configuration to full replacement. Build any AI product on TreeOS.",
  },
  "/old/kernel": {
    title: "The Seed . What Runs When Everything Else Is Stripped Away",
    description: "Two schemas, six system nodes, 27 lifecycle hooks, five registries, a cascade engine, and a response protocol. The kernel that never changes.",
  },
  "/old/seed": {
    title: "The Seed . What Runs When Everything Else Is Stripped Away",
    description: "Two schemas, six system nodes, 27 lifecycle hooks, five registries, a cascade engine, and a response protocol. The kernel that never changes.",
  },
  "/old/cascade": {
    title: "Cascade . How the Tree Communicates",
    description: "The fourth primitive. Seven kernel additions. Two entry points. Six statuses none terminal. .flow as the water table. The nervous system of the tree.",
  },
  "/old/swarm": {
    title: "Swarm . The Parallel Execution Engine",
    description: "Swarm runs governing's plans in parallel. It dispatches branch steps as their own sessions, tracks status, retries failures, surfaces sibling state, and resumes interrupted work across sessions. Mechanism, not policy. Governing decides what gets done; swarm does the doing in parallel. Tree authoritative.",
  },
  "/old/ibp": {
    title: "IBP . Inter-Being Protocol . Sibling to the World Wide Web",
    description: "HTTP/URL/WWW gave the world the Web of documents. IBP, the Inter-Being Protocol, gives it the Web of beings. IBP Addresses, four verbs (SEE/DO/TALK/BE), Position Descriptors. The protocol layer for identity-first interaction with sovereign AI on TreeOS lands. The Portal is its browser.",
  },
  "/old/ibp/arrival": {
    title: "The arrival stance . IBP",
    description: "Every IBP-speaking land runs an arrival stance for visitors who haven't yet registered or claimed. Its permissions are configurable per land. One configuration surface covers the full spectrum from a fully closed personal land to a fully open public space. A regular stance, not a protocol special case.",
  },
  "/old/ibp/authorization": {
    title: "Portal Authorization . IBP",
    description: "The kernel function that decides what one stance can do toward another stance through a portal connection. One function, four inputs, allow-or-deny output. Every verb call from every stance at every position flows through it. The layer that makes the protocol's stance commitment real at the kernel level.",
  },
  "/old/flow": {
    title: "The Flow . How Data Moves Through the System",
    description: "The water cycle of TreeOS. Clouds, rain, land, roots, photosynthesis, transpiration, canopy wind. Every part maps to something real. The intuitive guide to how data moves.",
  },
  "/old/extensions": {
    title: "Extensions . How the Tree Grows",
    description: "The manifest, the loader, five registries, spatial scoping. How to build an extension. How an operating system emerges from extensions working together.",
  },
  "/old/html": {
    title: "One Tree, Three Interfaces . CLI, AI, Browser",
    description: "Every node is accessible three ways. The CLI reads it. The AI reads it. The browser renders it. Same data. Same API. ?html turns JSON into pages.",
  },
  "/old/build": {
    title: "Build Extensions . Developer Reference",
    description: "Everything you need to build extensions for the seed. Manifest, init, hooks, modes, tools, routes, CLI commands, migrations, publishing. Code-first.",
  },
  "/old/code": {
    title: "The tree writes code . TreeOS coding environment",
    description: "TreeOS writes JavaScript projects from one sentence. A local 27B model produces shipping code because the tree carries the context: position, grammar, and a live mirror of the system's own source. A snake eating its own tail. Claude Code but from inside the operating system.",
  },
  "/old/cli": {
    title: "The CLI . Terminal Native",
    description: "Navigate trees like a filesystem. Named sessions pinned to positions. Multiple AI conversations in parallel. Extensions add commands. The terminal is the interface.",
  },
  "/old/network": {
    title: "The Network . How Trees Connect",
    description: "Sovereign lands. Canopy protocol. Ed25519 signing. Federation without a central authority. Your data stays on your land.",
  },
  "/old/mycelium": {
    title: "Mycelium . The Forest Underground",
    description: "Intelligent cross-land signal routing. Not a server. An extension any land installs to become a routing node. Three layers: water table, canopy, mycelium.",
  },
  "/old/lands": {
    title: "Your Land . Start a TreeOS Server",
    description: "A land is your server. Node.js, MongoDB, your own LLM. Four commands to start. Your data stays on it. Your AI runs on it. Your extensions live on it.",
  },
  "/old/treeos": {
    title: "TreeOS . The First OS Built on the Seed",
    description: "Fitness, food, recovery, study. Four apps that turn trees into tools people use. Four bundles for intelligence, cascade, communication, and maintenance. Three temporal layers. The tree breathes.",
  },
  "/old/study": {
    title: "Study . The Tree That Teaches You",
    description: "Queue what you want to learn. The AI breaks it into a curriculum, teaches through conversation, tracks mastery, and detects gaps. Paste a URL and it reads the content. Type be and it picks the next lesson.",
  },
  "/old/fitness": {
    title: "Fitness . Three Languages, One Command",
    description: "Gym, running, and bodyweight. Log any workout in natural language. The AI detects what you did, routes it to the right place, and tracks progressive overload automatically. Type be and the coach walks you through today's session.",
  },
  "/old/food": {
    title: "Food . The Tree That Knows What You Eat",
    description: "Say what you ate. One LLM call parses macros. Cascade routes to tracking nodes. Meal patterns, weekly averages, fitness channel integration. The tree IS the nutritionist.",
  },
  "/old/recovery": {
    title: "Recovery . The Tree That Grows Toward Health",
    description: "Track substances, feelings, cravings, and patterns. Taper schedules that bend around you. Pattern detection that finds what you can't see. A mirror, not a judge.",
  },
  "/old/kb": {
    title: "KB . The Tree That Remembers Everything",
    description: "Tell it things. Ask it things. One person maintains, everyone benefits. Knowledge base with citations, staleness detection, and guided review. The coworker who never forgets.",
  },
  "/old/governing": {
    title: "Governing . The Coordination Glue of TreeOS",
    description: "Without governing, a tree is a folder structure. With it, every scope becomes an addressable domain where work coordinates across branches. Five layers (Rulership, Courts, Reputation, Structural Remedies, Economy) compose the substrate that any workspace consumes.",
  },
  "/old/governing/rulership": {
    title: "Rulership . The Five Roles of Governing",
    description: "Pass 1 of governing. Ruler decides. Planner advises on decomposition. Contractor commits shared vocabulary. Foreman manages execution. Worker builds. Five roles compose into a uniform pattern at every scope, root or sub.",
  },
  "/old/governing/rulership/ruler": {
    title: "The Ruler . The Be-er of Rules",
    description: "The addressable being at a TreeOS scope. Holds authority for the domain, hears every user message, decides what happens via tool selection. Top-level Rulers pause between user gates; sub-Rulers chain their full lifecycle in one turn.",
  },
  "/old/governing/rulership/planner": {
    title: "The Planner . The Cartographer of Work",
    description: "Transient role that drafts decomposition. Reads the briefing, traverses the local tree, drafts a structured plan with reasoning, presents to the Ruler, exits. Domain-neutral; workspaces don't specialize the Planner.",
  },
  "/old/governing/rulership/contractor": {
    title: "The Contractor . The Binder of Seams",
    description: "Transient role that ratifies shared vocabulary. Identifies what crosses branch boundaries, drafts contracts with valid scope (LCA correctness), hands them back to the Ruler. Seams between branches hold because contracts pin the names down.",
  },
  "/old/governing/rulership/foreman": {
    title: "The Foreman . The Call-Stack Manager",
    description: "Wakes when execution needs judgment: branch failed, swarm completed, resume requested. Reads the execution stack, decides retry vs escalate vs pause vs cancel-subtree. Trees execute like call stacks; the Foreman holds frame discipline.",
  },
  "/old/governing/rulership/worker": {
    title: "The Worker . The Hand of the Work",
    description: "The only role in Rulership that produces artifacts rather than coordinating. Where TreeOS's general substrate becomes domain specific. Workspace extensions specialize the Worker for code, prose, civic coordination. The substrate provides the structure; the workspace provides the substance.",
  },
  "/old/use": {
    title: "TreeOS . One Life, One Tree",
    description: "You don't use five apps to live one life. Fitness, food, recovery, study, knowledge. All branches of the same tree. All aware of each other. One conversation with something that holds your whole picture.",
  },
  "/old/what": {
    title: "What Is TreeOS? . Apps and a Filesystem",
    description: "The structured extensions are applications. The free-form tree is the operating system. Position determines reality. Both live in the same tree. That's TreeOS.",
  },
  "/old/start": {
    title: "Get Started . TreeOS",
    description: "Your own AI. Your own system. Free. Join a land or run your own. CLI or browser. Choose extensions, talk to your tree, build your own. Not a product. Already yours.",
  },
  "/old/app": {
    title: "TreeOS . The First OS Built on the Seed",
    description: "77 extensions across four bundles. AI modes, cascade network, intelligence, external channels, maintenance. Plant the seed. Build anything on top of it.",
  },
  "/old/about": {
    title: "About - TreeOS",
    description: "Learn what TreeOS is, how it works, and why it exists.",
  },
  "/old/about/api": {
    title: "API Reference - TreeOS",
    description: "Read and write to your trees programmatically. Build integrations, automations, and bots.",
  },
  "/old/about/energy": {
    title: "Energy & Pricing - TreeOS",
    description: "Understand TreeOS's energy system, pricing tiers, and LLM costs.",
  },
  "/old/about/raw-ideas": {
    title: "Raw Ideas - TreeOS",
    description: "Capture unstructured thoughts and let TreeOS agents place them into your knowledge trees.",
  },
  "/old/about/dreams": {
    title: "Tree Dreams - TreeOS",
    description: "Daily background maintenance that cleans up, drains short-term memory, and compresses understanding.",
  },
  "/old/about/gettingstarted": {
    title: "Getting Started - TreeOS",
    description: "Get started with TreeOS and learn how to grow your first knowledge tree.",
  },
  "/old/about/cli": {
    title: "CLI - TreeOS",
    description: "Navigate and manage your trees from the terminal with treef-cli.",
  },
  "/old/about/gateway": {
    title: "Gateway - TreeOS",
    description: "Connect your trees to Telegram, Discord, and push notifications with gateway channels.",
  },
  "/old/about/land": {
    title: "Land and Canopy - TreeOS",
    description: "Self-host your own Land node, connect to the decentralized TreeOS network, and collaborate across servers.",
  },
  "/old/about/node-types": {
    title: "Node Types - TreeOS",
    description: "Free-form semantic labels for nodes. Extensions suggest types. The kernel validates format. Custom types allowed.",
  },
  "/old/about/extensions": {
    title: "Extensions - TreeOS",
    description: "Modular packages for TreeOS. Install, disable, publish, and build extensions for your land.",
  },
  "/old/privacy": {
    title: "Privacy Policy - TreeOS",
    description: "How TreeOS collects, stores, and protects your data.",
  },
  "/old/terms": {
    title: "Terms of Service - TreeOS",
    description: "Terms and conditions for using TreeOS.",
  },
};

// Fetch blog post slugs and titles from the backend API
async function fetchBlogPosts() {
  try {
    const res = await fetch(`${BLOG_API}/blog/posts`);
    const raw = await res.json();
    const data = raw.data || raw;
    const posts = data.posts || data;
    if (Array.isArray(posts) && posts.length > 0) {
      // Blog routes stay at root (/blog/<slug>) — the blog content
      // crosses the rebuild seam and isn't moved to /old/* with the
      // rest of the legacy pages. The component lives at
      // /site/src/components/Welcome/old/Blog/BlogSection.jsx and is
      // imported by both the root /blog route and the legacy
      // /old/blog route.
      return posts.map((p) => ({
        route: `/blog/${p.slug}`,
        title: p.title,
        summary: p.summary || "",
      }));
    }
  } catch (err) {
    console.warn("  Could not fetch blog posts (backend running?):", err.message);
  }
  return [];
}

// Static server that serves dist files and proxies API requests to the backend
function startServer() {
  const indexHtml = readFileSync(join(DIST, "index.html"), "utf-8");
  const server = createServer((req, res) => {
    const url = req.url.split("?")[0];

    // Proxy blog API requests to the real backend
    if (url.startsWith("/blog/posts") || url.startsWith("/api/v1/blog/")) {
      // Strip /api/v1 prefix if present since BLOG_API already includes it
      const apiPath = url.replace(/^\/api\/v1/, "");
      const apiUrl = `${BLOG_API}${apiPath}`;
      fetch(apiUrl)
        .then((r) => r.text().then((body) => {
          res.setHeader("Content-Type", "application/json");
          res.statusCode = r.status;
          res.end(body);
        }))
        .catch(() => {
          res.statusCode = 502;
          res.end('{"error":"proxy failed"}');
        });
      return;
    }

    // Try to serve static assets first
    const filePath = join(DIST, url);
    try {
      if (url !== "/" && !url.endsWith("/")) {
        const content = readFileSync(filePath);
        const ext = url.split(".").pop();
        const types = { js: "application/javascript", css: "text/css", png: "image/png", svg: "image/svg+xml", json: "application/json" };
        res.setHeader("Content-Type", types[ext] || "application/octet-stream");
        res.end(content);
        return;
      }
    } catch {}
    // SPA fallback
    res.setHeader("Content-Type", "text/html");
    res.end(indexHtml);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function main() {
  console.log("Starting prerender...");

  // Fetch dynamic blog routes and build metadata for blog posts
  const blogPosts = await fetchBlogPosts();
  for (const post of blogPosts) {
    PAGE_META[post.route] = {
      title: `${post.title} - Tree Blog`,
      description: post.summary || `Read "${post.title}" on the Tree blog.`,
    };
  }
  const blogRoutes = blogPosts.map((p) => p.route);
  const routes = [...STATIC_ROUTES, ...blogRoutes];
  console.log(`  ${routes.length} routes (${blogRoutes.length} blog posts)`);

  const server = await startServer();
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

  for (const route of routes) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: "networkidle0", timeout: 30000 });
    let html = await page.content();
    await page.close();

    // Fix per-page SEO metadata
    const canonicalUrl = `${process.env.VITE_LAND_URL || "https://treeos.ai"}${route === "/" ? "" : route}`;
    const meta = PAGE_META[route] || PAGE_META["/"];
    html = html.replace(
      /<link rel="canonical" href="[^"]*"\s*\/?>/,
      `<link rel="canonical" href="${canonicalUrl}" />`
    );
    html = html.replace(
      /<meta property="og:url" content="[^"]*"\s*\/?>/,
      `<meta property="og:url" content="${canonicalUrl}" />`
    );
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${meta.title}</title>`);
    html = html.replace(
      /<meta name="description" content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${meta.description}" />`
    );
    html = html.replace(
      /<meta property="og:title" content="[^"]*"\s*\/?>/,
      `<meta property="og:title" content="${meta.title}" />`
    );
    html = html.replace(
      /<meta property="og:description" content="[^"]*"\s*\/?>/,
      `<meta property="og:description" content="${meta.description}" />`
    );

    // Strip scripts from content pages so they're fully static (no React hydration)
    // Only keep React on "/" (interactive welcome page)
    const isStatic = route !== "/";
    if (isStatic) {
      html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
    }

    // Write to dist/<route>/index.html
    const outDir = route === "/" ? DIST : join(DIST, route);
    mkdirSync(outDir, { recursive: true });
    const outFile = join(outDir, "index.html");
    writeFileSync(outFile, html, "utf-8");
    console.log(`  ${route} -> ${outFile.replace(DIST, "dist")}${isStatic ? " (static)" : ""}`);
  }

  await browser.close();
  server.close();
  console.log("Prerender complete!");
}

main().catch((err) => {
  console.error("Prerender failed:", err);
  process.exit(1);
});
