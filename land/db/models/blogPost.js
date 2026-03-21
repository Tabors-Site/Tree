import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const BlogPostSchema = new mongoose.Schema({
  _id: { type: String, default: uuidv4 },
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  content: { type: String, required: true },
  summary: { type: String, default: "" },
  publishedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
  published: { type: Boolean, default: true },
  author: { type: String, ref: "User" },
  authorName: { type: String, default: "" },
});

const BlogPost = mongoose.model("BlogPost", BlogPostSchema);
export default BlogPost;
