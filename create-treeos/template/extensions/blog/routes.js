import log from "../../seed/log.js";
import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
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
      sendOk(res, { posts });
    } catch (err) {
      log.error("Blog", "Blog list error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.get("/blog/posts/:slug", async (req, res) => {
    try {
      const post = await BlogPost.findOne({
        slug: req.params.slug,
        published: true,
      }).lean();
      if (!post) return sendError(res, 404, ERR.NOTE_NOT_FOUND, "Post not found");
      sendOk(res, { post });
    } catch (err) {
      log.error("Blog", "Blog post error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.post("/blog/posts", authenticate, async (req, res) => {
    try {
      const user = await User.findById(req.userId)
        .select("isAdmin username")
        .lean();
      if (!user || !user.isAdmin) {
        return sendError(res, 403, ERR.FORBIDDEN, "Requires admin");
      }

      const { title, slug, content, summary, publishedAt, published } = req.body;
      if (!title || !slug || !content) {
        return sendError(res, 400, ERR.INVALID_INPUT, "title, slug, and content are required");
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

      sendOk(res, { post }, 201);
    } catch (err) {
      if (err.code === 11000) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Slug already exists");
      }
      log.error("Blog", "Blog create error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.put("/blog/posts/:slug", authenticate, async (req, res) => {
    try {
      const user = await User.findById(req.userId).select("isAdmin").lean();
      if (!user || !user.isAdmin) {
        return sendError(res, 403, ERR.FORBIDDEN, "Requires admin");
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
      if (!post) return sendError(res, 404, ERR.NOTE_NOT_FOUND, "Post not found");
      sendOk(res, { post });
    } catch (err) {
      if (err.code === 11000) {
        return sendError(res, 400, ERR.INVALID_INPUT, "Slug already exists");
      }
      log.error("Blog", "Blog update error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.delete("/blog/posts/:slug", authenticate, async (req, res) => {
    try {
      const user = await User.findById(req.userId).select("isAdmin").lean();
      if (!user || !user.isAdmin) {
        return sendError(res, 403, ERR.FORBIDDEN, "Requires admin");
      }

      const post = await BlogPost.findOneAndDelete({ slug: req.params.slug });
      if (!post) return sendError(res, 404, ERR.NOTE_NOT_FOUND, "Post not found");
      sendOk(res, { deleted: req.params.slug });
    } catch (err) {
      log.error("Blog", "Blog delete error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  return router;
}
