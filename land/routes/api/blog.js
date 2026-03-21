import express from "express";
import BlogPost from "../../db/models/blogPost.js";
import authenticate from "../../middleware/authenticate.js";
import User from "../../db/models/user.js";

const router = express.Router();

// List all published posts (summary only)
router.get("/blog/posts", async (req, res) => {
  try {
    const posts = await BlogPost.find({ published: true })
      .select("title slug summary publishedAt authorName")
      .sort({ publishedAt: -1 })
      .lean();
    res.json({ success: true, posts });
  } catch (err) {
    console.error("Blog list error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get single post by slug
router.get("/blog/posts/:slug", async (req, res) => {
  try {
    const post = await BlogPost.findOne({
      slug: req.params.slug,
      published: true,
    }).lean();
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json({ success: true, post });
  } catch (err) {
    console.error("Blog post error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Create a blog post (god plan only)
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
    console.error("Blog create error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update a blog post by slug (god plan only)
router.put("/blog/posts/:slug", authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select("profileType").lean();
    if (!user || user.profileType !== "god") {
      return res.status(403).json({ error: "Requires god plan" });
    }

    const updates = {};
    const allowed = [
      "title",
      "slug",
      "content",
      "summary",
      "publishedAt",
      "published",
    ];
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        updates[key] =
          key === "publishedAt" ? new Date(req.body[key]) : req.body[key];
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
    console.error("Blog update error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Delete a blog post by slug (god plan only)
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
    console.error("Blog delete error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
