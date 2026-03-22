const chalk = require("chalk");
const TreeAPI = require("../api");
const { load, hasExtension } = require("../config");

module.exports = (program) => {
  const cfg = load();
  if (!hasExtension(cfg, "blog")) return;
  program
    .command("blogs")
    .description("List creator blog posts — updates and news about Tree")
    .action(async () => {
      const api = new TreeAPI("");
      try {
        const data = await api.listBlogPosts();
        const posts = data.posts || [];
        if (!posts.length) return console.log(chalk.dim("  (no posts)"));
        posts.forEach((p, i) => {
          const date = p.publishedAt ? new Date(p.publishedAt).toLocaleDateString() : "";
          console.log(`  ${chalk.cyan(i + 1 + ".")} ${chalk.bold(p.title)}`);
          console.log(`      ${chalk.dim((p.authorName || "") + (date ? " · " + date : ""))}${p.slug ? "  " + chalk.dim("slug: " + p.slug) : ""}`);
          if (p.summary) console.log(`      ${chalk.dim(p.summary)}`);
          console.log();
        });
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });

  program
    .command("blog [slugOrNumber...]")
    .description("Read a blog post by slug or list number")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: blog <slug or number>. Run 'blogs' to see available posts."));
      const input = parts.join("-");
      const api = new TreeAPI("");
      try {
        let slug = input;
        if (/^\d+$/.test(input)) {
          const data = await api.listBlogPosts();
          const posts = data.posts || [];
          const idx = parseInt(input, 10) - 1;
          if (!posts[idx]) return console.log(chalk.red(`No post at index ${input}`));
          slug = posts[idx].slug;
        }
        let postData;
        try {
          postData = await api.getBlogPost(slug);
        } catch (_) {
          const list = await api.listBlogPosts();
          const match = (list.posts || []).find(p =>
            p.title.toLowerCase().includes(input.toLowerCase()) ||
            p.slug.includes(input.toLowerCase())
          );
          if (!match) return console.log(chalk.red(`No post found for "${input}"`));
          postData = await api.getBlogPost(match.slug);
        }
        const post = postData.post;
        const date = post.publishedAt ? new Date(post.publishedAt).toLocaleDateString() : "";
        console.log(chalk.bold("\n" + post.title));
        console.log(chalk.dim((post.authorName || "") + (date ? " · " + date : "")) + "\n");
        if (post.summary) console.log(chalk.dim(post.summary) + "\n");
        if (post.content) {
          const text = post.content
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&nbsp;/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
            .trim();
          console.log(text);
        }
        console.log();
      } catch (e) {
        console.error(chalk.red(e.message));
      }
    });
};
