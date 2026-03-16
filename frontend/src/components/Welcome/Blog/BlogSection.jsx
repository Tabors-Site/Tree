import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import "./BlogSection.css";

const API_BASE = import.meta.env.VITE_API_URL || "";

const BlogSection = () => {
  const { slug } = useParams();
  const [posts, setPosts] = useState([]);
  const [activePost, setActivePost] = useState(null);
  const [postNotFound, setPostNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch(`${API_BASE}/api/v1/blog/posts`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setPosts(data.posts);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (posts.length === 0) return;
    const targetSlug = slug || posts[0]?.slug;
    if (!targetSlug) return;

    setActivePost(null);
    setPostNotFound(false);
    fetch(`${API_BASE}/api/v1/blog/posts/${targetSlug}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setActivePost(data.post);
        else setPostNotFound(true);
      })
      .catch(() => setPostNotFound(true));
  }, [slug, posts]);

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const activeSlug = slug || posts[0]?.slug;

  return (
    <div className="blog-page">
      {/* Hidden checkbox for CSS-only mobile menu toggle (works without JS) */}
      <input type="checkbox" id="blog-menu-toggle" className="blog-menu-checkbox" />

      {/* Top header bar */}
      <header className="blog-header">
        <div className="blog-header-left">
          <label htmlFor="blog-menu-toggle" className="blog-menu-btn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </label>
          <a className="blog-header-home" href="/">
            <span className="blog-header-logo">🌳</span>
            <span>Blog</span>
          </a>
        </div>
        <a href="/chat" className="blog-header-back">Start Chat</a>
      </header>

      {/* Body: sidebar + content */}
      <div className="blog-body">
        {/* Sidebar */}
        <nav className="blog-nav">
          <div className="blog-nav-list">
            {posts.map((p) => (
              <a
                key={p.slug}
                className={`blog-nav-item ${p.slug === activeSlug ? "active" : ""}`}
                href={`/blog/${p.slug}`}
              >
                <span className="blog-nav-item-title">{p.title}</span>
                <span className="blog-nav-item-date">{formatDate(p.publishedAt)}</span>
              </a>
            ))}
          </div>
        </nav>

        {/* Mobile overlay - clicking closes menu via label */}
        <label htmlFor="blog-menu-toggle" className="blog-overlay" />

        {/* Main content */}
        <main className="blog-main">
          <div className="blog-content-wrap">
            {loading ? (
              <div className="blog-loading">Loading...</div>
            ) : posts.length === 0 ? (
              <div className="blog-empty">No posts yet. Check back soon.</div>
            ) : activePost ? (
              <article className="blog-article">
                <header className="blog-article-header">
                  <h1 className="blog-article-title">{activePost.title}</h1>
                  <div className="blog-article-meta">
                    {activePost.authorName && (
                      <span className="blog-article-author">{activePost.authorName}</span>
                    )}
                    <time className="blog-article-date">{formatDate(activePost.publishedAt)}</time>
                  </div>
                </header>
                <div
                  className="blog-article-body"
                  dangerouslySetInnerHTML={{ __html: activePost.content }}
                />
              </article>
            ) : postNotFound ? (
              <div className="blog-empty">Post not found.</div>
            ) : (
              <div className="blog-loading">Loading post...</div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default BlogSection;
