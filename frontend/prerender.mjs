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
  "/privacy",
  "/terms",
  "/blog",
];

const BLOG_API ="https://tree.tabors.site/api/v1";

// Fetch blog post slugs from the backend API
async function fetchBlogSlugs() {
  try {
    const res = await fetch(`${BLOG_API}/blog/posts`);
    const data = await res.json();
    if (data.success && data.posts) {
      return data.posts.map((p) => `/blog/${p.slug}`);
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

  // Fetch dynamic blog routes
  const blogRoutes = await fetchBlogSlugs();
  const routes = [...STATIC_ROUTES, ...blogRoutes];
  console.log(`  ${routes.length} routes (${blogRoutes.length} blog posts)`);

  const server = await startServer();
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });

  for (const route of routes) {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: "networkidle0", timeout: 30000 });
    let html = await page.content();
    await page.close();

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
