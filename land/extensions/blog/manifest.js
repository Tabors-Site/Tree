export default {
  name: "blog",
  version: "1.0.0",
  description:
    "A land-level blog for publishing long-form content outside the tree structure. Trees " +
    "are for structured knowledge. Blogs are for narrative. Announcements, changelogs, " +
    "tutorials, essays. Content that has a publish date and an audience rather than a " +
    "position in a hierarchy. " +
    "\n\n" +
    "Each post has a title, a URL-safe slug, markdown content, an optional summary, a " +
    "publish date, and an author reference. The slug is unique and serves as the primary " +
    "lookup key for public access. Posts can be marked as published or unpublished. Only " +
    "published posts appear in the public listing. " +
    "\n\n" +
    "Publishing is restricted to land admins. Any authenticated admin can create, update, " +
    "or delete posts through the API. The author's username is stored alongside the user " +
    "ID so posts display correctly even if the author account is later modified. Reading " +
    "is fully public. No authentication required to list posts or read a specific post " +
    "by slug. " +
    "\n\n" +
    "The extension provides its own Mongoose model (BlogPost) stored in a dedicated " +
    "collection separate from tree data. This keeps blog content out of the node/note " +
    "system entirely. The CLI exposes two commands: 'blogs' to list all published posts " +
    "and 'blog <slug>' to read a specific one. Slug collisions on create or update " +
    "return a clear error rather than overwriting.",

  needs: {
    models: ["User"],
  },

  optional: {},

  provides: {
    models: { BlogPost: "./model.js" },
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [
      { command: "blogs", description: "List blog posts", method: "GET", endpoint: "/blog/posts" },
      { command: "blog <slug>", description: "Read a blog post", method: "GET", endpoint: "/blog/posts/:slug" },
    ],
  },
};
