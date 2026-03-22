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

const STATIC_ROUTES = [
  "/",
  "/about",
  "/about/api",
  "/about/energy",
  "/about/raw-ideas",
  "/about/dreams",
  "/about/gettingstarted",
  "/about/cli",
  "/about/gateway",
  "/about/land",
  "/about/node-types",
  "/privacy",
  "/terms",
  "/blog",
];

const BLOG_API = (process.env.VITE_LAND_URL || "https://treeos.ai") + "/api/v1";

// Per-page metadata for SEO (title, description, og:title, og:description)
const PAGE_META = {
  "/": {
    title: "TreeOS - A Context Management System",
    description: "TreeOS is a context management system for organizing, navigating, and understanding complex information.",
  },
  "/about": {
    title: "About - TreeOS",
    description: "Learn what TreeOS is, how it works, and why it exists.",
  },
  "/about/api": {
    title: "API Reference - TreeOS",
    description: "Read and write to your trees programmatically. Build integrations, automations, and bots.",
  },
  "/about/energy": {
    title: "Energy & Pricing - TreeOS",
    description: "Understand TreeOS's energy system, pricing tiers, and LLM costs.",
  },
  "/about/raw-ideas": {
    title: "Raw Ideas - TreeOS",
    description: "Capture unstructured thoughts and let TreeOS agents place them into your knowledge trees.",
  },
  "/about/dreams": {
    title: "Tree Dreams - TreeOS",
    description: "Daily background maintenance that cleans up, drains short-term memory, and compresses understanding.",
  },
  "/about/gettingstarted": {
    title: "Getting Started - TreeOS",
    description: "Get started with TreeOS and learn how to grow your first knowledge tree.",
  },
  "/about/cli": {
    title: "CLI - TreeOS",
    description: "Navigate and manage your trees from the terminal with treef-cli.",
  },
  "/about/gateway": {
    title: "Gateway - TreeOS",
    description: "Connect your trees to Telegram, Discord, and push notifications with gateway channels.",
  },
  "/about/land": {
    title: "Land and Canopy - TreeOS",
    description: "Self-host your own Land node, connect to the decentralized TreeOS network, and collaborate across servers.",
  },
  "/about/node-types": {
    title: "Node Types - TreeOS",
    description: "Semantic labels for nodes. Six core types, custom types, and how trees program their own agents.",
  },
  "/privacy": {
    title: "Privacy Policy - TreeOS",
    description: "How TreeOS collects, stores, and protects your data.",
  },
  "/terms": {
    title: "Terms of Service - TreeOS",
    description: "Terms and conditions for using TreeOS.",
  },
  "/blog": {
    title: "Blog - TreeOS",
    description: "Posts about TreeOS, knowledge management, and building with AI.",
  },
};

// Fetch blog post slugs and titles from the backend API
async function fetchBlogPosts() {
  try {
    const res = await fetch(`${BLOG_API}/blog/posts`);
    const data = await res.json();
    if (data.success && data.posts) {
      return data.posts.map((p) => ({
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
