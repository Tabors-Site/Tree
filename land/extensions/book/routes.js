import express from "express";
import Book from "./model.js";
import urlAuth from "../../middleware/urlAuth.js";
import authenticate from "../../middleware/authenticate.js";
import { notFoundPage } from "../../middleware/notFoundPage.js";
import {
  getBook as coreGetBook,
  generateBook as coreGenerateBook,
} from "./core.js";
import {
  renderBookPage,
  renderSharedBookPage,
  renderBookNode,
  parseBool,
  normalizeStatusFilters,
} from "../../routes/api/html/notes.js";

const router = express.Router();

router.get("/root/:nodeId/book", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;

    const options = {
      latestVersionOnly: parseBool(req.query.latestVersionOnly),
      lastNoteOnly: parseBool(req.query.lastNoteOnly),
      leafNotesOnly: parseBool(req.query.leafNotesOnly),
      filesOnly: parseBool(req.query.filesOnly),
      textOnly: parseBool(req.query.textOnly),
      statusFilters: normalizeStatusFilters(req.query),
    };

    const tocEnabled = parseBool(req.query.toc);
    const tocDepth = parseInt(req.query.tocDepth) || 0;

    const wantHtml = req.query.html !== undefined;
    const { book } = await coreGetBook({ nodeId, options });

    const hasContent =
      !!book && (book.notes?.length > 0 || book.children?.length > 0);
    const q = req.query;

    const isStatusActive = q.active === undefined ? true : q.active === "true";
    const isStatusCompleted =
      q.completed === undefined ? true : q.completed === "true";
    const isStatusTrimmed = q.trimmed === "true";

    if (wantHtml && process.env.ENABLE_FRONTEND_HTML === "true") {
      const token = req.query.token || "";
      const title = book?.nodeName ?? book?.nodeId ?? `Node ${nodeId}`;
      const content = hasContent
        ? renderBookNode(book, 1, token)
        : `
    <div class="empty-state">
      <div class="empty-state-icon"></div>
      <div class="empty-state-text">No content</div>
      <div class="empty-state-subtext">
        This node has no notes or child notes under the current filters.
      </div>
    </div>
  `;

      return res.send(
        renderBookPage({
          nodeId,
          token,
          title,
          content,
          options,
          tocEnabled,
          tocDepth,
          isStatusActive,
          isStatusCompleted,
          isStatusTrimmed,
          book,
          hasContent,
        }),
      );
    }

    return res.json({ success: true, book });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.post("/root/:nodeId/book/generate", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params;

    const settings = {
      latestVersionOnly: !!req.body.latestVersionOnly,
      lastNoteOnly: !!req.body.lastNoteOnly,
      leafNotesOnly: !!req.body.leafNotesOnly,
      filesOnly: !!req.body.filesOnly,
      textOnly: !!req.body.textOnly,
      active: req.body.active !== undefined ? !!req.body.active : true,
      completed: req.body.completed !== undefined ? !!req.body.completed : true,
      toc: !!req.body.toc,
      tocDepth: parseInt(req.body.tocDepth) || 0,
    };

    const { shareId } = await coreGenerateBook({
      nodeId,
      settings,
      userId: req.user?._id,
    });

    return res.json({
      success: true,
      redirect: `/api/v1/root/${nodeId}/book/share/${shareId}?html`,
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

router.get("/root/:nodeId/book/share/:shareId", async (req, res) => {
  try {
    const { nodeId, shareId } = req.params;
    const wantHtml = req.query.html !== undefined;

    const bookRecord = await Book.findOne({ shareId }).lean();
    if (!bookRecord) {
      return notFoundPage(
        req,
        res,
        "This book doesn't exist or may have been removed.",
      );
    }

    if (bookRecord.nodeId !== nodeId) {
      return notFoundPage(req, res, "This book link is invalid.");
    }

    const options = {
      latestVersionOnly: bookRecord.settings.latestVersionOnly,
      lastNoteOnly: bookRecord.settings.lastNoteOnly,
      leafNotesOnly: bookRecord.settings.leafNotesOnly,
      filesOnly: bookRecord.settings.filesOnly,
      textOnly: bookRecord.settings.textOnly,
      statusFilters: bookRecord.settings,
    };

    const shareTocEnabled = !!bookRecord.settings.toc;
    const shareTocDepth = bookRecord.settings.tocDepth || 0;

    const { book } = await coreGetBook({ nodeId, options });
    const hasContent =
      !!book && (book.notes?.length > 0 || book.children?.length > 0);

    if (wantHtml && process.env.ENABLE_FRONTEND_HTML === "true") {
      const token = req.query.token || "";
      const title = book?.nodeName ?? book?.nodeId ?? `Node ${nodeId}`;
      const content = hasContent
        ? renderBookNode(book, 1, token)
        : `
    <div class="empty-state">
      <div class="empty-state-icon"></div>
      <div class="empty-state-text">No content</div>
      <div class="empty-state-subtext">
        This node has no notes or child notes under the current filters.
      </div>
    </div>
  `;

      return res.send(
        renderSharedBookPage({
          nodeId,
          shareId,
          title,
          content,
          shareTocEnabled,
          shareTocDepth,
          book,
          hasContent,
        }),
      );
    }

    return res.json({ success: true, book });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
