import express from "express";
import Book from "./model.js";
import authenticate, { authenticateOptional } from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import {
  getBook as coreGetBook,
  generateBook as coreGenerateBook,
} from "./core.js";
import { getExtension } from "../loader.js";
function html() { return getExtension("html-rendering")?.exports || {}; }

function notFoundPage(req, res, message = "This page doesn't exist or may have been moved.") {
  const fn = getExtension("html-rendering")?.exports?.notFoundPage;
  if (fn) return fn(req, res, message);
  return sendError(res, 404, ERR.NODE_NOT_FOUND, message);
}

const router = express.Router();

router.get("/root/:nodeId/book", authenticateOptional, async (req, res) => {
  try {
    const { nodeId } = req.params;

    const options = {
      latestVersionOnly: html().parseBool(req.query.latestVersionOnly),
      lastNoteOnly: html().parseBool(req.query.lastNoteOnly),
      leafNotesOnly: html().parseBool(req.query.leafNotesOnly),
      filesOnly: html().parseBool(req.query.filesOnly),
      textOnly: html().parseBool(req.query.textOnly),
      statusFilters: html().normalizeStatusFilters(req.query),
    };

    const tocEnabled = html().parseBool(req.query.toc);
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

    if (wantHtml && getExtension("html-rendering")) {
      const token = req.query.token || "";
      const title = book?.nodeName ?? book?.nodeId ?? `Node ${nodeId}`;
      const content = hasContent
        ? html().renderBookNode(book, 1, token)
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
        html().renderBookPage({
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

    return sendOk(res, { book });
  } catch (err) {
    return sendError(res, 400, ERR.INVALID_INPUT, err.message);
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

    return sendOk(res, {
      redirect: `/api/v1/root/${nodeId}/book/share/${shareId}?html`,
    });
  } catch (err) {
    return sendError(res, 400, ERR.INVALID_INPUT, err.message);
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

    if (wantHtml && getExtension("html-rendering")) {
      const token = req.query.token || "";
      const title = book?.nodeName ?? book?.nodeId ?? `Node ${nodeId}`;
      const content = hasContent
        ? html().renderBookNode(book, 1, token)
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
        html().renderSharedBookPage({
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

    return sendOk(res, { book });
  } catch (err) {
    return sendError(res, 400, ERR.INVALID_INPUT, err.message);
  }
});

export default router;
