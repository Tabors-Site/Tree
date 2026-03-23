import log from "../../core/log.js";
import express from "express";
import authenticate from "../../middleware/authenticate.js";
import BlogPost from "./model.js";

export default function createRouter(core) {
  const { User } = core.models;
  const router = express.Router();

  router.get("/blog/posts", async (req, res) => {
    try {
      const posts = await BlogPost.find({ published: true })
        .select("title slug summary publishedAt authorName")
        .sort({ publishedAt: -1 })
        .lean();
      res.json({ success: true, posts });
    } catch (err) {
 log.error("Blog", "Blog list error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/blog/posts/:slug", async (req, res) => {
    try {
      const post = await BlogPost.findOne({
        slug: req.params.slug,
        published: true,
      }).lean();
      if (!post) return res.status(404).json({ error: "Post not found" });
      res.json({ success: true, post });
    } catch (err) {
 log.error("Blog", "Blog post error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/blog/posts", authenticate, async (req, res) => {
    try {
      const user = await User.findById(req.userId)
        .select("profileType username")
        .lean();
      if (!user || user.profileType !== "god") {
        return res.status(403).json({ error: "Requires god plan" });
      }

      const { title, slug, content, summary, publishedAt, published } = req.body;
      if (!title || !slug || !content) {
        return res
          .status(400)
          .json({ error: "title, slug, and content are required" });
      }

      const post = await BlogPost.create({
        title,
        slug,
        content,
        summary: summary || "",
        publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
        published: published !== undefined ? published : true,
        author: req.userId,
        authorName: user.username,
      });

      res.json({ success: true, post });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(400).json({ error: "Slug already exists" });
      }
 log.error("Blog", "Blog create error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/blog/posts/:slug", authenticate, async (req, res) => {
    try {
      const user = await User.findById(req.userId).select("profileType").lean();
      if (!user || user.profileType !== "god") {
        return res.status(403).json({ error: "Requires god plan" });
      }

      const updates = {};
      const allowed = ["title", "slug", "content", "summary", "publishedAt", "published"];
      for (const key of allowed) {
        if (req.body[key] !== undefined) {
          updates[key] = key === "publishedAt" ? new Date(req.body[key]) : req.body[key];
        }
      }

      const post = await BlogPost.findOneAndUpdate(
        { slug: req.params.slug },
        updates,
        { new: true },
      );
      if (!post) return res.status(404).json({ error: "Post not found" });
      res.json({ success: true, post });
    } catch (err) {
      if (err.code === 11000) {
        return res.status(400).json({ error: "Slug already exists" });
      }
 log.error("Blog", "Blog update error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  router.delete("/blog/posts/:slug", authenticate, async (req, res) => {
    try {
      const user = await User.findById(req.userId).select("profileType").lean();
      if (!user || user.profileType !== "god") {
        return res.status(403).json({ error: "Requires god plan" });
      }

      const post = await BlogPost.findOneAndDelete({ slug: req.params.slug });
      if (!post) return res.status(404).json({ error: "Post not found" });
      res.json({ success: true, deleted: req.params.slug });
    } catch (err) {
 log.error("Blog", "Blog delete error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
