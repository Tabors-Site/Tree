import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import authenticate from "../middleware/authenticate.js";

import path from "path";
import fs from "fs";
import multer from "multer";
import mime from "mime-types";

import User from "../db/models/user.js";
import { getAIChats } from "../core/aichat.js";

import { createPurchaseSession } from "../routes/billing/purchase.js";
import {
  setCustomLlmConnection,
  clearCustomLlmConnection,
  setCustomLlmRevoked,
} from "../core/customLLM.js";

import {
  getAllNotesByUser as coreGetAllNotesByUser,
  getAllTagsForUser as coreGetAllTagsForUser,
  searchNotesByUser as coreSearchNotesByUser,
} from "../core/notes.js";
import { getContributionsByUser } from "../core/contributions.js";

import { getDeletedBranchesForUser } from "../core/treeFetch.js";

import { setHtmlShareToken } from "../core/user.js";
import { maybeResetEnergy } from "../core/energy.js";

import {
  createNewNode,
  reviveNodeBranch,
  reviveNodeBranchAsRoot,
} from "../core/treeManagement.js";

import { getPendingInvitesForUser, respondToInvite } from "../core/invites.js";

import {
  createRawIdea as coreCreateRawIdea,
  getRawIdeas as coreGetRawIdeas,
  searchRawIdeasByUser as coreSearchRawIdeasByUser,
  deleteRawIdeaAndFile as coreDeleteRawIdeaAndFile,
  convertRawIdeaToNote as coreConvertRawIdeaToNote,
} from "../core/rawIdea.js";

import {
  createApiKey,
  listApiKeys,
  deleteApiKey,
} from "../controllers/users.js";

import getNodeName from "./helpers/getNameById.js";

import { processPurchase } from "../core/billing/processPurchase.js";

const uploadsFolder = path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadsFolder)) {
  fs.mkdirSync(uploadsFolder);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsFolder),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + "-" + Math.random().toString(36).slice(2);
    cb(null, name + ext);
  },
});

const upload = multer({ storage });

const router = express.Router();

const allowedParams = ["token", "html", "limit", "startTime", "endTime", "q"];

function renderMedia(fileUrl, mimeType) {
  if (mimeType.startsWith("image/")) {
    return `<img src="${fileUrl}" style="max-width:100%;" />`;
  }

  if (mimeType.startsWith("video/")) {
    return `<video src="${fileUrl}" controls style="max-width:100%;"></video>`;
  }

  if (mimeType.startsWith("audio/")) {
    return `<audio src="${fileUrl}" controls></audio>`;
  }

  if (mimeType === "application/pdf") {
    return `
      <iframe
        src="${fileUrl}"
        style="width:100%; height:90vh; border:none;"
      ></iframe>
    `;
  }

  // Unknown / non-previewable formats (epub, zip, etc.)
  return ``;
}

router.get("/user/:userId", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const user = await User.findById(userId)
      .populate("roots", "name _id")
      .lean()
      .exec();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    maybeResetEnergy(user);

    const roots = user.roots || [];
    const profileType = user.profileType || "basic";
    const energy = user.availableEnergy;
    const extraEnergy = user.additionalEnergy;

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml) {
      return res.json({
        userId: user._id,
        username: user.username,
        roots,
        profileType,
        energy,
      });
    }

    const ENERGY_RESET_MS = 24 * 60 * 60 * 1000;
    const storageUsedKB = user.storageUsage || 0;

    const lastResetAt = energy?.lastResetAt
      ? new Date(energy.lastResetAt)
      : null;

    const nextResetAt = lastResetAt
      ? new Date(lastResetAt.getTime() + ENERGY_RESET_MS)
      : null;

    const resetTimeLabel = nextResetAt
      ? nextResetAt.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>@${user.username} — Profile</title>
  <style>
    :root {
      --glass-water-rgb: 115, 111, 230;
      --glass-alpha: 0.28;
      --glass-alpha-hover: 0.38;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
      position: relative;
      overflow-x: hidden;
    }

    /* Animated background */
    body::before,
    body::after {
      content: '';
      position: fixed;
      border-radius: 50%;
      opacity: 0.08;
      animation: float 20s infinite ease-in-out;
      pointer-events: none;
    }

    body::before {
      width: 600px;
      height: 600px;
      background: white;
      top: -300px;
      right: -200px;
      animation-delay: -5s;
    }

    body::after {
      width: 400px;
      height: 400px;
      background: white;
      bottom: -200px;
      left: -100px;
      animation-delay: -10s;
    }
       html, body {
        background: #736fe6;
        margin: 0;
        padding: 0;
      }

    @keyframes float {
      0%, 100% {
        transform: translateY(0) rotate(0deg);
      }
      50% {
        transform: translateY(-30px) rotate(5deg);
      }
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    /* Glass Card Base */
    .glass-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      padding: 32px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
      animation: fadeInUp 0.6s ease-out both;
    }

    /* Header Section */
    .header {
      animation-delay: 0.1s;
    }

    .user-info h1 {
      font-size: 32px;
      font-weight: 700;
      color: white;
      margin-bottom: 16px;
      letter-spacing: -0.5px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .user-info h1::before {
      content: '👤 ';
      font-size: 28px;
    }

    /* User Meta Info */
    .user-meta {
      display: flex;
      gap: 12px;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
.send-button.loading {
  pointer-events: none;
  opacity: 0.9;
}

.send-progress {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  width: 0%;
  background: linear-gradient(
    90deg,
    rgba(255,255,255,0.25),
    rgba(255,255,255,0.6),
    rgba(255,255,255,0.25)
  );
  transition: width 0.2s ease;
  pointer-events: none;
}

    .plan-badge {
      padding: 8px 16px;
      border-radius: 980px;
      font-weight: 600;
      font-size: 13px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.9);
      color: #667eea;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
.plan-basic {
  background: rgba(255, 255, 255, 0.9);
  color: #64748b;
}

/* STANDARD */
.plan-standard {
  background: linear-gradient(135deg, #60a5fa, #2563eb);
  color: white;
}

/* PREMIUM */
.plan-premium {
  background: linear-gradient(135deg, #a855f7, #7c3aed);
  color: white;
}

/* GOD ✨ */
.plan-god {
  background: linear-gradient(
    135deg,
    #facc15,
    #f59e0b,
    #eab308
  );
  color: #3a2e00;
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.6);
  box-shadow:
    0 0 20px rgba(250, 204, 21, 0.6),
    0 6px 24px rgba(234, 179, 8, 0.5);
  border: 1px solid rgba(255, 215, 0, 0.9);
}
    .meta-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      border-radius: 980px;
      font-size: 13px;
      font-weight: 500;
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.3);
    }

    .storage-toggle-btn {
      padding: 2px 8px;
      margin-left: 4px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.4);
      background: rgba(255, 255, 255, 0.2);
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      color: white;
    }

    .storage-toggle-btn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.05);
    }

    .logout-btn {
      padding: 8px 16px;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(239, 68, 68, 0.3);
      backdrop-filter: blur(10px);
      color: white;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.3s;
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.2);
    }

    .logout-btn:hover {
      background: rgba(239, 68, 68, 0.5);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(239, 68, 68, 0.3);
    }

    /* User ID */
    .user-id-container {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      border-radius: 10px;
      margin-top: 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .user-id-container code {
      flex: 1;
      background: transparent;
      padding: 0;
      font-size: 13px;
      font-family: 'SF Mono', Monaco, monospace;
      color: white;
      font-weight: 600;
      word-break: break-all;
    }

    #copyNodeIdBtn {
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      cursor: pointer;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 16px;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    #copyNodeIdBtn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.1);
    }

    /* Raw Ideas Capture - Enhanced with glow */
    .raw-ideas-section {
      animation-delay: 0.2s;
      box-shadow: 
        0 20px 60px rgba(16, 185, 129, 0.3),
        0 0 40px rgba(16, 185, 129, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
    }

    .raw-ideas-section::after {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(
        circle,
        rgba(16, 185, 129, 0.15) 0%,
        transparent 70%
      );
      animation: pulse 8s ease-in-out infinite;
      pointer-events: none;
    }

    @keyframes pulse {
      0%, 100% {
        transform: scale(1) rotate(0deg);
        opacity: 0.5;
      }
      50% {
        transform: scale(1.1) rotate(180deg);
        opacity: 0.8;
      }
    }

    .raw-ideas-section h2 {
      font-size: 20px;
      font-weight: 600;
      color: white;
      margin-bottom: 20px;
      position: relative;
      z-index: 1;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2),
        0 0 20px rgba(16, 185, 129, 0.4);
    }

    .raw-ideas-section h2::before {
      content: '💡 ';
      font-size: 20px;
    }

    .raw-idea-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
      position: relative;
      z-index: 1;
    }

    #rawIdeaInput {
      width: 100%;
      padding: 16px 20px;
      font-size: 16px;
      line-height: 1.6;
      border-radius: 12px;
      border: 2px solid rgba(255, 255, 255, 0.4);
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(20px) saturate(150%);
      -webkit-backdrop-filter: blur(20px) saturate(150%);
      font-family: inherit;
      resize: vertical;
      min-height: 80px;
      max-height: 400px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 
        0 4px 20px rgba(0, 0, 0, 0.15),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
      color: #5044c9;
      font-weight: 600;
      text-shadow: 
        0 0 12px rgba(102, 126, 234, 0.7),
        0 0 20px rgba(102, 126, 234, 0.4),
        0 1px 3px rgba(255, 255, 255, 1),
        0 2px 8px rgba(80, 68, 201, 0.5);
      letter-spacing: 0.3px;
    }

    #rawIdeaInput:focus {
      outline: none;
      border-color: rgba(102, 126, 234, 0.6);
      backdrop-filter: blur(28px) saturate(170%);
      -webkit-backdrop-filter: blur(28px) saturate(170%);
      box-shadow: 
        0 0 0 4px rgba(102, 126, 234, 0.25),
        0 0 40px rgba(102, 126, 234, 0.5),
        0 8px 30px rgba(102, 126, 234, 0.3),
        inset 0 1px 0 rgba(255, 255, 255, 0.6);
      transform: translateY(-2px);
    }
    
    #rawIdeaInput:focus::placeholder {
      color: rgba(80, 68, 201, 0.4);
    }

    #rawIdeaInput::placeholder {
      color: rgba(80, 68, 201, 0.4);
      font-weight: 400;
      text-shadow: 0 0 6px rgba(102, 126, 234, 0.25);
    }

    #rawIdeaInput:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      background: rgba(255, 255, 255, 0.1);
      transform: none;
    }

    #rawIdeaInput:disabled::placeholder {
      color: rgba(80, 68, 201, 0.25);
    }

    /* Character counter */
    .char-counter {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      margin-top: -8px;
      margin-bottom: 8px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 500;
      transition: color 0.2s;
    }

    .char-counter.warning {
      color: rgba(255, 193, 7, 0.9);
    }

    .char-counter.danger {
      color: rgba(239, 68, 68, 0.9);
      font-weight: 600;
    }

    .char-counter.disabled {
      opacity: 0.4;
    }

    /* Energy display */
    .energy-display {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 10px;
      padding: 2px 8px;
      background: rgba(255, 215, 79, 0.2);
      border: 1px solid rgba(255, 215, 79, 0.3);
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
      color: rgba(255, 215, 79, 1);
      transition: all 0.2s;
    }

    .energy-display:empty {
      display: none;
    }

    .energy-display.file-energy {
      background: rgba(255, 220, 100, 0.9);
      border-color: rgba(255, 200, 50, 1);
      color: #1a1a1a;
      font-size: 13px;
      font-weight: 700;
      padding: 4px 12px;
      box-shadow: 0 2px 8px rgba(255, 200, 50, 0.4);
    }

    /* File selected badge */
    .file-selected-badge {
      display: none;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      color: white;
    }

    .file-selected-badge.visible {
      display: inline-flex;
    }

    .file-selected-badge .file-name {
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .file-selected-badge .clear-file {
      background: rgba(255, 255, 255, 0.2);
      border: none;
      border-radius: 50%;
      width: 18px;
      height: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 10px;
      color: white;
      transition: all 0.2s;
    }

    .file-selected-badge .clear-file:hover {
      background: rgba(239, 68, 68, 0.4);
    }

    .form-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .file-input-wrapper {
      flex: 1;
      min-width: 180px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    input[type="file"] {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.9);
      cursor: pointer;
    }

    input[type="file"]::file-selector-button {
      padding: 8px 16px;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      color: white;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s;
      margin-right: 10px;
    }

    input[type="file"]::file-selector-button:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-1px);
    }

    input[type="file"].hidden-input {
      display: none;
    }

    .send-button {
      padding: 14px 32px;
      font-size: 16px;
      font-weight: 600;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(16, 185, 129, 0.9);
      backdrop-filter: blur(10px);
      color: white;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);
      white-space: nowrap;
      position: relative;
      overflow: hidden;
    }

    .send-button::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .send-button:hover {
      background: rgba(16, 185, 129, 1);
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(16, 185, 129, 0.5);
    }

    .send-button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    /* Navigation Section */
    .nav-section {
      animation-delay: 0.3s;
    }

    .nav-section h2 {
      font-size: 18px;
      font-weight: 600;
      color: white;
      margin-bottom: 20px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .nav-links {
      list-style: none;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
    }

    .nav-links a {
      display: block;
      padding: 14px 18px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      border-radius: 980px;
      color: white;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.3s;
      border: 1px solid rgba(255, 255, 255, 0.3);
      text-align: center;
      position: relative;
      overflow: hidden;
    }

    .nav-links a::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: linear-gradient(
        120deg,
        transparent 40%,
        rgba(255, 255, 255, 0.25),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-100%);
      transition: opacity 0.3s, transform 0.6s;
    }

    .nav-links a:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .nav-links a:hover::before {
      opacity: 1;
      transform: translateX(100%);
    }

    /* Roots Section */
    .roots-section {
      animation-delay: 0.4s;
    }

    .roots-section h2 {
      font-size: 20px;
      font-weight: 600;
      color: white;
      margin-bottom: 20px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }

    .roots-section h2::before {
      content: '🌳 ';
      font-size: 20px;
    }

    .roots-list {
      list-style: none;
      margin-bottom: 24px;
    }

    .roots-list li {
      margin-bottom: 10px;
    }

    .roots-list a {
      display: block;
      padding: 14px 18px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      color: white;
      text-decoration: none;
      font-weight: 500;
      font-size: 15px;
      transition: all 0.3s;
      border: 1px solid rgba(255, 255, 255, 0.25);
      position: relative;
      overflow: hidden;
    }

    .roots-list a::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: linear-gradient(
        120deg,
        transparent 40%,
        rgba(255, 255, 255, 0.25),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-100%);
      transition: opacity 0.3s, transform 0.6s;
    }

    .roots-list a:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateX(4px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .roots-list a:hover::before {
      opacity: 1;
      transform: translateX(100%);
    }

    .roots-list em {
      color: rgba(255, 255, 255, 0.7);
      font-style: italic;
      display: block;
      padding: 20px;
      text-align: center;
    }

    /* Create Root Form */
    .create-root-form {
      display: flex;
      gap: 12px;
      align-items: stretch;
    }

    .create-root-form input[type="text"] {
      flex: 1;
      padding: 14px 18px;
      font-size: 15px;
      border-radius: 12px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.9);
      font-family: inherit;
      transition: all 0.2s;
    }

    .create-root-form input[type="text"]:focus {
      outline: none;
      border-color: white;
      background: white;
      box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.2),
        0 4px 20px rgba(0, 0, 0, 0.1);
    }

    .create-root-button {
      padding: 14px 20px;
      font-size: 24px;
      line-height: 1;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      background: rgba(255, 255, 255, 0.25);
      backdrop-filter: blur(10px);
      color: white;
      cursor: pointer;
      transition: all 0.3s;
      font-weight: 300;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
    }

    .create-root-button::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.35),
        transparent 60%
      );
      opacity: 0;
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .create-root-button:hover {
      background: rgba(255, 255, 255, 0.35);
      transform: scale(1.05) translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    .create-root-button:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    /* Responsive Design */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .glass-card {
        padding: 24px 20px;
      }

      .user-info h1 {
        font-size: 28px;
      }

      .user-meta {
        flex-direction: column;
        align-items: stretch;
        gap: 8px;
      }

      .meta-item,
      .plan-badge,
      .logout-btn {
        width: 100%;
        justify-content: center;
      }

      .form-actions {
        flex-direction: column;
        align-items: stretch;
      }

      .file-input-wrapper {
        order: 2;
        min-width: auto;
      }

      .send-button {
        order: 1;
        width: 100%;
      }

      .nav-links {
        grid-template-columns: 1fr;
      }

      .create-root-form {
        flex-direction: column;
      }

      .create-root-button {
        width: 100%;
      }

      .user-id-container code {
        font-size: 11px;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 750px;
      }

      .nav-links {
        grid-template-columns: repeat(2, 1fr);
      }
    }
      a {
text-decoration: none;
        color: inherit;}
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="glass-card header">
      <div class="user-info">
       <a href="/api/v1/user/${userId}/energy${queryString}">
        <h1>@${user.username}</h1> </a>

        <div class="user-meta">
   <a href="/api/v1/user/${userId}/energy${queryString}">
  <span class="plan-badge plan-${profileType}">
  ${profileType === "god" ? "👑 " : ""}
  ${profileType.charAt(0).toUpperCase() + profileType.slice(1)} Plan
</span></a>

          <span class="meta-item">
            <a href="/api/v1/user/${userId}/energy${queryString}">⚡ ${(energy?.amount ?? 0) + (extraEnergy?.amount ?? 0)} · resets ${resetTimeLabel}
</a>
          </span>

          <span class="meta-item">
            💾 <span id="storageValue"></span>
            <button
              id="storageToggle"
              class="storage-toggle-btn"
              data-storage-kb="${storageUsedKB}"
            >
              MB
            </button>
            used
          </span>

          <button id="logoutBtn" class="logout-btn">
            Log out
          </button>
        </div>

        <div class="user-id-container">
          <code id="nodeIdCode">${user._id}</code>
          <button id="copyNodeIdBtn" title="Copy ID">📋</button>
        </div>
      </div>
    </div>

    <!-- Raw Ideas Capture -->
    <div class="glass-card raw-ideas-section">
      <h2>Capture a Raw Idea</h2>
      <form
        method="POST"
        action="/api/v1/user/${userId}/raw-ideas${queryString}"
        enctype="multipart/form-data"
        class="raw-idea-form"
        id="rawIdeaForm"
      >
        <textarea
          name="content"
          placeholder="What's on your mind?"
          id="rawIdeaInput"
          rows="1"
          maxlength="5000"
          autofocus
        ></textarea>

        <div class="char-counter" id="charCounter">
          <span id="charCount">0</span> / 5000
          <span class="energy-display" id="energyDisplay"></span>
        </div>

        <div class="form-actions">
          <div class="file-input-wrapper">
            <input type="file" name="file" id="fileInput" />
            <div class="file-selected-badge" id="fileSelectedBadge">
              <span>📎</span>
              <span class="file-name" id="fileName"></span>
              <button type="button" class="clear-file" id="clearFileBtn" title="Remove file">✕</button>
            </div>
          </div>
          <button type="submit" class="send-button" title="Save raw idea" id="rawIdeaSendBtn">
            <span class="send-label">Send</span>
            <span class="send-progress"></span>
          </button>
        </div>
      </form>
    </div>

    <!-- Navigation Links -->
    <div class="glass-card nav-section">
      <h2>Quick Links</h2>
      <ul class="nav-links">
        <li><a href="/api/v1/user/${userId}/raw-ideas${queryString}">Raw Ideas</a></li>
                <li><a href="/api/v1/user/${userId}/chats${queryString}">AI Chats</a></li>

        <li><a href="/api/v1/user/${userId}/notes${queryString}">Notes</a></li>
        <li><a href="/api/v1/user/${userId}/tags${queryString}">Mail</a></li>
        <li><a href="/api/v1/user/${userId}/contributions${queryString}">Contributions</a></li>
        <li><a href="/api/v1/user/${userId}/invites${queryString}">Invites</a></li>
        <li><a href="/api/v1/user/${userId}/deleted${queryString}">Deleted</a></li>
        <li><a href="/api/v1/user/${userId}/api-keys${queryString}">API Keys</a></li>
        <li><a href="/api/v1/user/${userId}/sharetoken${queryString}">Share Token</a></li>
      </ul>
    </div>

    <!-- Roots Section -->
    <div class="glass-card roots-section">
      <h2>My Roots</h2>
      ${
        roots.length > 0
          ? `
        <ul class="roots-list">
          ${roots
            .map(
              (r) => `
            <li>
              <a href="/api/v1/root/${r._id}${queryString}">
                ${r.name || "Untitled"}
              </a>
            </li>
          `,
            )
            .join("")}
        </ul>
      `
          : `<ul class="roots-list"><li><em>No roots yet — create your first one below!</em></li></ul>`
      }
      
      <form
        method="POST"
        action="/api/v1/user/${userId}/createRoot${queryString}"
        class="create-root-form"
      >
        <input
          type="text"
          name="name"
          placeholder="New root name..."
          required
        />
        <button type="submit" class="create-root-button" title="Create root">
          ＋
        </button>
      </form>
    </div>
  </div>

  <script>
    // Copy ID functionality
    document.getElementById("copyNodeIdBtn").addEventListener("click", () => {
      const code = document.getElementById("nodeIdCode");
      const btn = document.getElementById("copyNodeIdBtn");
      
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = "✔️";
        setTimeout(() => (btn.textContent = "📋"), 1000);
      });
    });

    // Storage toggle
    (() => {
      const toggleBtn = document.getElementById("storageToggle");
      const valueEl = document.getElementById("storageValue");
      const storageKB = Number(toggleBtn.dataset.storageKb || 0);
      let unit = "MB";

      function render() {
        if (unit === "MB") {
          const mb = storageKB / 1024;
          valueEl.textContent = mb.toFixed(mb < 10 ? 2 : 1);
          toggleBtn.textContent = "MB";
        } else {
          const gb = storageKB / (1024 * 1024);
          valueEl.textContent = gb.toFixed(gb < 1 ? 3 : 2);
          toggleBtn.textContent = "GB";
        }
      }

      toggleBtn.addEventListener("click", () => {
        unit = unit === "GB" ? "MB" : "GB";
        render();
      });

      render();
    })();

    // Logout
    document.getElementById("logoutBtn").addEventListener("click", async () => {
      try {
        await fetch("/api/v1/logout", {
          method: "POST",
          credentials: "include",
        });
        window.top.location.href = "/login";
      } catch (err) {
        console.error("Logout failed", err);
        alert("Logout failed. Please try again.");
      }
    });

    // Elements
    const form = document.getElementById('rawIdeaForm');
    const textarea = document.getElementById('rawIdeaInput');
    const charCounter = document.getElementById('charCounter');
    const charCount = document.getElementById('charCount');
    const energyDisplay = document.getElementById('energyDisplay');
    const fileInput = document.getElementById('fileInput');
    const fileSelectedBadge = document.getElementById('fileSelectedBadge');
    const fileName = document.getElementById('fileName');
    const clearFileBtn = document.getElementById('clearFileBtn');
    const sendBtn = document.getElementById('rawIdeaSendBtn');
    const progressBar = sendBtn.querySelector('.send-progress');

    const MAX_CHARS = 5000;
    let hasFile = false;

    // Auto-resize textarea
    function autoResize() {
      textarea.style.height = 'auto';
      const maxHeight = 400;
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = newHeight + 'px';
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
      updateCharCounter();
    }
    
    textarea.addEventListener('input', autoResize);
    autoResize();

    // Character counter with energy (1 per 1000 chars)
    function updateCharCounter() {
      const len = textarea.value.length;
      charCount.textContent = len;
      
      const remaining = MAX_CHARS - len;
      charCounter.classList.remove('warning', 'danger', 'disabled');
      
      if (hasFile) {
        charCounter.classList.add('disabled');
      } else if (remaining <= 100) {
        charCounter.classList.add('danger');
      } else if (remaining <= 500) {
        charCounter.classList.add('warning');
      }
      
      // Energy cost: 1 per 1000 chars (minimum 1 if any text)
      if (len > 0 && !hasFile) {
        const cost = Math.max(1, Math.ceil(len / 1000));
        energyDisplay.textContent = '⚡' + cost;
        energyDisplay.classList.remove('file-energy');
      } else if (!hasFile) {
        energyDisplay.textContent = '';
      }
    }

    // File energy calculation
    const FILE_MIN_COST = 5;
    const FILE_BASE_RATE = 1.5;
    const FILE_MID_RATE = 3;
    const SOFT_LIMIT_MB = 100;
    const HARD_LIMIT_MB = 1024;

    function calculateFileEnergy(sizeMB) {
      if (sizeMB <= SOFT_LIMIT_MB) {
        return Math.max(FILE_MIN_COST, Math.ceil(sizeMB * FILE_BASE_RATE));
      }
      if (sizeMB <= HARD_LIMIT_MB) {
        const base = SOFT_LIMIT_MB * FILE_BASE_RATE;
        const extra = (sizeMB - SOFT_LIMIT_MB) * FILE_MID_RATE;
        return Math.ceil(base + extra);
      }
      const base = SOFT_LIMIT_MB * FILE_BASE_RATE + 
                   (HARD_LIMIT_MB - SOFT_LIMIT_MB) * FILE_MID_RATE;
      const overGB = sizeMB - HARD_LIMIT_MB;
      return Math.ceil(base + Math.pow(overGB / 50, 2) * 50);
    }

    // File selection - blocks text input
    fileInput.addEventListener('change', function() {
      if (this.files && this.files[0]) {
        const file = this.files[0];
        hasFile = true;
        
        // Disable textarea
        textarea.disabled = true;
        textarea.value = '';
        textarea.placeholder = 'File selected - text disabled';
        
        // Show file badge, hide file input
        fileInput.classList.add('hidden-input');
        fileSelectedBadge.classList.add('visible');
        
        // Truncate filename
        let displayName = file.name;
        if (displayName.length > 20) {
          displayName = displayName.substring(0, 17) + '...';
        }
        fileName.textContent = displayName;
        fileSelectedBadge.title = file.name;
        
        // Calculate and show energy (+1 for the note itself)
        const sizeMB = file.size / (1024 * 1024);
        const fileCost = calculateFileEnergy(sizeMB);
        const totalCost = fileCost + 1;
        energyDisplay.textContent = '~⚡' + totalCost;
        energyDisplay.classList.add('file-energy');
        
        updateCharCounter();
      }
    });

    // Clear file selection
    clearFileBtn.addEventListener('click', function() {
      hasFile = false;
      fileInput.value = '';
      fileInput.classList.remove('hidden-input');
      fileSelectedBadge.classList.remove('visible');
      
      textarea.disabled = false;
      textarea.placeholder = "What's on your mind?";
      
      energyDisplay.textContent = '';
      energyDisplay.classList.remove('file-energy');
      
      updateCharCounter();
    });

    // Submit with Enter (desktop only)
    textarea.addEventListener("keydown", (e) => {
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (!isMobile && e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.requestSubmit();
      }
    });

    // Form submission with progress
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      sendBtn.classList.add('loading');
      sendBtn.disabled = true;
      progressBar.style.width = '15%';

      const formData = new FormData(form);
      const xhr = new XMLHttpRequest();

      xhr.open('POST', form.action, true);

      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const realPercent = (e.loaded / e.total) * 100;
        const lagged = Math.min(90, Math.round(realPercent * 0.8));
        progressBar.style.width = lagged + '%';
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          progressBar.style.width = '100%';
          setTimeout(() => document.location.reload(), 150);
        } else {
          fail();
        }
      };

      xhr.onerror = fail;

      function fail() {
        alert('Send failed');
        sendBtn.classList.remove('loading');
        sendBtn.disabled = false;
        progressBar.style.width = '0%';
      }

      xhr.send(formData);
    });

    // Form reset handler
    form.addEventListener('reset', () => {
      hasFile = false;
      fileInput.classList.remove('hidden-input');
      fileSelectedBadge.classList.remove('visible');
      textarea.disabled = false;
      textarea.placeholder = "What's on your mind?";
      energyDisplay.textContent = '';
      energyDisplay.classList.remove('file-energy');
      charCount.textContent = '0';
      charCounter.classList.remove('warning', 'danger', 'disabled');
    });
  </script>
</body>
</html>
`);
  } catch (err) {
    console.error("Error in /user/:userId:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/user/:userId/notes", urlAuth, async (req, res) => {
  try {
    const userId = req.params.userId;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    // NEW: search query
    const query = req.query.q || "";

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    const rawLimit = req.query.limit;
    let limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

       if (limit >= 200 || limit == undefined) {
      limit = 200;
    }
    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit: must be a positive number",
      });
    }

    // NEW: If search term exists → run search
    let result;
    if (query.trim() !== "") {
      result = await coreSearchNotesByUser({
        userId,
        query,
        limit,
        startDate,
        endDate,
      });
    } else {
      result = await coreGetAllNotesByUser(userId, limit, startDate, endDate);
    }

    const notes = result.notes.map((n) => ({
      ...n,
      // Normalize _id (some queries return id, others _id)
      _id: n._id || n.id,
      content:
        n.contentType === "file" ? `/api/v1/uploads/${n.content}` : n.content,
    }));
    // JSON MODE (no HTML)
    if (!wantHtml) {
      return res.json({ success: true, notes, query });
    }

    // HTML MODE
    const user = await User.findById(userId).lean();

    // Process notes outside the template literal
    const processedNotes = await Promise.all(
      notes.map(async (n) => {
        const noteId = n._id || n.id;
        const preview =
          n.contentType === "text"
            ? n.content.length > 120
              ? n.content.substring(0, 120) + "…"
              : n.content
            : n.content.split("/").pop();

        const nodeName = await getNodeName(n.nodeId);

        return `
    <li
      class="note-card"
      data-note-id="${noteId}"
      data-node-id="${n.nodeId}"
      data-version="${n.version}"
    >
      <div class="card-actions">
        ${
          n.contentType === "text"
            ? `<a href="/api/v1/node/${n.nodeId}/${n.version}/notes/${noteId}/editor${tokenQS}" class="edit-button" title="Edit note">✎</a>`
            : ""
        }
        <button class="delete-button" title="Delete note">✕</button>
      </div>

      <div class="note-content">
        <div class="note-author">${user.username}</div>
        <a
          href="/api/v1/node/${n.nodeId}/${n.version}/notes/${noteId}${tokenQS}"
          class="note-link"
        >
          ${
            n.contentType === "file"
              ? `<span class="file-badge">FILE</span>`
              : ""
          }${preview}
        </a>
      </div>

      <div class="note-meta">
        ${new Date(n.createdAt).toLocaleString()}
        <span class="meta-separator">•</span>
        <a href="/api/v1/node/${n.nodeId}/${n.version}${tokenQS}">
          ${nodeName} v${n.version}
        </a>
        <span class="meta-separator">•</span>
        <a href="/api/v1/node/${n.nodeId}/${n.version}/notes${tokenQS}">
          View Notes
        </a>
      </div>
    </li>
  `;
      }),
    );

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${user.username} — Notes</title>
  <style>
:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

/* Animated background */
body::before,
body::after {
  content: '';
  position: fixed;
  border-radius: 50%;
  opacity: 0.08;
  animation: float 20s infinite ease-in-out;
  pointer-events: none;
}

body::before {
  width: 600px;
  height: 600px;
  background: white;
  top: -300px;
  right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px;
  height: 400px;
  background: white;
  bottom: -200px;
  left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(5deg);
  }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* Glass Back Navigation */
.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  color: white;
  text-decoration: none;
  border-radius: 980px;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  position: relative;
  overflow: hidden;
}

.back-link::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.back-link:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.back-link:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Glass Header Section */
.header {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 32px;
  margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out 0.1s both;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  color: white;
  margin-bottom: 8px;
  line-height: 1.3;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.header h1 a {
  color: white;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.header h1 a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.header-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 20px;
  font-weight: 400;
}

/* Glass Search Form */
.search-form {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.search-form input[type="text"] {
  flex: 1;
  min-width: 200px;
  padding: 12px 16px;
  font-size: 16px;
  border-radius: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  font-family: inherit;
  color: white;
  font-weight: 500;
  transition: all 0.3s;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

.search-form input[type="text"]::placeholder {
  color: rgba(255, 255, 255, 0.6);
}

.search-form input[type="text"]:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.3);
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.15),
    0 8px 30px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
}

.search-form button {
  position: relative;
  overflow: hidden;
  padding: 12px 28px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.2px;
  border-radius: 980px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  cursor: pointer;
  transition: all 0.3s;
  font-family: inherit;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.search-form button::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.search-form button:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}

.search-form button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Glass Notes List */
.notes-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.note-card {
  position: relative;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  color: white;
  overflow: hidden;
}

.note-card::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.note-card:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.note-card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Card Actions (Edit + Delete buttons) */
.card-actions {
  position: absolute;
  top: 20px;
  right: 20px;
  display: flex;
  gap: 8px;
  z-index: 10;
}

.edit-button,
.delete-button {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  cursor: pointer;
  color: white;
  padding: 0;
  line-height: 1;
  opacity: 0.8;
  transition: all 0.3s;
  text-decoration: none;
}

.edit-button:hover {
  opacity: 1;
  background: rgba(72, 187, 178, 0.4);
  border-color: rgba(72, 187, 178, 0.6);
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(72, 187, 178, 0.3);
}

.delete-button:hover {
  opacity: 1;
  background: rgba(239, 68, 68, 0.4);
  border-color: rgba(239, 68, 68, 0.6);
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}

.note-content {
  padding-right: 80px;
  margin-bottom: 12px;
}

.note-author {
  font-weight: 600;
  color: white;
  font-size: 13px;
  margin-bottom: 6px;
  opacity: 0.9;
  letter-spacing: -0.2px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.note-link {
  color: white;
  text-decoration: none;
  font-size: 15px;
  line-height: 1.6;
  display: block;
  word-wrap: break-word;
  transition: all 0.2s;
  font-weight: 400;
}

.note-link:hover {
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.file-badge {
  display: inline-block;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  margin-right: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Note Meta */
.note-meta {
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.8;
}

.note-meta a {
  color: white;
  text-decoration: none;
  font-weight: 500;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.note-meta a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.meta-separator {
  margin: 0 6px;
  color: rgba(255, 255, 255, 0.5);
}

/* Empty State */
.empty-state {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 60px 40px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
}

.empty-state-icon {
  font-size: 64px;
  margin-bottom: 16px;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
}

.empty-state-text {
  font-size: 20px;
  color: white;
  margin-bottom: 8px;
  font-weight: 600;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.empty-state-subtext {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
}

/* Responsive Design */
@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .header {
    padding: 24px 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .search-form {
    flex-direction: column;
  }

  .search-form input[type="text"] {
    width: 100%;
    min-width: 0;
    font-size: 16px;
  }

  .search-form button {
    width: 100%;
  }

  .note-card {
    padding: 20px 16px;
  }

  .card-actions {
    top: 16px;
    right: 16px;
    gap: 6px;
  }

  .edit-button,
  .delete-button {
    width: 28px;
    height: 28px;
    font-size: 14px;
  }

  .note-content {
    padding-right: 70px;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }

  .empty-state {
    padding: 40px 24px;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container {
    max-width: 700px;
  }
}

  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/v1/user/${userId}${tokenQS}" class="back-link">
        ← Back to Profile
      </a>
    </div>

    <!-- Header Section -->
    <div class="header">
      <h1>
        Notes by
        <a href="/api/v1/user/${userId}${tokenQS}">${user.username}</a>
      </h1>
      <div class="header-subtitle">
        View and manage your last 200notes across every tree
      </div>

      <!-- Search Form -->
      <form method="GET" action="/api/v1/user/${userId}/notes" class="search-form">
        <input type="hidden" name="token" value="${token}">
        <input type="hidden" name="html" value="">
        <input
          type="text"
          name="q"
          placeholder="Search notes..."
          value="${query.replace(/"/g, "&quot;")}"
        />
        <button type="submit">Search</button>
      </form>
    </div>

    <!-- Notes List -->
    ${
      notes.length > 0
        ? `
    <ul class="notes-list">
      ${processedNotes.join("")}
    </ul>
    `
        : `
    <div class="empty-state">
      <div class="empty-state-icon">📝</div>
      <div class="empty-state-text">No notes yet</div>
      <div class="empty-state-subtext">
        ${
          query.trim() !== ""
            ? "Try a different search term"
            : "Notes will appear here as you create them"
        }
      </div>
    </div>
    `
    }
  </div>

  <script>
    document.addEventListener("click", async (e) => {
      if (!e.target.classList.contains("delete-button")) return;

      const card = e.target.closest(".note-card");
      const noteId = card.dataset.noteId;
      const nodeId = card.dataset.nodeId;
      const version = card.dataset.version;

      // Debug: log what we're trying to delete

      if (!noteId || !nodeId || !version) {
        alert("Error: Missing note data. Please refresh and try again.");
        return;
      }

      if (!confirm("Delete this note? This cannot be undone.")) return;

      const token = new URLSearchParams(window.location.search).get("token") || "";
      const qs = token ? "?token=" + encodeURIComponent(token) : "";

      try {
        const url = "/api/v1/" + nodeId + "/" + version + "/notes/" + noteId + qs;

        const res = await fetch(url, { method: "DELETE" });

        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Delete failed");

        // Fade out animation
        card.style.transition = "all 0.3s ease";
        card.style.opacity = "0";
        card.style.transform = "translateX(-20px)";
        setTimeout(() => card.remove(), 300);
      } catch (err) {
        alert("Failed to delete: " + (err.message || "Unknown error"));
      }
    });
  </script>
</body>
</html>
`);
  } catch (err) {
    console.error("Error in /user/:userId/notes:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/* ------------------------------------------------------------------
   GET /user/:userId/tags
   Returns all notes where this user was tagged
------------------------------------------------------------------- */
router.get("/user/:userId/tags", urlAuth, async (req, res) => {
  try {
    const userId = req.params.userId;
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;
    const rawLimit = req.query.limit;
    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit: must be a positive number",
      });
    }

    const result = await coreGetAllTagsForUser(
      userId,
      limit,
      startDate,
      endDate,
    );

    const notes = result.notes.map((n) => ({
      ...n,
      content:
        n.contentType === "file" ? `/api/v1/uploads/${n.content}` : n.content,
    }));

    if (!wantHtml) {
      return res.json({
        success: true,
        taggedBy: result.taggedBy,
        notes,
      });
    }

    const user = await User.findById(userId).lean();

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${user.username} — Mail</title>
  <style>
:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

/* Animated background */
body::before,
body::after {
  content: '';
  position: fixed;
  border-radius: 50%;
  opacity: 0.08;
  animation: float 20s infinite ease-in-out;
  pointer-events: none;
}

body::before {
  width: 600px;
  height: 600px;
  background: white;
  top: -300px;
  right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px;
  height: 400px;
  background: white;
  bottom: -200px;
  left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(5deg);
  }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* Glass Back Navigation */
.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  color: white;
  text-decoration: none;
  border-radius: 980px;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  position: relative;
  overflow: hidden;
}

.back-link::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.back-link:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.back-link:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Glass Header Section */
.header {
  position: relative;
  overflow: hidden;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 32px;
  margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out 0.1s both;
}

.header::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.header:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  color: white;
  margin-bottom: 8px;
  line-height: 1.3;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.header h1 a {
  color: white;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.header h1 a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.message-count {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border-radius: 980px;
  font-size: 14px;
  font-weight: 600;
  margin-left: 12px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.header-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 0;
  font-weight: 400;
  line-height: 1.5;
}

/* Glass Notes List */
.notes-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.note-card {
  position: relative;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  color: white;
  overflow: hidden;
  
  /* Start hidden for lazy loading */
  opacity: 0;
  transform: translateY(30px);
}

/* When item becomes visible */
.note-card.visible {
  animation: fadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.note-card::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.note-card:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.note-card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.note-content {
  margin-bottom: 12px;
}

.note-author {
  font-weight: 600;
  color: white;
  font-size: 15px;
  margin-bottom: 8px;
  display: block;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.note-author a {
  color: white;
  text-decoration: none;
  transition: all 0.2s;
}

.note-author a:hover {
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.note-link {
  color: white;
  text-decoration: none;
  font-size: 15px;
  line-height: 1.6;
  display: block;
  word-wrap: break-word;
  transition: all 0.2s;
  font-weight: 400;
}

.note-link:hover {
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.file-badge {
  display: inline-block;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  margin-right: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Note Meta */
.note-meta {
  padding-top: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.8;
}

.note-meta a {
  color: white;
  text-decoration: none;
  font-weight: 500;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.note-meta a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.meta-separator {
  margin: 0 6px;
  color: rgba(255, 255, 255, 0.5);
}

/* Empty State */
.empty-state {
  position: relative;
  overflow: hidden;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 60px 40px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
}

.empty-state::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.empty-state:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.empty-state-icon {
  font-size: 64px;
  margin-bottom: 16px;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
}

.empty-state-text {
  font-size: 20px;
  color: white;
  margin-bottom: 8px;
  font-weight: 600;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.empty-state-subtext {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
}

/* Responsive Design */
@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .header {
    padding: 24px 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .message-count {
    display: block;
    margin-left: 0;
    margin-top: 8px;
    width: fit-content;
  }

  .note-card {
    padding: 20px 16px;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }

  .empty-state {
    padding: 40px 24px;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container {
    max-width: 700px;
  }
}

  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/v1/user/${userId}${tokenQS}" class="back-link">
        ← Back to Profile
      </a>
    </div>

    <!-- Header Section -->
    <div class="header">
      <h1>
        Mail for
        <a href="/api/v1/user/${userId}${tokenQS}">@${user.username}</a>
        ${
          notes.length > 0
            ? `<span class="message-count">${notes.length}</span>`
            : ""
        }
      </h1>
      <div class="header-subtitle">Notes where others have mentioned you</div>
    </div>

    <!-- Notes List -->
    ${
      notes.length > 0
        ? `
    <ul class="notes-list">
      ${await Promise.all(
        notes.map(async (n) => {
          const nodeName = await getNodeName(n.nodeId);
          const preview =
            n.contentType === "text"
              ? n.content.length > 120
                ? n.content.substring(0, 120) + "…"
                : n.content
              : n.content.split("/").pop();

          const author = n.userId.username || n.userId._id;

          return `
          <li class="note-card">
            <div class="note-content">
              <div class="note-author">
                <a href="/api/v1/user/${n.userId._id}${tokenQS}">
                  ${author}
                </a>
              </div>
              <a href="/api/v1/node/${n.nodeId}/${n.version}/notes/${
                n._id
              }${tokenQS}" class="note-link">
                ${
                  n.contentType === "file"
                    ? `<span class="file-badge">FILE</span>`
                    : ""
                }${preview}
              </a>
            </div>

            <div class="note-meta">
              ${new Date(n.createdAt).toLocaleString()}
              <span class="meta-separator">•</span>
              <a href="/api/v1/node/${n.nodeId}/${n.version}${tokenQS}">
                ${nodeName} v${n.version}
              </a>
              <span class="meta-separator">•</span>
              <a href="/api/v1/node/${n.nodeId}/${n.version}/notes${tokenQS}">
                View Notes
              </a>
            </div>
          </li>
        `;
        }),
      ).then((results) => results.join(""))}
    </ul>
    `
        : `
    <div class="empty-state">
      <div class="empty-state-icon">📬</div>
      <div class="empty-state-text">No messages yet</div>
      <div class="empty-state-subtext">
        Notes where you're mentioned will appear here
      </div>
    </div>
    `
    }
  </div>

  <script>
    // Intersection Observer for lazy loading animations
    const observerOptions = {
      root: null,
      rootMargin: '50px',
      threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, index * 50);
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // Observe all note cards
    document.querySelectorAll('.note-card').forEach(card => {
      observer.observe(card);
    });
  </script>
</body>
</html>
`);
  } catch (err) {
    console.error("Error in /user/:userId/tags:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

const renderDetails = (c, queryString) => {
  switch (c.action) {
    case "editValue":
      return `
        <div style="margin-left:12px;">
          <strong>Values updated</strong>
          ${renderKeyValueMap(c.valueEdited)}
        </div>
      `;

    case "editGoal":
      return `
        <div style="margin-left:12px;">
          <strong>Goal updated</strong>
          ${renderKeyValueMap(c.goalEdited)}
        </div>
      `;

    case "editSchedule":
      return `
        <div style="margin-left:12px;">
          ${
            c.scheduleEdited?.date
              ? `<div>Date: <code>${new Date(
                  c.scheduleEdited.date,
                ).toLocaleString()}</code></div>`
              : ""
          }
          ${
            c.scheduleEdited?.reeffectTime !== undefined
              ? `<div>Re-effect time: <code>${c.scheduleEdited.reeffectTime}</code></div>`
              : ""
          }
        </div>
      `;

    case "executeScript":
      return `
        <div style="margin-left:12px;">
          <div>Status: <code>${
            c.executeScript?.success ? "success" : "failed"
          }</code></div>
          ${
            c.executeScript?.logs?.length
              ? `<pre><code>${escapeHtml(
                  c.executeScript.logs.join("\n"),
                )}</code></pre>`
              : ""
          }
          ${
            c.executeScript?.error
              ? `<div>Error: <code>${escapeHtml(
                  c.executeScript.error,
                )}</code></div>`
              : ""
          }
        </div>
      `;

    case "branchLifecycle":
      return `
        <div style="margin-left:12px;">
          ${
            c.branchLifecycle?.fromParentId
              ? `From: ${renderLink(
                  c.branchLifecycle.fromParentId,
                  queryString,
                )}<br/>`
              : ""
          }
          ${
            c.branchLifecycle?.toParentId
              ? `To: ${renderLink(c.branchLifecycle.toParentId, queryString)}`
              : ""
          }
        </div>
      `;

    default:
      return "";
  }
};
const renderKeyValueMap = (data) => {
  if (!data) return "";

  const entries =
    data instanceof Map
      ? [...data.entries()]
      : typeof data === "object"
        ? Object.entries(data)
        : [];

  if (entries.length === 0) return "";

  return `
    <ul>
      ${entries
        .map(
          ([key, value]) =>
            `<li><code>${escapeHtml(key)}</code>: <code>${escapeHtml(
              value,
            )}</code></li>`,
        )
        .join("")}
    </ul>
  `;
};
const escapeHtml = (str = "") =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/* ------------------------- GENERIC HELPERS ------------------------- */

const renderUser = (user) => {
  if (!user) return `<code>unknown user</code>`;

  // populated user object
  if (typeof user === "object") {
    if (user.username) {
      return `<code>${escapeHtml(user.username)}</code>`;
    }
    if (user._id) {
      return `<code>${escapeHtml(user._id)}</code>`;
    }
  }

  // string id
  if (typeof user === "string") {
    return `<code>${escapeHtml(user)}</code>`;
  }

  return `<code>unknown user</code>`;
};

const renderLink = (id, queryString) =>
  id
    ? `<a href="/api/v1/node/${id}${queryString}"><code>${id}</code></a>`
    : `<code>unknown</code>`;

const renderVersionLink = (
  nodeId,
  version,
  queryString,
  label = `Version ${version}`,
) =>
  `<a href="/api/v1/node/${nodeId}/${version}${queryString}">
    <code>${label}</code>
  </a>`;

export const contributionRenderers = ({
  nodeId,
  version,
  nextVersion,
  queryString,
}) => ({
  create: () => `created node`,
  editStatus: (c) => `changed status to <code>${c.statusEdited}</code>`,
  editValue: () => `updated values`,
  prestige: () =>
    nodeId
      ? `added new version ${renderVersionLink(
          nodeId,
          nextVersion,
          queryString,
        )}`
      : `added new version`,
  transaction: () =>
    nodeId
      ? `completed <a href="/api/v1/node/${nodeId}/${version}/transactions${queryString}">
          <code>transaction</code>
        </a>`
      : `completed <code>transaction</code>`,
  delete: () => `deleted node`,
  editSchedule: () => `updated schedule`,
  editGoal: () => `updated goal`,
  editNameNode: (c) =>
    `renamed node from <code>${c.editNameNode?.oldName}</code> to <code>${c.editNameNode?.newName}</code>`,
  updateParent: (c) =>
    `changed parent from ${renderLink(
      c.updateParent?.oldParentId,
      queryString,
    )} to ${renderLink(c.updateParent?.newParentId, queryString)}`,
  updateChildNode: (c) =>
    `${c.updateChildNode?.action} child ${renderLink(
      c.updateChildNode?.childId,
      queryString,
    )}`,
  note: (c) =>
    `${c.noteAction?.action === "add" ? "added" : "removed"} note
   <a href="/api/v1/node/${c.nodeId}/${c.nodeVersion}/notes/${
     c.noteAction?.noteId
   }${queryString}">
     <code>${c.noteAction?.noteId}</code>
   </a>`,
  editScript: (c) => `updated script <code>${c.editScript?.scriptName}</code>`,
  executeScript: (c) =>
    `executed script <code>${c.executeScript?.scriptName}</code>`,
  rawIdea: (c) => {
    const { action, rawIdeaId, targetNodeId } = c.rawIdeaAction || {};

    if (action === "add") {
      return `added raw idea
      <a href="/api/v1/user/${c.userId?._id}/raw-ideas/${rawIdeaId}${queryString}">
        <code>${rawIdeaId}</code>
      </a>`;
    }

    if (action === "delete") {
      return `deleted raw idea
      <code>${rawIdeaId}</code>`;
    }

    if (action === "place" && targetNodeId) {
      return `placed raw idea
      <code>${rawIdeaId}</code>
      into ${renderLink(targetNodeId, queryString)}`;
    }

    return "updated raw idea";
  },

  branchLifecycle: (c) =>
    c.branchLifecycle?.action === "retired"
      ? "retired branch"
      : c.branchLifecycle?.action === "revived"
        ? "revived branch"
        : "revived branch as root",
  invite: (c) => {
    const { action, receivingId } = c.inviteAction || {};
    const target = renderUser(receivingId);
    if (action === "invite") return `invited contributor ${target}`;
    if (action === "acceptInvite") return `accepted invitation from ${target}`;
    if (action === "denyInvite") return `declined invitation from ${target}`;
    if (action === "removeContributor") return `removed contributor ${target}`;
    if (action === "switchOwner") return `transferred ownership to ${target}`;
    return "updated collaboration";
  },
});

router.get("/user/:userId/contributions", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    const limit =
      req.query.limit !== undefined ? Number(req.query.limit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({ error: "Invalid limit" });
    }

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    const { contributions = [] } = await getContributionsByUser(
      userId,
      500, // hard limit to prevent abuse
      req.query.startDate,
      req.query.endDate,
    );

    if (!wantHtml) {
      return res.json({ userId, contributions });
    }

    const user = await User.findById(userId).lean();
    const username = user?.username || "Unknown user";

    /* ─────────────────────────────────────────────── */
    /* HELPERS                                          */
    /* ─────────────────────────────────────────────── */

    const esc = (str = "") =>
      String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const link = (id, label) =>
      id
        ? `<a href="/api/v1/node/${id}${tokenQS}">${label || `<code>${esc(id)}</code>`}</a>`
        : `<code>unknown</code>`;

    const nodeLink = (id, name, version) => {
      if (!id) return `<code>unknown node</code>`;
      const v = version != null ? `/${version}` : "";
      const display = name || id;
      return `<a href="/api/v1/node/${id}${v}${tokenQS}"><code>${esc(display)}</code></a>`;
    };

    const userTag = (u) => {
      if (!u) return `<code>unknown user</code>`;
      if (typeof u === "object" && u.username)
        return `<a href="/api/v1/user/${u._id}${tokenQS}"><code>${esc(u.username)}</code></a>`;
      if (typeof u === "string")
        return `<a href="/api/v1/user/${u}${tokenQS}"><code>${esc(u)}</code></a>`;
      return `<code>unknown user</code>`;
    };

    const kvMap = (data) => {
      if (!data) return "";
      const entries =
        data instanceof Map
          ? [...data.entries()]
          : typeof data === "object"
            ? Object.entries(data)
            : [];
      if (entries.length === 0) return "";
      return entries
        .map(
          ([k, v]) =>
            `<span class="kv-chip"><code>${esc(k)}</code> ${esc(String(v))}</span>`,
        )
        .join(" ");
    };

    /* ─────────────────────────────────────────────── */
    /* COLOR CATEGORY                                   */
    /* ─────────────────────────────────────────────── */

    const actionColor = (action) => {
      switch (action) {
        case "create":
          return "glass-green";
        case "delete":
        case "branchLifecycle":
          return "glass-red";
        case "editStatus":
        case "editValue":
        case "editGoal":
        case "editSchedule":
        case "editNameNode":
        case "editScript":
          return "glass-blue";
        case "executeScript":
          return "glass-cyan";
        case "prestige":
          return "glass-gold";
        case "note":
        case "rawIdea":
          return "glass-purple";
        case "invite":
          return "glass-pink";
        case "transaction":
        case "trade":
          return "glass-orange";
        case "purchase":
          return "glass-emerald";
        case "updateParent":
        case "updateChildNode":
          return "glass-teal";
        case "understanding":
          return "glass-indigo";
        default:
          return "glass-default";
      }
    };

    /* ─────────────────────────────────────────────── */
    /* ACTION RENDERER                                  */
    /* ─────────────────────────────────────────────── */

    const renderAction = (c, nodeName) => {
      const nId = c.nodeId?._id || c.nodeId;
      const v = Number(c.nodeVersion ?? 0);
      const nLink = nodeLink(nId, nodeName, v);

      switch (c.action) {
        case "create":
          return `Created ${nLink}`;

        case "editStatus":
          return `Marked ${nLink} as <code>${esc(c.statusEdited)}</code>`;

        case "editValue":
          return `Adjusted values on ${nLink} ${kvMap(c.valueEdited)}`;

        case "prestige":
          return `Prestiged ${nLink} to a new version`;

        case "trade":
          return `Traded on ${nLink}`;

        case "delete":
          return `Deleted ${nLink}`;

        case "invite": {
          const ia = c.inviteAction || {};
          const target = userTag(ia.receivingId);
          const labels = {
            invite: `Invited ${target} to collaborate on`,
            acceptInvite: `Accepted an invitation from ${target} on`,
            denyInvite: `Declined an invitation from ${target} on`,
            removeContributor: `Removed ${target} from`,
            switchOwner: `Transferred ownership of`,
          };
          const suffix = ia.action === "switchOwner" ? ` to ${target}` : "";
          return `${labels[ia.action] || "Updated collaboration on"} ${nLink}${suffix}`;
        }

        case "editSchedule": {
          const s = c.scheduleEdited || {};
          const parts = [];
          if (s.date)
            parts.push(
              `date to <code>${new Date(s.date).toLocaleString()}</code>`,
            );
          if (s.reeffectTime != null)
            parts.push(`re-effect to <code>${s.reeffectTime}</code>`);
          return parts.length
            ? `Set ${parts.join(" and ")} on ${nLink}`
            : `Updated the schedule on ${nLink}`;
        }

        case "editGoal":
          return `Set new goals on ${nLink} ${kvMap(c.goalEdited)}`;

        case "transaction": {
          const tm = c.transactionMeta;
          if (!tm) return `Recorded a transaction on ${nLink}`;
          const eventLabel = esc(tm.event || "unknown").replace(/_/g, " ");
          const counterparty = tm.counterpartyNodeId
            ? ` with ${link(tm.counterpartyNodeId)}`
            : "";
          const sent = kvMap(tm.valuesSent);
          const recv = kvMap(tm.valuesReceived);
          let flow = "";
          if (sent) flow += ` — sent ${sent}`;
          if (recv) flow += `${sent ? "," : " —"} received ${recv}`;
          return `Transaction <code>${eventLabel}</code> as ${esc(tm.role)} (side ${esc(tm.side)}) on ${nLink}${counterparty}${flow}`;
        }

        case "note": {
          const na = c.noteAction || {};
          const verb =
            na.action === "add" ? "Added a note to" : "Removed a note from";
          const noteRef = na.noteId
            ? ` <a href="/api/v1/node/${nId}/${v}/notes/${na.noteId}${tokenQS}"><code>${esc(na.noteId)}</code></a>`
            : "";
          return `${verb} ${nLink}${noteRef}`;
        }

        case "updateParent": {
          const up = c.updateParent || {};
          const from = up.oldParentId
            ? link(up.oldParentId)
            : `<code>none</code>`;
          const to = up.newParentId
            ? link(up.newParentId)
            : `<code>none</code>`;
          return `Moved ${nLink} from ${from} to ${to}`;
        }

        case "editScript": {
          const es = c.editScript || {};
          return `Edited script <code>${esc(es.scriptName || es.scriptId)}</code> on ${nLink}`;
        }

        case "executeScript": {
          const xs = c.executeScript || {};
          const icon = xs.success ? "✅" : "❌";
          let text = `${icon} Ran <code>${esc(xs.scriptName || xs.scriptId)}</code> on ${nLink}`;
          if (xs.error) text += ` — <code>${esc(xs.error)}</code>`;
          return text;
        }

        case "updateChildNode": {
          const uc = c.updateChildNode || {};
          return uc.action === "added"
            ? `Added ${link(uc.childId)} as a child of ${nLink}`
            : `Removed child ${link(uc.childId)} from ${nLink}`;
        }

        case "editNameNode": {
          const en = c.editNameNode || {};
          return `Renamed ${nLink} from <code>${esc(en.oldName)}</code> to <code>${esc(en.newName)}</code>`;
        }

        case "rawIdea": {
          const ri = c.rawIdeaAction || {};
          const ideaRef = `<a href="/api/v1/user/${userId}/raw-ideas/${ri.rawIdeaId}${tokenQS}"><code>${esc(ri.rawIdeaId)}</code></a>`;
          if (ri.action === "add") return `Captured a raw idea ${ideaRef}`;
          if (ri.action === "delete")
            return `Discarded raw idea <code>${esc(ri.rawIdeaId)}</code>`;
          if (ri.action === "placed") {
            const target = ri.targetNodeId ? link(ri.targetNodeId) : nLink;
            return `Placed raw idea ${ideaRef} into ${target}`;
          }
          return `Updated raw idea ${ideaRef}`;
        }

        case "branchLifecycle": {
          const bl = c.branchLifecycle || {};
          if (bl.action === "retired") {
            let text = `Retired branch ${nLink}`;
            if (bl.fromParentId) text += ` from ${link(bl.fromParentId)}`;
            return text;
          }
          if (bl.action === "revived") {
            let text = `Revived branch ${nLink}`;
            if (bl.toParentId) text += ` under ${link(bl.toParentId)}`;
            return text;
          }
          return `Revived ${nLink} as a new root`;
        }

        case "purchase": {
          const pm = c.purchaseMeta || {};
          const parts = [];
          if (pm.plan) parts.push(`the <code>${esc(pm.plan)}</code> plan`);
          if (pm.energyAmount)
            parts.push(`<code>${pm.energyAmount}</code> energy`);
          const price = pm.totalCents
            ? ` for $${(pm.totalCents / 100).toFixed(2)} ${esc(pm.currency || "usd").toUpperCase()}`
            : "";
          return parts.length
            ? `Purchased ${parts.join(" and ")}${price}`
            : `Made a purchase${price}`;
        }

        case "understanding": {
          const um = c.understandingMeta || {};
          const rootNode = um.rootNodeId || nId;
          const runId = um.understandingRunId;

          if (um.stage === "createRun") {
            const runLink =
              runId && rootNode
                ? `<a href="/api/v1/root/${rootNode}/understandings/run/${runId}${tokenQS}"><code>${esc(runId)}</code></a>`
                : `<code>unknown run</code>`;
            let text = `Started understanding run ${runLink}`;
            if (rootNode) text += ` on ${link(rootNode)}`;
            if (um.nodeCount != null)
              text += ` spanning <code>${um.nodeCount}</code> nodes`;
            if (um.perspective) text += ` — "${esc(um.perspective)}"`;
            return text;
          }

          if (um.stage === "processStep") {
            const uNodeId = um.understandingNodeId;
            const uNodeLink =
              uNodeId && runId && rootNode
                ? `<a href="/api/v1/root/${rootNode}/understandings/run/${runId}/${uNodeId}${tokenQS}"><code>${esc(uNodeId)}</code></a>`
                : uNodeId
                  ? `<code>${esc(uNodeId)}</code>`
                  : `<code>unknown</code>`;
            let text = `Understanding encoded ${uNodeLink}`;
            if (um.mode)
              text += ` <span class="kv-chip">${esc(um.mode)}</span>`;
            if (um.layer != null) text += ` at layer <code>${um.layer}</code>`;
            return text;
          }

          return `Understanding activity on ${nLink}`;
        }

        default:
          return `<code>${esc(c.action)}</code> on ${nLink}`;
      }
    };

    /* ─────────────────────────────────────────────── */
    /* RENDER CARDS                                     */
    /* ─────────────────────────────────────────────── */

    const items = await Promise.all(
      contributions.map(async (c) => {
        const nId = c.nodeId?._id || c.nodeId;
        const nodeName = nId ? await getNodeName(nId) : null;
        const time = new Date(c.date).toLocaleString();
        const actionHtml = renderAction(c, nodeName);
        const colorClass = actionColor(c.action);

        const aiBadge = c.wasAi ? `<span class="badge badge-ai">AI</span>` : "";
        const energyBadge =
          c.energyUsed != null && c.energyUsed > 0
            ? `<span class="badge badge-energy">⚡ ${c.energyUsed}</span>`
            : "";

        return `
      <li class="note-card ${colorClass}">
        <div class="note-content">
          <div class="contribution-action">${actionHtml}</div>
        </div>
        <div class="note-meta">
          ${time}
          ${aiBadge}${energyBadge}
          <span class="meta-separator">·</span>
          <code class="contribution-id">${esc(c._id)}</code>
        </div>
      </li>`;
      }),
    );

    /* ─────────────────────────────────────────────── */
    /* HTML SHELL                                       */
    /* ─────────────────────────────────────────────── */

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${esc(username)} — Contributions</title>
  <style>
:root {
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

body::before,
body::after {
  content: '';
  position: fixed;
  border-radius: 50%;
  opacity: 0.08;
  animation: float 20s infinite ease-in-out;
  pointer-events: none;
}

body::before {
  width: 600px; height: 600px;
  background: white;
  top: -300px; right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px; height: 400px;
  background: white;
  bottom: -200px; left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-30px) rotate(5deg); }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* ── Glass Back Nav ─────────────────────────────── */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: rgba(115, 111, 230, var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  color: white;
  text-decoration: none;
  border-radius: 980px;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 8px 24px rgba(0,0,0,0.12),
    inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28);
  position: relative;
  overflow: hidden;
}

.back-link::before {
  content: "";
  position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1);
  pointer-events: none;
}

.back-link:hover {
  background: rgba(115, 111, 230, var(--glass-alpha-hover));
  transform: translateY(-1px);
}

.back-link:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

/* ── Glass Header ───────────────────────────────── */

.header {
  position: relative; overflow: hidden;
  background: rgba(115, 111, 230, var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 32px;
  margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12),
    inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out 0.1s both;
}

.header::before {
  content: "";
  position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1);
  pointer-events: none;
}

.header:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

.header h1 {
  font-size: 28px; font-weight: 600; color: white;
  margin-bottom: 8px; line-height: 1.3; letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0,0,0,0.2);
}

.header h1 a {
  color: white; text-decoration: none;
  border-bottom: 1px solid rgba(255,255,255,0.3);
  transition: all 0.2s;
}

.header h1 a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255,255,255,0.8);
}

.message-count {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(255,255,255,0.25);
  color: white; border-radius: 980px;
  font-size: 14px; font-weight: 600;
  margin-left: 12px;
  border: 1px solid rgba(255,255,255,0.3);
}

.header-subtitle {
  font-size: 14px; color: rgba(255,255,255,0.9);
  margin-bottom: 16px; font-weight: 400; line-height: 1.5;
}

.nav-links {
  display: flex; flex-wrap: wrap; gap: 8px;
}

.nav-links a {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(255,255,255,0.18);
  color: white; border-radius: 980px;
  font-size: 13px; font-weight: 600;
  text-decoration: none;
  border: 1px solid rgba(255,255,255,0.25);
  transition: all 0.2s;
}

.nav-links a:hover {
  background: rgba(255,255,255,0.32);
  transform: translateY(-1px);
}

/* ── Glass Cards — base ─────────────────────────── */

.notes-list {
  list-style: none;
  display: flex; flex-direction: column; gap: 16px;
}

.note-card {
  --card-rgb: 115, 111, 230;
  position: relative;
  background: rgba(var(--card-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12),
    inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28);
  transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
  color: white; overflow: hidden;
  opacity: 0; transform: translateY(30px);
}

.note-card.visible {
  animation: fadeInUp 0.6s cubic-bezier(0.4,0,0.2,1) forwards;
}

.note-card::before {
  content: "";
  position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1);
  pointer-events: none;
}

.note-card:hover {
  background: rgba(var(--card-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0,0,0,0.18);
}

.note-card:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

/* ── Color Variants ─────────────────────────────── */

.glass-default  { --card-rgb: 115, 111, 230; }
.glass-green    { --card-rgb: 72, 187, 120;  }
.glass-red      { --card-rgb: 200, 80, 80;   }
.glass-blue     { --card-rgb: 80, 130, 220;  }
.glass-cyan     { --card-rgb: 56, 189, 210;  }
.glass-gold     { --card-rgb: 200, 170, 50;  }
.glass-purple   { --card-rgb: 155, 100, 220; }
.glass-pink     { --card-rgb: 210, 100, 160; }
.glass-orange   { --card-rgb: 220, 140, 60;  }
.glass-emerald  { --card-rgb: 52, 190, 130;  }
.glass-teal     { --card-rgb: 60, 170, 180;  }
.glass-indigo   { --card-rgb: 100, 100, 210; }

/* ── Card Inner ─────────────────────────────────── */

.note-content {
  margin-bottom: 12px;
}

.contribution-action {
  font-size: 15px; line-height: 1.6;
  color: white; font-weight: 400;
  word-wrap: break-word;
}

.contribution-action a {
  color: white; text-decoration: none;
  border-bottom: 1px solid rgba(255,255,255,0.3);
  transition: all 0.2s;
}

.contribution-action a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255,255,255,0.8);
}

.contribution-action code {
  background: rgba(255,255,255,0.18);
  padding: 2px 7px; border-radius: 5px;
  font-size: 13px;
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  border: 1px solid rgba(255,255,255,0.15);
}

/* ── Note Meta ──────────────────────────────────── */

.note-meta {
  padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,0.2);
  font-size: 12px; color: rgba(255,255,255,0.85);
  line-height: 1.8;
  display: flex; flex-wrap: wrap;
  align-items: center; gap: 6px;
}

.note-meta a {
  color: white; text-decoration: none; font-weight: 500;
  border-bottom: 1px solid rgba(255,255,255,0.3);
  transition: all 0.2s;
}

.note-meta a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255,255,255,0.8);
}

.meta-separator { color: rgba(255,255,255,0.5); }

.contribution-id {
  background: rgba(255,255,255,0.12);
  padding: 2px 6px; border-radius: 4px;
  font-size: 11px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.6);
  border: 1px solid rgba(255,255,255,0.1);
}

/* ── Badges ─────────────────────────────────────── */

.badge {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 980px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.3px;
  border: 1px solid rgba(255,255,255,0.2);
}

.badge-ai {
  background: rgba(255,200,50,0.35);
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.2);
}

.badge-energy {
  background: rgba(100,220,255,0.3);
  color: #fff;
  text-shadow: 0 1px 2px rgba(0,0,0,0.2);
}

/* ── KV Chips ───────────────────────────────────── */

.kv-chip {
  display: inline-block;
  padding: 2px 8px;
  background: rgba(255,255,255,0.15);
  border-radius: 6px; font-size: 12px;
  margin: 2px 2px;
  border: 1px solid rgba(255,255,255,0.15);
}

.kv-chip code {
  background: none !important;
  border: none !important;
  padding: 0 !important;
  font-weight: 600;
}

/* ── Empty State ────────────────────────────────── */

.empty-state {
  position: relative; overflow: hidden;
  background: rgba(115, 111, 230, var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 60px 40px; text-align: center;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12),
    inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28);
  color: white;
}

.empty-state::before {
  content: "";
  position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1);
  pointer-events: none;
}

.empty-state:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

.empty-state-icon {
  font-size: 64px; margin-bottom: 16px;
  filter: drop-shadow(0 4px 12px rgba(0,0,0,0.2));
}

.empty-state-text {
  font-size: 20px; color: white;
  margin-bottom: 8px; font-weight: 600;
  text-shadow: 0 2px 8px rgba(0,0,0,0.2);
}

.empty-state-subtext {
  font-size: 14px; color: rgba(255,255,255,0.85);
}

/* ── Responsive ─────────────────────────────────── */

@media (max-width: 640px) {
  body { padding: 16px; }
  .header { padding: 24px 20px; }
  .header h1 { font-size: 24px; }
  .message-count { display: block; margin-left: 0; margin-top: 8px; width: fit-content; }
  .note-card { padding: 20px 16px; }
  .back-nav { flex-direction: column; }
  .back-link { width: 100%; justify-content: center; }
  .empty-state { padding: 40px 24px; }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container { max-width: 700px; }
}
  </style>
</head>
<body>
  <div class="container">
    <div class="back-nav">
      <a href="/api/v1/user/${userId}${tokenQS}" class="back-link">← Back to Profile</a>
    </div>

    <div class="header">
      <h1>
        Contributions by
        <a href="/api/v1/user/${userId}${tokenQS}">@${esc(username)}</a>
        ${contributions.length > 0 ? `<span class="message-count">${contributions.length}</span>` : ""}
      </h1>
      <div class="header-subtitle">Activity &amp; change history</div>

    </div>

    ${
      items.length
        ? `<ul class="notes-list">${items.join("")}</ul>`
        : `
    <div class="empty-state">
      <div class="empty-state-icon">📊</div>
      <div class="empty-state-text">No contributions yet</div>
      <div class="empty-state-subtext">Contributions and activity will appear here</div>
    </div>`
    }
  </div>

  <script>
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          setTimeout(() => entry.target.classList.add('visible'), index * 50);
          observer.unobserve(entry.target);
        }
      });
    }, { root: null, rootMargin: '50px', threshold: 0.1 });
    document.querySelectorAll('.note-card').forEach(card => observer.observe(card));
  </script>
</body>
</html>
`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/user/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.send(`
        <html>
        <body style="font-family: sans-serif; padding: 20px;">
          <h2>Reset Link Expired or Invalid</h2>
          <p>Please request a new password reset.</p>
        </body>
        </html>
      `);
    }

    // Render reset password form
    return res.send(`
      <html>
      <body style="font-family: sans-serif; padding: 20px;">
        <h2>Reset Password</h2>
        <form method="POST" action="/api/v1/user/reset-password/${token}">
          <input type="password" name="password" placeholder="New Password" style="padding:8px; width:250px;" required />
          <br/><br/>
          <input type="password" name="confirm" placeholder="Confirm Password" style="padding:8px; width:250px;" required />
          <br/><br/>
          <button type="submit" style="padding:10px 20px;">Reset Password</button>
        </form>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("Error loading reset password page:", err);
    res.status(500).send("Server error");
  }
});

/* -----------------------------------------------------------
   HANDLE RESET PASSWORD FORM POST
----------------------------------------------------------- */
router.post("/user/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirm } = req.body;

    if (password !== confirm) {
      return res.send(`
        <html><body style="font-family:sans-serif; padding:20px;">
        <h2>Passwords Do Not Match</h2>
        <p><a href="/api/v1/user/reset-password/${token}">Try Again</a></p>
        </body></html>
      `);
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.send(`
        <html><body style="font-family:sans-serif; padding:20px;">
        <h2>Reset Link Expired or Invalid</h2>
        <p>Please request a new password reset.</p>
        </body></html>
      `);
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;

    await user.save();

    return res.send(`
      <html><body style="font-family:sans-serif; padding:20px;">
      <h2>Password Reset Successfully</h2>
      <p>You can now log in with your new password.</p>
      </body></html>
    `);
  } catch (err) {
    console.error("Error resetting password:", err);
    res.status(500).send("Server error");
  }
});

router.post("/user/:userId/createRoot", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { name } = req.body;

    if (req.userId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, error: "Not authorized" });
    }

    if (!name || typeof name !== "string") {
      return res.status(400).json({
        success: false,
        error: "Name is required",
      });
    }

    const rootNode = await createNewNode(
      name,
      null,
      0,
      null,
      true, // isRoot
      userId,
      {},
      {},
      null,
      req.user,
    );

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/root/${rootNode._id}?token=${req.query.token ?? ""}&html`,
      );
    }

    res.status(201).json({
      success: true,
      rootId: rootNode._id,
      root: rootNode,
    });
  } catch (err) {
    console.error("createRoot error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post(
  "/user/:userId/raw-ideas",
  authenticate,
  upload.single("file"),

  async (req, res) => {
    try {
      const { userId } = req.params;

      if (req.userId.toString() !== userId.toString()) {
        return res
          .status(403)
          .json({ success: false, error: "Not authorized" });
      }

      const contentType = req.file ? "file" : "text";

      const result = await coreCreateRawIdea({
        contentType,
        content: contentType === "file" ? req.file.filename : req.body.content,
        userId: req.userId,
        file: req.file,
      });

      const wantHtml = "html" in req.query;

      if (wantHtml) {
        return res.redirect(
          `/api/v1/user/${userId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return res.status(201).json({
        success: true,
        rawIdea: result.rawIdea,
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  },
);

router.get("/user/:userId/raw-ideas", urlAuth, async (req, res) => {
  try {
    const userId = req.params.userId;

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const rawLimit = req.query.limit;
    let limit = rawLimit !== undefined ? Number(rawLimit) : undefined;
    if (limit >= 200 || limit == undefined) {
      limit = 200;
    }
    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit: must be a positive number",
      });
    }

    const query = req.query.q || "";

    let result;
    if (query.trim() !== "") {
      result = await coreSearchRawIdeasByUser({
        userId,
        query,
        limit,
        startDate,
        endDate,
      });
    } else {
      result = await coreGetRawIdeas({
        userId,
        limit,
        startDate,
        endDate,
      });
    }

    const rawIdeas = result.rawIdeas.map((r) => ({
      ...r,
      content:
        r.contentType === "file" ? `/api/v1/uploads/${r.content}` : r.content,
    }));

    // ---------- JSON MODE ----------
    if (!wantHtml) {
      return res.json({
        success: true,
        rawIdeas,
      });
    }

    // ---------- HTML MODE ----------
    const user = await User.findById(userId).lean();

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${user.username} — Raw Ideas</title>
  <style>
:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

/* Animated background */
body::before,
body::after {
  content: '';
  position: fixed;
  border-radius: 50%;
  opacity: 0.08;
  animation: float 20s infinite ease-in-out;
  pointer-events: none;
}

body::before {
  width: 600px;
  height: 600px;
  background: white;
  top: -300px;
  right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px;
  height: 400px;
  background: white;
  bottom: -200px;
  left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(5deg);
  }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* Glass Back Navigation */
.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  color: white;
  text-decoration: none;
  border-radius: 980px;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  position: relative;
  overflow: hidden;
}

.back-link::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.back-link:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.back-link:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Glass Header Section */
.header {
  position: relative;
  overflow: hidden;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 32px;
  margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out 0.1s both;
}

.header::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.header:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  color: white;
  margin-bottom: 8px;
  line-height: 1.3;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.header h1 a {
  color: white;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.header h1 a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.header-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 20px;
  font-weight: 400;
  line-height: 1.5;
}

/* Glass Search Form */
.search-form {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.search-form input[type="text"] {
  flex: 1;
  min-width: 200px;
  padding: 12px 16px;
  font-size: 16px;
  border-radius: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.2);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  font-family: inherit;
  color: white;
  font-weight: 500;
  transition: all 0.3s;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

.search-form input[type="text"]::placeholder {
  color: rgba(255, 255, 255, 0.65);
}

.search-form input[type="text"]:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.3);
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.15),
    0 8px 30px rgba(0, 0, 0, 0.15),
    inset 0 1px 0 rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
}

.search-form button {
  position: relative;
  overflow: hidden;
  padding: 12px 28px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.2px;
  border-radius: 980px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  cursor: pointer;
  transition: all 0.3s;
  font-family: inherit;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.search-form button::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.search-form button:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}

.search-form button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Glass Ideas List */
.ideas-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.idea-card {
  position: relative;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  color: white;
  overflow: hidden;
  
  /* Start hidden for lazy loading */
  opacity: 0;
  transform: translateY(30px);
}

/* When item becomes visible */
.idea-card.visible {
  animation: fadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.idea-card::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.idea-card:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.idea-card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.delete-button {
  position: absolute;
  top: 20px;
  right: 20px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  cursor: pointer;
  color: white;
  padding: 0;
  line-height: 1;
  opacity: 0.8;
  transition: all 0.3s;
  z-index: 10;
}

.delete-button:hover {
  opacity: 1;
  background: rgba(239, 68, 68, 0.4);
  border-color: rgba(239, 68, 68, 0.6);
  transform: scale(1.1);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}

.idea-content {
  padding-right: 48px;
  margin-bottom: 16px;
}

.idea-link {
  color: white;
  text-decoration: none;
  font-size: 16px;
  line-height: 1.6;
  display: block;
  word-wrap: break-word;
  transition: all 0.2s;
  font-weight: 400;
}

.idea-link:hover {
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.file-badge {
  display: inline-block;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  margin-right: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Subtle Transfer Form */
.transfer-form {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  flex-wrap: wrap;
  align-items: center;
}

.transfer-form input[type="text"] {
  flex: 1;
  min-width: 180px;
  padding: 10px 14px;
  font-size: 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  font-family: inherit;
  color: white;
  font-weight: 500;
  transition: all 0.3s;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.transfer-form input[type="text"]::placeholder {
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
}

.transfer-form input[type="text"]:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.transfer-form button {
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 980px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  color: white;
  cursor: pointer;
  transition: all 0.3s;
  font-family: inherit;
  white-space: nowrap;
  opacity: 0.85;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.transfer-form button:hover {
  background: rgba(255, 255, 255, 0.25);
  opacity: 1;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

/* Metadata */
.idea-meta {
  margin-top: 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Empty State */
.empty-state {
  position: relative;
  overflow: hidden;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 60px 40px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
}

.empty-state::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.empty-state:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.empty-state-icon {
  font-size: 64px;
  margin-bottom: 16px;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
}

.empty-state-text {
  font-size: 20px;
  color: white;
  margin-bottom: 8px;
  font-weight: 600;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.empty-state-subtext {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
}

/* Responsive Design */
@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .header {
    padding: 24px 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .search-form {
    flex-direction: column;
  }

  .search-form input[type="text"] {
    width: 100%;
    min-width: 0;
    font-size: 16px;
  }

  .search-form button {
    width: 100%;
  }

  .idea-card {
    padding: 20px 16px;
  }

  .delete-button {
    top: 16px;
    right: 16px;
    width: 28px;
    height: 28px;
    font-size: 16px;
  }

  .transfer-form {
    flex-direction: column;
  }

  .transfer-form input[type="text"] {
    width: 100%;
    min-width: 0;
  }

  .transfer-form button {
    width: 100%;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }

  .empty-state {
    padding: 40px 24px;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container {
    max-width: 700px;
  }
}

  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/v1/user/${userId}${tokenQS}" class="back-link">
        ← Back to Profile
      </a>
    </div>

    <!-- Header Section -->
    <div class="header">
      <h1>
        Raw Ideas for
        <a href="/api/v1/user/${userId}${tokenQS}">${user.username}</a>
      </h1>
      <div class="header-subtitle">
Convert loose thoughts into structure (viewing last 200)      </div>

      <!-- Search Form -->
      <form method="GET" action="/api/v1/user/${userId}/raw-ideas" class="search-form">
        <input type="hidden" name="token" value="${token}">
        <input type="hidden" name="html" value="">
        <input
          type="text"
          name="q"
          placeholder="Search raw ideas..."
          value="${query.replace(/"/g, "&quot;")}"
        />
        <button type="submit">Search</button>
      </form>
    </div>

    <!-- Raw Ideas List -->
    ${
      rawIdeas.length > 0
        ? `
    <ul class="ideas-list">
      ${rawIdeas
        .map(
          (r) => `
        <li class="idea-card" data-raw-idea-id="${r._id}">
          <button class="delete-button" title="Delete raw idea">✕</button>

          <div class="idea-content">
            <a
              href="/api/v1/user/${userId}/raw-ideas/${r._id}${tokenQS}"
              class="idea-link"
            >
              ${
                r.contentType === "file"
                  ? `<span class="file-badge">FILE</span>${r.content}`
                  : r.content
              }
            </a>
          </div>

          <form
            method="POST"
            action="/api/v1/user/${userId}/raw-ideas/${
              r._id
            }/transfer?token=${token}&html"
            class="transfer-form"
          >
            <input
              type="text"
              name="nodeId"
              placeholder="Target node ID"
              required
            />
            <button type="submit">Transfer to Node</button>
          </form>

          <div class="idea-meta">
            ${new Date(r.createdAt).toLocaleString()}
          </div>
        </li>
      `,
        )
        .join("")}
    </ul>
    `
        : `
    <div class="empty-state">
      <div class="empty-state-icon">💭</div>
      <div class="empty-state-text">No raw ideas yet</div>
      <div class="empty-state-subtext">
        ${
          query.trim() !== ""
            ? "Try a different search term"
            : "Start capturing your ideas from the user page"
        }
      </div>
    </div>
    `
    }
  </div>

  <script>
    // Intersection Observer for lazy loading animations
    const observerOptions = {
      root: null,
      rootMargin: '50px',
      threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          // Add a small stagger delay based on order
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, index * 50); // 50ms stagger between items
          
          // Stop observing once animated
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // Observe all idea cards
    document.querySelectorAll('.idea-card').forEach(card => {
      observer.observe(card);
    });

    // Delete button handler with event delegation
    document.addEventListener("click", async function(e) {
      // Check if clicked element is delete button
      const deleteBtn = e.target.closest(".delete-button");
      if (!deleteBtn) return;

      e.preventDefault();
      e.stopPropagation();

      const card = deleteBtn.closest(".idea-card");
      if (!card) return;

      const rawIdeaId = card.dataset.rawIdeaId;

      if (!confirm("Delete this raw idea? This cannot be undone.")) return;

      const token = new URLSearchParams(window.location.search).get("token") || "";
      const qs = token ? "?token=" + encodeURIComponent(token) : "";

      try {
        const res = await fetch(
          "/api/v1/user/${userId}/raw-ideas/" + rawIdeaId + qs,
          { method: "DELETE" }
        );

        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Delete failed");

        // Fade out animation
        card.style.transition = "all 0.3s ease";
        card.style.opacity = "0";
        card.style.transform = "translateX(-20px)";
        setTimeout(() => card.remove(), 300);
      } catch (err) {
        alert("Failed to delete: " + (err.message || "Unknown error"));
      }
    }, true); // Use capture phase to ensure we catch the event
  </script>
</body>
</html>
`);
  } catch (err) {
    console.error("Error in /user/:userId/raw-ideas:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete(
  "/user/:userId/raw-ideas/:rawIdeaId",
  authenticate,
  async (req, res) => {
    try {
      const { userId, rawIdeaId } = req.params;

      if (req.userId.toString() !== userId.toString()) {
        return res
          .status(403)
          .json({ success: false, error: "Not authorized" });
      }

      const result = await coreDeleteRawIdeaAndFile({
        rawIdeaId,
        userId: req.userId,
      });

      return res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  },
);

router.post(
  "/user/:userId/raw-ideas/:rawIdeaId/transfer",
  authenticate,

  async (req, res) => {
    try {
      const { userId, rawIdeaId } = req.params;
      const { nodeId } = req.body;

      // 🔐 ownership check (same pattern as others)
      if (req.userId.toString() !== userId.toString()) {
        return res
          .status(403)
          .json({ success: false, error: "Not authorized" });
      }

      if (!rawIdeaId || !nodeId) {
        return res.status(400).json({
          success: false,
          error: "raw-idea Id and nodeId are required",
        });
      }

      const result = await coreConvertRawIdeaToNote({
        rawIdeaId,
        userId: req.userId,
        nodeId,
      });

      // 🌐 HTML redirect support
      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/user/${userId}/raw-ideas?token=${req.query.token ?? ""}&html`,
        );
      }

      // 📦 JSON response
      return res.json({
        success: true,
        note: result.note,
      });
    } catch (err) {
      console.error("raw-idea transfer error:", err);
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }
  },
);

router.get("/user/:userId/raw-ideas/:rawIdeaId", urlAuth, async (req, res) => {
  try {
    const { userId, rawIdeaId } = req.params;

    const RawIdea = (await import("../db/models/rawIdea.js")).default;

    const rawIdea = await RawIdea.findById(rawIdeaId)
      .populate("userId", "username")
      .lean();

    if (!rawIdea) return res.status(404).send("Raw idea not found");

    // Ownership / visibility check
    if (
      rawIdea.userId !== "empty" &&
      rawIdea.userId?._id?.toString() !== userId.toString()
    ) {
      return res.status(403).send("Not authorized");
    }

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    const back = `/api/v1/user/${userId}/raw-ideas${tokenQS}`;

    const userLink =
      rawIdea.userId && rawIdea.userId !== "empty"
        ? `<a href="/api/v1/user/${rawIdea.userId._id}${tokenQS}">
               ${rawIdea.userId.username ?? rawIdea.userId}
             </a>`
        : "Unknown user";

    // ---------------- HTML MODE ----------------
    if (req.query.html !== undefined) {
      // ---------- TEXT ----------
      if (rawIdea.contentType === "text") {
        return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Raw Idea by ${rawIdea.userId?.username || "User"}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .back-link:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    /* Raw Idea Card */
    .raw-idea-card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
    }

    .raw-idea-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    }

    /* User Info */
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e9ecef;
    }

    .user-info::before {
      content: '💡';
      font-size: 18px;
    }

    .user-info a {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      transition: color 0.2s;
    }

    .user-info a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    /* Copy Button */
    .copy-bar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 16px;
    }

    #copyBtn {
      background: rgba(102, 126, 234, 0.1);
      border: 1px solid rgba(102, 126, 234, 0.2);
      cursor: pointer;
      font-size: 20px;
      padding: 8px 12px;
      border-radius: 8px;
      transition: all 0.2s;
    }

    #copyBtn:hover {
      background: rgba(102, 126, 234, 0.2);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
    }

    #copyBtn:active {
      transform: translateY(0);
    }

    /* Raw Idea Content */
    pre {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 12px;
      font-size: 16px;
      line-height: 1.7;
      white-space: pre-wrap;
      word-wrap: break-word;
      border: 1px solid #e9ecef;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      color: #1a1a1a;
    }

    /* Responsive */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .raw-idea-card {
        padding: 20px;
      }

      pre {
        font-size: 17px;
        padding: 16px;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${back}" class="back-link">← Back to Raw Ideas</a>
    </div>

    <!-- Raw Idea Card -->
    <div class="raw-idea-card">
      <div class="user-info">
        ${userLink}
      </div>

      <div class="copy-bar">
        <button id="copyBtn" title="Copy raw idea">📋</button>
      </div>

      <pre id="content">${rawIdea.content}</pre>
    </div>
  </div>

  <script>
    const btn = document.getElementById("copyBtn");
    const content = document.getElementById("content");

    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(content.textContent).then(() => {
        btn.textContent = "✔️";
        setTimeout(() => (btn.textContent = "📋"), 900);
      });
    });
  </script>
</body>
</html>
`);
      }

      // ---------- FILE ----------
      const fileUrl = `/api/v1/uploads/${rawIdea.content}`;
      const filePath = path.join(process.cwd(), "uploads", rawIdea.content);
      const mimeType = mime.lookup(filePath) || "application/octet-stream";
      const mediaHtml = renderMedia(fileUrl, mimeType);
      const fileName = rawIdea.content;

      return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${fileName}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .back-link:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    /* File Card */
    .file-card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
    }

    .file-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    }

    /* User Info */
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e9ecef;
    }

     .user-info::before {
      content: '👤';
      font-size: 18px;
    }

    .user-info a {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      transition: color 0.2s;
    }

    .user-info a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    /* File Header */
    h1 {
      font-size: 24px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 20px;
      word-break: break-word;
    }

    h1::before {
      content: '📎 ';
      font-size: 22px;
    }

    /* Download Button */
    .download {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
      margin-bottom: 24px;
    }

    .download:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }

    .download::before {
      content: '⬇️';
      font-size: 16px;
    }

    /* Media Container */
    .media {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid #e9ecef;
    }

    .media img,
    .media video,
    .media audio {
      max-width: 100%;
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    }

    /* Responsive */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .file-card {
        padding: 20px;
      }

      h1 {
        font-size: 22px;
      }

      .download {
        padding: 12px 18px;
        font-size: 16px;
        width: 100%;
        justify-content: center;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${back}" class="back-link">← Back to Raw Ideas</a>
    </div>

    <!-- File Card -->
    <div class="file-card">
      <div class="user-info">
        ${userLink}
      </div>

      <h1>${fileName}</h1>

      <a class="download" href="${fileUrl}" download>
        Download
      </a>

      <div class="media">
        ${mediaHtml}
      </div>
    </div>
  </div>
</body>
</html>
`);
    }

    // ---------------- API MODE ----------------
    if (rawIdea.contentType === "text") {
      return res.json({ text: rawIdea.content });
    }

    if (rawIdea.contentType === "file") {
      const filePath = path.join(process.cwd(), "uploads", rawIdea.content);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }
      return res.sendFile(filePath);
    }

    res.status(400).json({ error: "Unknown raw idea type" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/user/:userId/invites", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    // 🔐 user can only see their own invites
    if (req.userId.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const invites = await getPendingInvitesForUser(userId);

    const wantHtml = "html" in req.query;
    if (!wantHtml) {
      return res.json({ success: true, invites });
    }

    // ---------- HTML ----------
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Invites</title>
  <style>
:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

/* Animated background */
body::before,
body::after {
  content: '';
  position: fixed;
  border-radius: 50%;
  opacity: 0.08;
  animation: float 20s infinite ease-in-out;
  pointer-events: none;
}

body::before {
  width: 600px;
  height: 600px;
  background: white;
  top: -300px;
  right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px;
  height: 400px;
  background: white;
  bottom: -200px;
  left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(5deg);
  }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* Glass Back Navigation */
.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  color: white;
  text-decoration: none;
  border-radius: 980px;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  position: relative;
  overflow: hidden;
}

.back-link::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.back-link:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.back-link:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Glass Header Section */
.header {
  position: relative;
  overflow: hidden;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 32px;
  margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out 0.1s both;
}

.header::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.header:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  color: white;
  margin-bottom: 8px;
  line-height: 1.3;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.header-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 0;
  font-weight: 400;
  line-height: 1.5;
}

/* Glass Invites List */
.invites-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.invite-card {
  position: relative;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  color: white;
  overflow: hidden;
  
  /* Start hidden for lazy loading */
  opacity: 0;
  transform: translateY(30px);
}

/* When item becomes visible */
.invite-card.visible {
  animation: fadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.invite-card::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.invite-card:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.invite-card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.invite-text {
  font-size: 16px;
  line-height: 1.6;
  color: white;
  margin-bottom: 16px;
  font-weight: 400;
}

.invite-text strong {
  font-weight: 600;
  color: white;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.invite-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.invite-actions form {
  margin: 0;
}

.accept-button,
.decline-button {
  position: relative;
  overflow: hidden;
  padding: 10px 20px;
  border-radius: 980px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.3s;
  font-family: inherit;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.accept-button {
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(10px);
  color: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.accept-button::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.accept-button:hover {
  background: rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}

.accept-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.decline-button {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  color: white;
  opacity: 0.85;
}

.decline-button:hover {
  background: rgba(239, 68, 68, 0.3);
  border-color: rgba(239, 68, 68, 0.5);
  opacity: 1;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}

/* Empty State */
.empty-state {
  position: relative;
  overflow: hidden;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 60px 40px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
}

.empty-state::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.empty-state:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.empty-state-icon {
  font-size: 64px;
  margin-bottom: 16px;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
}

.empty-state-text {
  font-size: 20px;
  color: white;
  margin-bottom: 8px;
  font-weight: 600;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

/* Responsive Design */
@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .header {
    padding: 24px 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .invite-card {
    padding: 20px 16px;
  }

  .invite-actions {
    flex-direction: column;
  }

  .accept-button,
  .decline-button {
    width: 100%;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }

  .empty-state {
    padding: 40px 24px;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container {
    max-width: 700px;
  }
}

  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/v1/user/${userId}${tokenQS}" class="back-link">
        ← Back to Profile
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1>Invites</h1>
      <div class="header-subtitle">Join other people's trees</div>
    </div>

    <!-- Invites Section -->
    ${
      invites.length > 0
        ? `
    <ul class="invites-list">
      ${invites
        .map(
          (i) => `
        <li class="invite-card">
          <div class="invite-text">
            <strong>${i.userInviting.username}</strong>
            invited you to
            <strong>${i.rootId.name}</strong>
          </div>

          <div class="invite-actions">
            <form
              method="POST"
              action="/api/v1/user/${userId}/invites/${i._id}${tokenQS}"
            >
              <input type="hidden" name="accept" value="true" />
              <button type="submit" class="accept-button">Accept</button>
            </form>

            <form
              method="POST"
              action="/api/v1/user/${userId}/invites/${i._id}${tokenQS}"
            >
              <input type="hidden" name="accept" value="false" />
              <button type="submit" class="decline-button">Decline</button>
            </form>
          </div>
        </li>
      `,
        )
        .join("")}
    </ul>
    `
        : `
    <div class="empty-state">
      <div class="empty-state-icon">📬</div>
      <div class="empty-state-text">No pending invites</div>
    </div>
    `
    }
  </div>

  <script>
    // Intersection Observer for lazy loading animations
    const observerOptions = {
      root: null,
      rootMargin: '50px',
      threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          // Add a small stagger delay based on order
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, index * 50); // 50ms stagger between items
          
          // Stop observing once animated
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // Observe all invite cards
    document.querySelectorAll('.invite-card').forEach(card => {
      observer.observe(card);
    });
  </script>
</body>
</html>
`);
  } catch (err) {
    console.error("invites page error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post(
  "/user/:userId/invites/:inviteId",
  authenticate,

  async (req, res) => {
    try {
      const { userId, inviteId } = req.params;
      const { accept } = req.body; // "true" or "false"

      if (req.userId.toString() !== userId.toString()) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const acceptInvite = accept === "true";

      await respondToInvite({
        inviteId,
        userId: req.userId,
        acceptInvite,
      });

      // 🌐 HTML redirect support
      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/user/${userId}/invites?token=${req.query.token ?? ""}&html`,
        );
      }

      // 📦 JSON response
      return res.json({
        success: true,
        accepted: acceptInvite,
      });
    } catch (err) {
      console.error("respond invite error:", err);
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }
  },
);

router.get("/user/:userId/deleted", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    const deleted = await getDeletedBranchesForUser(userId);

    // ---------- JSON MODE ----------
    if (!wantHtml) {
      return res.json({
        userId,
        deleted,
      });
    }

    // ---------- HTML MODE ----------
    const user = await User.findById(userId).lean();
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${user.username} — Deleted Branches</title>
  <style>
:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

/* Animated background */
body::before,
body::after {
  content: '';
  position: fixed;
  border-radius: 50%;
  opacity: 0.08;
  animation: float 20s infinite ease-in-out;
  pointer-events: none;
}

body::before {
  width: 600px;
  height: 600px;
  background: white;
  top: -300px;
  right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px;
  height: 400px;
  background: white;
  bottom: -200px;
  left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(5deg);
  }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* Glass Back Navigation */
.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  color: white;
  text-decoration: none;
  border-radius: 980px;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  position: relative;
  overflow: hidden;
}

.back-link::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.back-link:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.back-link:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Glass Header Section */
.header {
  position: relative;
  overflow: hidden;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 32px;
  margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out 0.1s both;
}

.header::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.header:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  color: white;
  margin-bottom: 8px;
  line-height: 1.3;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.header h1 a {
  color: white;
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
}

.header h1 a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.header-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 0;
  font-weight: 400;
  line-height: 1.5;
}

/* Glass Deleted List */
.deleted-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.deleted-card {
  position: relative;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  color: white;
  overflow: hidden;
  
  /* Start hidden for lazy loading */
  opacity: 0;
  transform: translateY(30px);
}

/* When item becomes visible */
.deleted-card.visible {
  animation: fadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.deleted-card::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.deleted-card:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.deleted-card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.deleted-info {
  margin-bottom: 16px;
}

.deleted-name {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 6px;
}

.deleted-name a {
  color: white;
  text-decoration: none;
  transition: all 0.2s;
}

.deleted-name a:hover {
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.8);
}

.deleted-id {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  letter-spacing: -0.3px;
}

/* Revival Forms */
.revival-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}

.revive-as-root-form button {
  position: relative;
  overflow: hidden;
  padding: 12px 24px;
  border-radius: 980px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(10px);
  color: white;
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.3s;
  font-family: inherit;
  width: 100%;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.revive-as-root-form button::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.revive-as-root-form button:hover {
  background: rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}

.revive-as-root-form button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.revive-into-branch-form {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.revive-into-branch-form input[type="text"] {
  flex: 1;
  min-width: 180px;
  padding: 10px 14px;
  font-size: 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  font-family: inherit;
  color: white;
  font-weight: 500;
  transition: all 0.3s;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.revive-into-branch-form input[type="text"]::placeholder {
  color: rgba(255, 255, 255, 0.5);
  font-size: 13px;
}

.revive-into-branch-form input[type="text"]:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.revive-into-branch-form button {
  padding: 10px 18px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 980px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  color: white;
  cursor: pointer;
  transition: all 0.3s;
  font-family: inherit;
  white-space: nowrap;
  opacity: 0.85;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.revive-into-branch-form button:hover {
  background: rgba(255, 255, 255, 0.25);
  opacity: 1;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

/* Empty State */
.empty-state {
  position: relative;
  overflow: hidden;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 60px 40px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
}

.empty-state::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.empty-state:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.empty-state-icon {
  font-size: 64px;
  margin-bottom: 16px;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
}

.empty-state-text {
  font-size: 20px;
  color: white;
  margin-bottom: 8px;
  font-weight: 600;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.empty-state-subtext {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
}

/* Responsive Design */
@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .header {
    padding: 24px 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .deleted-card {
    padding: 20px 16px;
  }

  .deleted-name {
    font-size: 16px;
  }

  .revive-as-root-form button {
    width: 100%;
  }

  .revive-into-branch-form {
    flex-direction: column;
  }

  .revive-into-branch-form input[type="text"] {
    width: 100%;
    min-width: 0;
  }

  .revive-into-branch-form button {
    width: 100%;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }

  .empty-state {
    padding: 40px 24px;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container {
    max-width: 700px;
  }
}

  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/v1/user/${userId}${tokenQS}" class="back-link">
        ← Back to Profile
      </a>
    </div>

    <!-- Header Section -->
    <div class="header">
      <h1>
        Deleted Branches for
        <a href="/api/v1/user/${userId}${tokenQS}">${user.username}</a>
      </h1>
      <div class="header-subtitle">
        Recover deleted trees and branches as new trees or merge them into existing ones.
      </div>
    </div>

    <!-- Deleted Items List -->
    ${
      deleted.length > 0
        ? `
    <ul class="deleted-list">
      ${deleted
        .map(
          ({ _id, name }) => `
        <li class="deleted-card">
          <div class="deleted-info">
            <div class="deleted-name">
              <a href="/api/v1/root/${_id}${tokenQS}">
                ${name || "Untitled"}
              </a>
            </div>
            <div class="deleted-id">${_id}</div>
          </div>

          <div class="revival-section">
            <!-- Revive as Root -->
            <form
              method="POST"
              action="/api/v1/user/${userId}/deleted/${_id}/reviveAsRoot?token=${token}&html"
              class="revive-as-root-form"
            >
              <button type="submit">Revive as Root</button>
            </form>

            <!-- Revive into Branch -->
            <form
              method="POST"
              action="/api/v1/user/${userId}/deleted/${_id}/revive?token=${token}&html"
              class="revive-into-branch-form"
            >
              <input
                type="text"
                name="targetParentId"
                placeholder="Target parent node ID"
                required
              />
              <button type="submit">Revive into Branch</button>
            </form>
          </div>
        </li>
      `,
        )
        .join("")}
    </ul>
    `
        : `
    <div class="empty-state">
      <div class="empty-state-icon">🗑️</div>
      <div class="empty-state-text">No deleted branches</div>
      <div class="empty-state-subtext">
        Deleted branches will appear here and can be revived
      </div>
    </div>
    `
    }
  </div>

  <script>
    // Intersection Observer for lazy loading animations
    const observerOptions = {
      root: null,
      rootMargin: '50px',
      threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          // Add a small stagger delay based on order
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, index * 50); // 50ms stagger between items
          
          // Stop observing once animated
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // Observe all deleted cards
    document.querySelectorAll('.deleted-card').forEach(card => {
      observer.observe(card);
    });
  </script>
</body>
</html>
`);
  } catch (err) {
    console.error("Error in /user/:userId/deleted:", err);
    res.status(500).json({ error: err.message });
  }
});
router.post(
  "/user/:userId/deleted/:nodeId/revive",
  authenticate,

  async (req, res) => {
    try {
      const { userId, nodeId } = req.params;
      const { targetParentId } = req.body;

      if (req.userId.toString() !== userId.toString()) {
        return res.status(403).json({ error: "Not authorized" });
      }

      if (!targetParentId) {
        return res.status(400).json({
          error: "targetParentId is required",
        });
      }

      const result = await reviveNodeBranch({
        deletedNodeId: nodeId,
        targetParentId,
        userId: req.userId,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/root/${nodeId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      console.error("revive branch error:", err);
      return res.status(400).json({ error: err.message });
    }
  },
);

router.post(
  "/user/:userId/deleted/:nodeId/reviveAsRoot",
  authenticate,

  async (req, res) => {
    try {
      const { userId, nodeId } = req.params;

      if (req.userId.toString() !== userId.toString()) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const result = await reviveNodeBranchAsRoot({
        deletedNodeId: nodeId,
        userId: req.userId,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/root/${nodeId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      console.error("revive root error:", err);
      return res.status(400).json({ error: err.message });
    }
  },
);

router.post("/user/:userId/api-keys", authenticate, async (req, res) => {
  if (req.userId.toString() !== req.params.userId.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  return createApiKey(req, res);
});

router.get("/user/:userId/api-keys", authenticate, async (req, res) => {
  try {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    const user = await User.findById(req.userId)
      .select("username apiKeys")
      .lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    const apiKeys = user.apiKeys ?? [];

    // ---------- JSON MODE ----------
    if (!wantHtml) {
      return res.json(
        apiKeys.map((k) => ({
          id: k._id,
          name: k.name,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsedAt,
          usageCount: k.usageCount,
          revoked: k.revoked,
        })),
      );
    }

    // ---------- HTML MODE ----------
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${user.username} — API Keys</title>
  <style>
:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

/* Animated background */
body::before,
body::after {
  content: '';
  position: fixed;
  border-radius: 50%;
  opacity: 0.08;
  animation: float 20s infinite ease-in-out;
  pointer-events: none;
}

body::before {
  width: 600px;
  height: 600px;
  background: white;
  top: -300px;
  right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px;
  height: 400px;
  background: white;
  bottom: -200px;
  left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(5deg);
  }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* Glass Back Navigation */
.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  color: white;
  text-decoration: none;
  border-radius: 980px;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  position: relative;
  overflow: hidden;
}

.back-link::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.back-link:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.back-link:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Glass Header Section */
.header {
  position: relative;
  overflow: hidden;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 32px;
  margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out 0.1s both;
}

.header::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.header:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  color: white;
  margin-bottom: 8px;
  line-height: 1.3;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.header-subtitle {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 0;
  font-weight: 400;
  line-height: 1.5;
}

/* Create Form Card */
.create-card {
  position: relative;
  overflow: hidden;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
}

.create-card::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.create-card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.create-form {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.create-form input {
  flex: 1;
  min-width: 200px;
  padding: 12px 16px;
  font-size: 15px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  font-family: inherit;
  color: white;
  font-weight: 500;
  transition: all 0.3s;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
}

.create-form input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

.create-form input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.create-form button {
  position: relative;
  overflow: hidden;
  padding: 12px 24px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 980px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(10px);
  color: white;
  cursor: pointer;
  transition: all 0.3s;
  font-family: inherit;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.create-form button::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.create-form button:hover {
  background: rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}

.create-form button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.create-hint {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.75);
}

/* API Keys List */
.keys-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.key-card {
  position: relative;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  color: white;
  overflow: hidden;
  
  /* Start hidden for lazy loading */
  opacity: 0;
  transform: translateY(30px);
}

/* Active keys get green glass tint */
.key-card.active {
  background: rgba(76, 175, 80, 0.2);
  border-color: rgba(76, 175, 80, 0.35);
}

.key-card.active::after {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(
    circle at top right,
    rgba(76, 175, 80, 0.15),
    transparent 70%
  );
  pointer-events: none;
}

/* When item becomes visible */
.key-card.visible {
  animation: fadeInUp 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

.key-card::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.key-card:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
}

.key-card.active:hover {
  background: rgba(76, 175, 80, 0.28);
  box-shadow: 0 12px 32px rgba(76, 175, 80, 0.15);
}

.key-card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.key-name {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 12px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.key-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.meta-item {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.85);
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 980px;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.badge.active {
  background: rgba(76, 175, 80, 0.25);
  color: white;
  border-color: rgba(76, 175, 80, 0.4);
}

.badge.revoked {
  background: rgba(239, 68, 68, 0.25);
  color: white;
  border-color: rgba(239, 68, 68, 0.4);
}

.key-actions {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
}

.revoke-button {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 600;
  border-radius: 980px;
  border: 1px solid rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.25);
  color: white;
  cursor: pointer;
  transition: all 0.3s;
  font-family: inherit;
}

.revoke-button:hover {
  background: rgba(239, 68, 68, 0.35);
  border-color: rgba(239, 68, 68, 0.5);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
}

/* Empty State */
.empty-state {
  position: relative;
  overflow: hidden;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 60px 40px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
}

.empty-state::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.empty-state:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

.empty-state-icon {
  font-size: 64px;
  margin-bottom: 16px;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
}

.empty-state-text {
  font-size: 20px;
  color: white;
  margin-bottom: 8px;
  font-weight: 600;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.empty-state-subtext {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
}

/* Responsive Design */
@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .header,
  .create-card {
    padding: 24px 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .create-form {
    flex-direction: column;
  }

  .create-form input {
    width: 100%;
    min-width: 0;
  }

  .create-form button {
    width: 100%;
  }

  .key-card {
    padding: 20px 16px;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }

  .empty-state {
    padding: 40px 24px;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container {
    max-width: 700px;
  }
}

  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/v1/user/${req.userId}${tokenQS}" class="back-link">
        ← Back to Profile
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1>API Keys</h1>
      <div class="header-subtitle">
        Manage programmatic access to your account
      </div>
    </div>

    <!-- Create API Key -->
    <div class="create-card">
      <form class="create-form" method="POST" action="/api/v1/user/${
        req.userId
      }/api-keys?token=${token}&html">
        <input type="text" name="name" placeholder="Key name (optional)" />
        <button type="submit">Create Key</button>
      </form>
      <div class="create-hint">
        You'll only see the key once after creation.
      </div>
    </div>

    <!-- API Keys List -->
    ${
      apiKeys.length > 0
        ? `
    <div class="keys-list">
      ${apiKeys
        .map(
          (k) => `
        <div class="key-card${!k.revoked ? " active" : ""}">
          <div class="key-name">${k.name || "Untitled Key"}</div>
          
          <div class="key-meta">
            <div class="meta-item">
              Created ${new Date(k.createdAt).toLocaleDateString()}
            </div>
            <div class="meta-item">
              Used ${k.usageCount} ${k.usageCount === 1 ? "time" : "times"}
            </div>
            <div class="meta-item">
              <span class="badge ${k.revoked ? "revoked" : "active"}">
                ${k.revoked ? "Revoked" : "Active"}
              </span>
            </div>
          </div>

          ${
            !k.revoked
              ? `
          <div class="key-actions">
            <button class="revoke-button" data-key-id="${k._id}">
              Revoke Key
            </button>
          </div>
          `
              : ""
          }
        </div>
      `,
        )
        .join("")}
    </div>
    `
        : `
    <div class="empty-state">
      <div class="empty-state-icon">🔑</div>
      <div class="empty-state-text">No API keys yet</div>
      <div class="empty-state-subtext">
        Create one above to get started
      </div>
    </div>
    `
    }
  </div>

  <script>
    // Intersection Observer for lazy loading animations
    const observerOptions = {
      root: null,
      rootMargin: '50px',
      threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            entry.target.classList.add('visible');
          }, index * 50);
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // Observe all key cards
    document.querySelectorAll('.key-card').forEach(card => {
      observer.observe(card);
    });

    // Revoke button handler
    document.addEventListener("click", async (e) => {
      if (!e.target.classList.contains("revoke-button")) return;

      const keyId = e.target.dataset.keyId;

      if (!confirm("Revoke this API key? This cannot be undone.")) return;

      const token = new URLSearchParams(window.location.search).get("token") || "";
      const qs = token ? "?token=" + encodeURIComponent(token) : "";

      try {
        const res = await fetch(
          "/api/v1/user/${req.userId}/api-keys/" + keyId + qs,
          { method: "DELETE" }
        );

        const data = await res.json();
        if (!data.message) throw new Error("Revoke failed");

        location.reload();
      } catch (err) {
        alert("Failed to revoke API key");
      }
    });
  </script>
</body>
</html>
`);
  } catch (err) {
    console.error("api keys page error:", err);
    res.status(500).json({ error: err.message });
  }
});
router.delete(
  "/user/:userId/api-keys/:keyId",
  authenticate,

  async (req, res) => {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    return deleteApiKey(req, res);
  },
);

router.get("/user/:userId/shareToken", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.userId.toString() !== userId.toString()) {
      return res.status(403).send("Not authorized");
    }

    const user = await User.findById(userId)
      .select("username htmlShareToken")
      .lean();

    if (!user) {
      return res.status(404).send("User not found");
    }

    const token = user.htmlShareToken;
    const tokenQS = req.query.token
      ? `?token=${req.query.token}&html`
      : "?html";

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Share Token — @${user.username}</title>
  <style>
:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

/* Animated background */
body::before,
body::after {
  content: '';
  position: fixed;
  border-radius: 50%;
  opacity: 0.08;
  animation: float 20s infinite ease-in-out;
  pointer-events: none;
}

body::before {
  width: 600px;
  height: 600px;
  background: white;
  top: -300px;
  right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px;
  height: 400px;
  background: white;
  bottom: -200px;
  left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(5deg);
  }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.container {
  max-width: 600px;
  width: 100%;
  position: relative;
  z-index: 1;
}

/* Glass Card */
.card {
  position: relative;
  overflow: hidden;
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 24px;
  padding: 48px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out;
}

.card::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.card:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Header */
.header {
  text-align: center;
  margin-bottom: 32px;
}

.icon {
  font-size: 64px;
  margin-bottom: 20px;
  display: inline-block;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.2));
  animation: bounce 2s infinite;
}

@keyframes bounce {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

h1 {
  font-size: 32px;
  font-weight: 600;
  color: white;
  margin-bottom: 8px;
  letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.username {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 500;
}

/* Description */
.description {
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.6;
  margin-bottom: 28px;
  font-size: 15px;
  text-align: center;
}

/* Welcome Box */
.welcome-box {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  padding: 24px;
  border-radius: 16px;
  margin-bottom: 28px;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.welcome-title {
  font-size: 18px;
  font-weight: 600;
  color: white;
  margin-bottom: 12px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.welcome-text {
  color: rgba(255, 255, 255, 0.9);
  line-height: 1.6;
  font-size: 15px;
}

/* Token Section */
.token-section {
  margin-bottom: 28px;
}

.token-label {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
}

.token-display {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  padding: 16px 20px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  transition: all 0.3s;
}

.token-display:hover {
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.2);
}

.token-text {
  flex: 1;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 14px;
  color: white;
  word-break: break-all;
  font-weight: 500;
}

.btn-copy {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.25);
  color: white;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 980px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s;
  flex-shrink: 0;
}

.btn-copy:hover {
  background: rgba(255, 255, 255, 0.35);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* Form Section */
.form-section {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  padding: 24px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  margin-bottom: 24px;
}

.form-title {
  font-size: 16px;
  font-weight: 600;
  color: white;
  margin-bottom: 16px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

.form-row {
  display: flex;
  gap: 12px;
}

input {
  flex: 1;
  padding: 14px 18px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  font-size: 15px;
  font-family: 'SF Mono', Monaco, monospace;
  transition: all 0.3s;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  color: white;
  font-weight: 500;
}

input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

input:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.4);
  background: rgba(255, 255, 255, 0.2);
  box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.1);
}

.btn-submit {
  padding: 14px 28px;
  border-radius: 980px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: rgba(255, 255, 255, 0.3);
  backdrop-filter: blur(10px);
  color: white;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
}

.btn-submit::before {
  content: "";
  position: absolute;
  inset: -40%;
  background: radial-gradient(
    120% 60% at 0% 0%,
    rgba(255, 255, 255, 0.35),
    transparent 60%
  );
  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.btn-submit:hover {
  background: rgba(255, 255, 255, 0.4);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
}

.btn-submit:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Info Box */
.info-box {
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  padding: 14px 18px;
  border-radius: 12px;
  border-left: 3px solid rgba(255, 255, 255, 0.5);
  margin-bottom: 24px;
}

.info-box-content {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.85);
  line-height: 1.6;
}

/* Back Links */
.back-links {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.back-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  text-decoration: none;
  color: white;
  font-weight: 600;
  font-size: 14px;
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(10px);
  border-radius: 980px;
  transition: all 0.3s;
  border: 1px solid rgba(255, 255, 255, 0.25);
}

.back-link:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

/* Responsive */
@media (max-width: 640px) {
  body {
    padding: 16px;
    align-items: flex-start;
    padding-top: 40px;
  }

  .card {
    padding: 32px 24px;
  }

  h1 {
    font-size: 28px;
  }

  .icon {
    font-size: 56px;
  }

  .form-row {
    flex-direction: column;
  }

  .btn-submit {
    width: 100%;
  }

  .token-display {
    flex-direction: column;
    align-items: stretch;
  }

  .btn-copy {
    width: 100%;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container {
    max-width: 500px;
  }
}
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <!-- Header -->
      <div class="header">
        <div class="icon">🔐</div>
        <h1>Share Token</h1>
        <div class="username">@${user.username}</div>
      </div>

      ${
        token
          ? `
          <!-- Existing Token View -->
          <div class="description">
            Share read-only access to your content.
          </div>

          <div class="token-section">
            <div class="token-label">Your Token</div>
            <div class="token-display">
              <div class="token-text" id="tokenText">${token}</div>
              <button class="btn-copy" onclick="copyToken()">Copy</button>
            </div>
          </div>

          <div class="info-box">
            <div class="info-box-content">
              Change your token anytime to revoke shared URL access.
            </div>
          </div>

          <div class="form-section">
            <div class="form-title">Update Token</div>
            <form method="POST" action="/api/v1/user/${userId}/shareToken${tokenQS}">
              <div class="form-row">
                <input
                  name="htmlShareToken"
                  placeholder="Enter new token"
                  required
                />
                <button type="submit" class="btn-submit">Update</button>
              </div>
            </form>
          </div>
        `
          : `
          <!-- First Time View -->
          <div class="welcome-box">
            <div class="welcome-title">Create a Share Token</div>
            <div class="welcome-text">
              Share read-only access to your trees and notes. Change it anytime to revoke old links.
            </div>
          </div>

          <div class="form-section">
            <div class="form-title">Choose Your Token</div>
            <form method="POST" action="/api/v1/user/${userId}/shareToken${tokenQS}">
              <div class="form-row">
                <input
                  name="htmlShareToken"
                  placeholder="Enter a unique token"
                  required
                />
                <button type="submit" class="btn-submit">Create</button>
              </div>
            </form>
          </div>
        `
      }

      <div class="back-links">
        <a class="back-link" href="/api/v1/user/${userId}${tokenQS}">
          ← Back to Profile
        </a>
        <a class="back-link" target="_top" href="/">
          ← Back to tree.tabors.site
        </a>
      </div>
    </div>
  </div>

  <script>
    function copyToken() {
      const tokenText = document.getElementById('tokenText').textContent;
      navigator.clipboard.writeText(tokenText).then(() => {
        const btn = document.querySelector('.btn-copy');
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied';
        setTimeout(() => {
          btn.textContent = originalText;
        }, 2000);
      });
    }
  </script>
</body>
</html>
      `);
  } catch (err) {
    console.error("shareToken page error:", err);
    res.status(500).send("Server error");
  }
});
router.post("/user/:userId/shareToken", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // 1️⃣ Fetch user BEFORE updating token
    const user = await User.findById(userId).select("htmlShareToken");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const hadShareTokenBefore = Boolean(user.htmlShareToken);

    // 2️⃣ Create/update token
    const u = await setHtmlShareToken({
      userId,
      htmlShareToken: req.body.htmlShareToken,
    });

    // 3️⃣ Conditional redirect
    if (!hadShareTokenBefore) {
      return res.redirect("/app");
    }

    // existing behavior
    return res.redirect(
      `/api/v1/user/${userId}?token=${u.htmlShareToken ?? ""}&html`,
    );
  } catch (err) {
    console.error("shareToken update error:", err);
    res.status(400).send(err.message || "Failed to update share token");
  }
});

function buildQueryString(req) {
  const allowedParams = ["token", "html"];

  const filtered = Object.entries(req.query)
    .filter(([key]) => allowedParams.includes(key))
    .map(([key, val]) =>
      val === "" ? key : `${key}=${encodeURIComponent(val)}`,
    )
    .join("&");

  return filtered ? `?${filtered}` : "";
}
router.get("/user/:userId/energy", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const qs = buildQueryString(req);
    let user = await User.findById(userId).lean().exec();
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const energyAmount = user.availableEnergy?.amount ?? 0;
    const additionalEnergy = user.additionalEnergy?.amount ?? 0;
    const profileType = (user.profileType || "basic").toLowerCase();
    const planExpiresAt = user.planExpiresAt || null;

    const llmConn = user.customLlmConnection || null;
    const hasLlm = !!(llmConn && llmConn.baseUrl && !llmConn.revoked);
    const llmRevoked = llmConn?.revoked === true;
    const hasLlmConfig = !!(llmConn && llmConn.baseUrl);
    const isBasic = profileType === "basic";

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    if (!wantHtml) {
      return res.json({
        userId: user._id,
        profileType,
        energy: user.availableEnergy,
        additionalEnergy: user.additionalEnergy,
        hasCustomLlm: hasLlm,
      });
    }

    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#667eea">
<title>Energy · @${user.username}</title>
<style>
  :root {
    --glass-water-rgb: 115, 111, 230;
    --glass-alpha: 0.28;
    --glass-alpha-hover: 0.38;
  }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    -webkit-tap-highlight-color: transparent;
  }

  html, body {
    background: #736fe6;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
      "Oxygen", "Ubuntu", "Cantarell", sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    min-height: 100dvh;
    padding: 20px;
    color: white;
    position: relative;
    overflow-x: hidden;
    touch-action: manipulation;
  }

  body::before,
  body::after {
    content: "";
    position: fixed;
    border-radius: 50%;
    opacity: 0.08;
    animation: float 20s infinite ease-in-out;
    pointer-events: none;
  }

  body::before {
    width: 600px; height: 600px;
    background: white; top: -300px; right: -200px;
    animation-delay: -5s;
  }

  body::after {
    width: 400px; height: 400px;
    background: white; bottom: -200px; left: -100px;
    animation-delay: -10s;
  }

  @keyframes float {
    0%, 100% { transform: translateY(0) rotate(0deg); }
    50% { transform: translateY(-30px) rotate(5deg); }
  }

  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(30px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .container {
    max-width: 900px;
    margin: 0 auto;
    position: relative;
    z-index: 1;
  }

  /* =========================================================
     GLASS BUTTONS
     ========================================================= */
  .back-link,
  .glass-btn {
    position: relative;
    overflow: hidden;
    padding: 10px 20px;
    border-radius: 980px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    white-space: nowrap;
    background: rgba(var(--glass-water-rgb), var(--glass-alpha));
    backdrop-filter: blur(22px) saturate(140%);
    -webkit-backdrop-filter: blur(22px) saturate(140%);
    color: white;
    text-decoration: none;
    font-family: inherit;
    font-size: 15px;
    font-weight: 600;
    letter-spacing: -0.2px;
    border: 1px solid rgba(255, 255, 255, 0.28);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.25);
    cursor: pointer;
    transition: background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
      box-shadow 0.3s ease;
  }
  .glass-card > * {
    position: relative;
    z-index: 1;
  }
  .back-link::before,
  .glass-btn::before {
    content: "";
    position: absolute;
    inset: -40%;
    background:
      radial-gradient(120% 60% at 0% 0%, rgba(255, 255, 255, 0.35), transparent 60%),
      linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.25), transparent 70%);
    opacity: 0;
    transform: translateX(-30%) translateY(-10%);
    transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
  }

  .back-link:hover,
  .glass-btn:hover {
    background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
    transform: translateY(-2px);
  }

  .back-link:hover::before,
  .glass-btn:hover::before {
    opacity: 1;
    transform: translateX(30%) translateY(10%);
  }

  .back-link:active,
  .glass-btn:active {
    background: rgba(var(--glass-water-rgb), 0.45);
    transform: translateY(0);
  }

  /* =========================================================
     GLASS CARDS
     ========================================================= */
  .glass-card {
    background: rgba(var(--glass-water-rgb), var(--glass-alpha));
    backdrop-filter: blur(22px) saturate(140%);
    -webkit-backdrop-filter: blur(22px) saturate(140%);
    border-radius: 16px;
    padding: 28px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.28);
    margin-bottom: 24px;
    animation: fadeInUp 0.6s ease-out both;
    position: relative;
    overflow: hidden;
  }

  .glass-card::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.05));
    pointer-events: none;
  }

  .glass-card h2 {
    font-size: 18px;
    font-weight: 600;
    color: white;
    margin-bottom: 16px;
    letter-spacing: -0.3px;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .back-nav {
    display: flex;
    gap: 12px;
    margin-bottom: 20px;
    flex-wrap: wrap;
    animation: fadeInUp 0.5s ease-out;
  }

  /* =========================================================
     ENERGY STATUS
     ========================================================= */
  .energy-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 14px;
  }

  .energy-stat {
    padding: 18px 20px;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 14px;
    text-align: center;
    position: relative;
    overflow: hidden;
  }

  .energy-stat::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent);
    pointer-events: none;
  }

  .energy-stat-label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255, 255, 255, 0.6);
    margin-bottom: 6px;
  }

  .energy-stat-value {
    font-size: 28px;
    font-weight: 700;
    color: white;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .energy-stat-sub {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
    margin-top: 4px;
  }

  .energy-stat.plan-basic {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .energy-stat.plan-standard {
    background: linear-gradient(135deg, rgba(96, 165, 250, 0.2), rgba(37, 99, 235, 0.2));
    border-color: rgba(96, 165, 250, 0.3);
  }

  .energy-stat.plan-premium {
    background: linear-gradient(135deg, rgba(168, 85, 247, 0.2), rgba(124, 58, 237, 0.2));
    border-color: rgba(168, 85, 247, 0.3);
  }

  .energy-stat.plan-god {
    background: linear-gradient(135deg, rgba(250, 204, 21, 0.2), rgba(245, 158, 11, 0.2));
    border-color: rgba(250, 204, 21, 0.3);
  }

  /* =========================================================
     PLAN CARDS
     ========================================================= */
  .plan-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
  }

  .plan-box {
    padding: 24px 20px;
    border-radius: 14px;
    text-align: center;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    position: relative;
    overflow: hidden;
  }

  .plan-box::before {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    transition: all 0.3s;
  }

  .plan-box[data-plan="basic"] {
    background: rgba(255, 255, 255, 0.2);
    border: 2px solid rgba(255, 255, 255, 0.18);
  }
  .plan-box[data-plan="basic"]::before {
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent);
  }

  .plan-box[data-plan="standard"] {
    background: rgba(96, 165, 250, 0.08);
    border: 2px solid rgba(96, 165, 250, 0.25);
  }
  .plan-box[data-plan="standard"]::before {
    background: linear-gradient(180deg, rgba(96, 165, 250, 0.1), transparent);
  }

  .plan-box[data-plan="premium"] {
    background: rgba(168, 85, 247, 0.08);
    border: 2px solid rgba(168, 85, 247, 0.25);
  }
  .plan-box[data-plan="premium"]::before {
    background: linear-gradient(180deg, rgba(168, 85, 247, 0.1), transparent);
  }

  .plan-box:hover:not(.disabled) {
    transform: translateY(-4px);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.15);
  }

  .plan-box[data-plan="standard"]:hover:not(.disabled) {
    background: rgba(96, 165, 250, 0.16);
    border-color: rgba(96, 165, 250, 0.4);
  }

  .plan-box[data-plan="premium"]:hover:not(.disabled) {
    background: rgba(168, 85, 247, 0.16);
    border-color: rgba(168, 85, 247, 0.4);
  }

  .plan-box.selected {
    transform: translateY(-4px);
    box-shadow: 0 0 0 3px rgba(72, 187, 178, 0.6), 0 8px 28px rgba(0, 0, 0, 0.15), 0 0 30px rgba(72, 187, 178, 0.15);
  }

  .plan-box[data-plan="standard"].selected {
    border-color: rgba(72, 187, 178, 0.9);
    background: rgba(96, 165, 250, 0.18);
  }

  .plan-box[data-plan="premium"].selected {
    border-color: rgba(72, 187, 178, 0.9);
    background: rgba(168, 85, 247, 0.18);
  }

  .plan-box.disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

 .plan-box.current-plan {
    border-color: rgba(255, 255, 255, 0.6);
    border-width: 3px;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.15), 0 0 20px rgba(255, 255, 255, 0.08);
  }

  .plan-name {
    font-size: 20px;
    font-weight: 700;
    color: white;
    margin-bottom: 6px;
  }

  .plan-price {
    font-size: 24px;
    font-weight: 700;
    color: white;
    margin-bottom: 4px;
  }

  .plan-period {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.55);
  }

  .plan-current-tag {
    display: inline-block;
    margin-top: 10px;
    padding: 4px 12px;
    border-radius: 980px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.25);
  }

  .plan-features {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .plan-feature {
    font-size: 13px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.75);
  }

  .plan-feature.dim { color: rgba(255, 255, 255, 0.4); }

  .plan-feature.highlight {
    color: rgba(72, 187, 178, 0.95);
    font-weight: 600;
  }

  .plan-renew-note {
    margin-top: 14px;
    text-align: center;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.55);
    font-style: italic;
  }

  /* =========================================================
     ENERGY BUY
     ========================================================= */
  .energy-btns {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .energy-buy-btn {
    padding: 12px 20px;
    border-radius: 980px;
    border: 1px solid rgba(255, 255, 255, 0.28);
    background: rgba(var(--glass-water-rgb), var(--glass-alpha));
    backdrop-filter: blur(22px) saturate(140%);
    -webkit-backdrop-filter: blur(22px) saturate(140%);
    color: white;
    font-weight: 600;
    font-size: 14px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.25);
    position: relative;
    overflow: hidden;
  }

  .energy-buy-btn::before {
    content: "";
    position: absolute;
    inset: -40%;
    background:
      radial-gradient(120% 60% at 0% 0%, rgba(255, 255, 255, 0.35), transparent 60%),
      linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.25), transparent 70%);
    opacity: 0;
    transform: translateX(-30%) translateY(-10%);
    transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
  }

  .energy-buy-btn:hover {
    background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
    transform: translateY(-2px);
  }

  .energy-buy-btn:hover::before {
    opacity: 1;
    transform: translateX(30%) translateY(10%);
  }

  .energy-buy-btn:active {
    background: rgba(var(--glass-water-rgb), 0.45);
    transform: translateY(0);
  }

  /* =========================================================
     CHECKOUT
     ========================================================= */
  .checkout-summary {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .checkout-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    transition: background 0.2s;
  }

  .checkout-row:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .checkout-row-left {
    display: flex;
    align-items: center;
    gap: 12px;
    flex: 1;
    min-width: 0;
  }

  .checkout-row-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    flex-shrink: 0;
  }

  .checkout-row-icon.plan-icon {
    background: rgba(168, 85, 247, 0.2);
    border: 1px solid rgba(168, 85, 247, 0.3);
  }

  .checkout-row-icon.energy-icon {
    background: rgba(250, 204, 21, 0.2);
    border: 1px solid rgba(250, 204, 21, 0.3);
  }

  .checkout-row-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .checkout-row-label {
    font-size: 14px;
    font-weight: 600;
    color: white;
  }

  .checkout-row-desc {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.5);
  }

  .checkout-row-right {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .checkout-row-value {
    font-size: 16px;
    font-weight: 700;
    color: white;
  }

  .checkout-remove {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(239, 68, 68, 0.15);
    color: rgba(255, 255, 255, 0.7);
    font-size: 14px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    line-height: 1;
  }

  .checkout-remove:hover {
    background: rgba(239, 68, 68, 0.35);
    border-color: rgba(239, 68, 68, 0.5);
    color: white;
  }

  .checkout-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
    margin: 4px 0;
  }

  .checkout-total {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 18px 20px;
    background: linear-gradient(135deg, rgba(72, 187, 178, 0.2), rgba(56, 163, 155, 0.15));
    border: 1px solid rgba(72, 187, 178, 0.35);
    border-radius: 14px;
  }

  .checkout-total-label {
    font-size: 16px;
    font-weight: 600;
    color: white;
  }

  .checkout-total-value {
    font-size: 28px;
    font-weight: 700;
    color: white;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .checkout-btn {
    width: 100%;
    padding: 18px;
    border-radius: 980px;
    border: 1px solid rgba(72, 187, 178, 0.5);
    background: linear-gradient(135deg, rgba(72, 187, 178, 0.4), rgba(56, 163, 155, 0.35));
    backdrop-filter: blur(22px) saturate(140%);
    -webkit-backdrop-filter: blur(22px) saturate(140%);
    color: white;
    font-size: 17px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    margin-top: 16px;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
      0 0 20px rgba(72, 187, 178, 0.1),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
    position: relative;
    overflow: hidden;
    letter-spacing: -0.2px;
  }

  .checkout-btn::before {
    content: "";
    position: absolute;
    inset: -40%;
    background:
      radial-gradient(120% 60% at 0% 0%, rgba(255, 255, 255, 0.35), transparent 60%),
      linear-gradient(120deg, transparent 30%, rgba(255, 255, 255, 0.25), transparent 70%);
    opacity: 0;
    transform: translateX(-30%) translateY(-10%);
    transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
  }

  .checkout-btn:hover {
    background: linear-gradient(135deg, rgba(72, 187, 178, 0.55), rgba(56, 163, 155, 0.5));
    transform: translateY(-2px);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18),
      0 0 30px rgba(72, 187, 178, 0.2);
  }

  .checkout-btn:hover::before {
    opacity: 1;
    transform: translateX(30%) translateY(10%);
  }

  .checkout-btn:active { transform: translateY(0); }

  .checkout-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
  }

  .checkout-btn:disabled:hover {
    background: linear-gradient(135deg, rgba(72, 187, 178, 0.4), rgba(56, 163, 155, 0.35));
    transform: none;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }

  .checkout-legal {
    text-align: center;
    margin-top: 14px;
    font-size: 12px;
    color: rgba(255, 255, 255, 0.45);
    line-height: 1.5;
  }

  .checkout-legal-link {
    color: rgba(255, 255, 255, 0.7);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
    transition: color 0.2s;
  }

  .checkout-legal-link:hover { color: white; }

  .checkout-note {
    text-align: center;
    margin-top: 10px;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.45);
    font-style: italic;
  }

  .checkout-empty {
    text-align: center;
    padding: 28px 20px;
    color: rgba(255, 255, 255, 0.4);
    font-style: italic;
    font-size: 14px;
    border: 2px dashed rgba(255, 255, 255, 0.12);
    border-radius: 14px;
  }

  /* =========================================================
     LLM SECTION
     ========================================================= */
  .llm-section-wrapper {
    position: relative;
  }

  .llm-section-wrapper.locked .llm-section-content {
    opacity: 0.2;
    pointer-events: none;
    filter: blur(2px);
  }

  .llm-upgrade-overlay {
    display: none;
    position: absolute;
    inset: 0;
    z-index: 5;
    border-radius: inherit;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
  }

  .llm-section-wrapper.locked .llm-upgrade-overlay {
    display: flex;
  }

  .llm-upgrade-text {
    font-size: 16px;
    font-weight: 600;
    color: white;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .llm-upgrade-sub {
    font-size: 13px;
    color: rgba(255, 255, 255, 0.7);
  }

  .llm-sub {
    font-size: 14px;
    color: rgba(255, 255, 255, 0.6);
    line-height: 1.5;
    margin-bottom: 16px;
  }

  .llm-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 16px;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
  }

  .llm-toggle-label {
    font-size: 14px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.8);
  }

  .glass-toggle {
    position: relative;
    width: 54px;
    height: 28px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.3);
    backdrop-filter: blur(18px);
    cursor: pointer;
    transition: all 0.25s ease;
    flex-shrink: 0;
  }

  .glass-toggle.active {
    background: rgba(72, 187, 178, 0.45);
    box-shadow: 0 0 16px rgba(72, 187, 178, 0.35);
  }

  .glass-toggle-knob {
    position: absolute;
    top: 4px;
    left: 4px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: white;
    transition: all 0.25s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .glass-toggle.active .glass-toggle-knob {
    left: 28px;
  }

  .llm-connected-badge {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: rgba(72, 187, 120, 0.15);
    border: 1px solid rgba(72, 187, 120, 0.3);
    border-radius: 10px;
    margin-bottom: 16px;
  }

  .llm-connected-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: rgba(72, 187, 120, 0.9);
    box-shadow: 0 0 8px rgba(72, 187, 120, 0.5);
    flex-shrink: 0;
  }

  .llm-connected-text {
    font-size: 13px;
    font-weight: 600;
    color: rgba(72, 187, 120, 0.9);
  }

  .llm-connected-detail {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.45);
    margin-left: auto;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 300px;
  }

  .llm-fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
    transition: opacity 0.3s;
  }

  .llm-fields.disabled {
    opacity: 0.35;
    pointer-events: none;
  }

  .llm-field-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .llm-field-label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: rgba(255, 255, 255, 0.55);
  }

  .llm-input {
    padding: 14px 16px;
    font-size: 15px;
    border-radius: 12px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.15);
    color: white;
    font-family: inherit;
    font-weight: 500;
    transition: all 0.2s;
    width: 100%;
  }

  .llm-input::placeholder { color: rgba(255, 255, 255, 0.35); }

  .llm-input:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.6);
    background: rgba(255, 255, 255, 0.25);
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15);
    transform: translateY(-2px);
  }

  .llm-btn-row {
    display: flex;
    gap: 12px;
    margin-top: 4px;
  }

  .llm-save-btn,
  .llm-disconnect-btn {
    padding: 14px 24px;
    border-radius: 980px;
    border: 1px solid;
    color: white;
    font-weight: 600;
    font-size: 15px;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.3s;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.2);
    background: none;
  }

  .llm-save-btn {
    flex: 1;
    border-color: rgba(72, 187, 178, 0.4);
    background: rgba(72, 187, 178, 0.3);
  }

  .llm-save-btn:hover {
    background: rgba(72, 187, 178, 0.45);
    transform: translateY(-2px);
  }

  .llm-disconnect-btn {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.25);
  }

  .llm-disconnect-btn:hover {
    background: rgba(239, 68, 68, 0.4);
    transform: translateY(-2px);
  }

  .llm-status {
    margin-top: 10px;
    font-size: 13px;
    font-weight: 600;
    display: none;
  }

  /* =========================================================
     MODAL (Terms / Privacy)
     ========================================================= */
  .modal-overlay {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .modal-overlay.show { display: flex; }

  .modal-container {
    width: 100%;
    max-width: 720px;
    height: 85vh;
    height: 85dvh;
    background: rgba(var(--glass-water-rgb), 0.35);
    backdrop-filter: blur(22px) saturate(140%);
    -webkit-backdrop-filter: blur(22px) saturate(140%);
    border-radius: 20px;
    border: 1px solid rgba(255, 255, 255, 0.28);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.15);
    flex-shrink: 0;
  }

  .modal-title {
    font-size: 16px;
    font-weight: 600;
    color: white;
  }

  .modal-close {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.25);
    background: rgba(255, 255, 255, 0.15);
    color: white;
    font-size: 18px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s;
    line-height: 1;
  }

  .modal-close:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  .modal-body {
    flex: 1;
    overflow: hidden;
  }

  .modal-body iframe {
    width: 100%;
    height: 100%;
    border: none;
  }

  /* =========================================================
     RESPONSIVE
     ========================================================= */
  @media (max-width: 640px) {
    body { padding: 16px; }
    .container { max-width: 100%; }
    .glass-card { padding: 20px; }
    .back-nav { flex-direction: column; }
    .back-link { width: 100%; justify-content: center; }
    .energy-grid { grid-template-columns: 1fr; }
    .plan-grid { grid-template-columns: 1fr; }
    .energy-btns { flex-direction: column; }
    .energy-buy-btn { width: 100%; }
    .llm-btn-row { flex-direction: column; }
    .llm-save-btn, .llm-disconnect-btn { width: 100%; text-align: center; }
    .llm-connected-detail { max-width: 140px; }
    .modal-container { height: 90vh; height: 90dvh; border-radius: 16px; }
    .modal-overlay { padding: 10px; }
  }
</style>
</head>
<body>
<div class="container">

  <div class="back-nav">
    <a href="/api/v1/user/${userId}${qs}" class="back-link">← Back to Profile</a>
  </div>

  <!-- Energy Status -->
  <div class="glass-card" style="animation-delay: 0.1s;">
    <h2>⚡ Energy</h2>
    <div class="energy-grid">
      <div class="energy-stat">
        <div class="energy-stat-label">Plan Energy</div>
        <div class="energy-stat-value">${energyAmount}</div>
        <div class="energy-stat-sub">Resets every 24 hours</div>
      </div>
      <div class="energy-stat plan-${profileType}">
        <div class="energy-stat-label">Current Plan</div>
        <div class="energy-stat-value" style="font-size: 22px; text-transform: capitalize;">${profileType}</div>
        ${!isBasic && planExpiresAt ? '<div class="energy-stat-sub">Expires ' + new Date(planExpiresAt).toLocaleDateString() + "</div>" : ""}
      </div>
      <div class="energy-stat">
        <div class="energy-stat-label">Additional Energy</div>
        <div class="energy-stat-value">${additionalEnergy}</div>
        <div class="energy-stat-sub">Used after plan energy</div>
      </div>
    </div>
  </div>

  <!-- Plans -->
  <div class="glass-card" style="animation-delay: 0.15s;">
    <h2>📋 Plans</h2>
    <div class="plan-grid">
      <div class="plan-box disabled" data-plan="basic">
        <div class="plan-name">Basic</div>
        <div class="plan-price">Free</div>
        <div class="plan-period">120 daily energy</div>
        <div class="plan-features">
          <div class="plan-feature">No file uploads</div>
          <div class="plan-feature dim">Limited access</div>
        </div>
        ${profileType === "basic" ? '<div class="plan-current-tag">Current Plan</div>' : ""}
      </div>
      <div class="plan-box" data-plan="standard">
        <div class="plan-name">Standard</div>
        <div class="plan-price">$20</div>
        <div class="plan-period">per 30 days</div>
        <div class="plan-features">
          <div class="plan-feature">500 daily energy</div>
          <div class="plan-feature">File uploads</div>
        </div>
        ${profileType === "standard" ? '<div class="plan-current-tag">Current Plan</div>' : ""}
      </div>
      <div class="plan-box" data-plan="premium">
        <div class="plan-name">Premium</div>
        <div class="plan-price">$100</div>
        <div class="plan-period">per 30 days</div>
        <div class="plan-features">
          <div class="plan-feature">2,000 daily energy</div>
          <div class="plan-feature">Full access</div>
          <div class="plan-feature highlight">Offline LLM processing</div>
        </div>
        ${profileType === "premium" || profileType === "god" ? '<div class="plan-current-tag">Current Plan</div>' : ""}
      </div>
    </div>
    <div class="plan-renew-note" id="planNote" style="display:none;"></div>
  </div>

  <!-- Buy Energy -->
  <div class="glass-card" style="animation-delay: 0.2s;">
    <h2>🔥 Additional Energy</h2>
    <div style="font-size: 14px; color: rgba(255,255,255,0.55); margin-bottom: 16px;">Reserve energy — only used when your plan energy runs out.</div>
    <div class="energy-btns" id="energyBtns">
      <button class="energy-buy-btn" data-amount="100">+100</button>
      <button class="energy-buy-btn" data-amount="500">+500</button>
      <button class="energy-buy-btn" data-amount="1000">+1000</button>
      <button class="energy-buy-btn" id="customEnergyBtn">+Custom</button>
    </div>
    <div id="energyAdded" style="margin-top: 14px; font-size: 14px; color: rgba(255,255,255,0.6); display: none;">
      Added: <strong id="energyAddedVal" style="color: white;"></strong>
      <span style="margin-left: 8px; cursor: pointer; opacity: 0.6;" onclick="resetEnergy()">✕ Clear</span>
    </div>
  </div>

  <!-- Checkout -->
  <div class="glass-card" style="animation-delay: 0.25s;">
    <h2>💳 Checkout</h2>
    <div id="checkoutContent">
      <div class="checkout-empty">Select a plan or add energy to continue</div>
    </div>
  </div>

  <!-- Custom LLM -->
  <div class="glass-card" style="animation-delay: 0.3s;">
    <h2>🤖 Custom LLM Endpoint</h2>
    <div class="llm-section-wrapper ${isBasic ? "locked" : ""}">
      <div class="llm-upgrade-overlay">
        <div class="llm-upgrade-text">🔒 Upgrade Required</div>
        <div class="llm-upgrade-sub">Custom LLM connections require a Standard or Premium plan</div>
      </div>
      <div class="llm-section-content">
        <div class="llm-sub">Connect your own OpenAI API-compatible LLM to use AI chat and bypass energy usage for conversations.</div>

        ${hasLlmConfig ? '<div class="llm-connected-badge" id="llmBadge" style="' + (llmRevoked ? "display:none;" : "") + '"><div class="llm-connected-dot"></div><span class="llm-connected-text">Connected</span><span class="llm-connected-detail">' + llmConn.model + " · " + llmConn.baseUrl + "</span></div>" : ""}

        ${hasLlmConfig ? '<div class="llm-toggle-row"><span class="llm-toggle-label">Custom LLM Active</span><div id="llmToggle" class="glass-toggle ' + (llmRevoked ? "" : "active") + '"><div class="glass-toggle-knob"></div></div></div>' : ""}

        <div class="llm-fields ${hasLlmConfig && llmRevoked ? "disabled" : ""}" id="llmFields">
          <div class="llm-field-row">
            <label class="llm-field-label">Endpoint URL</label>
            <input type="text" class="llm-input" id="llmBaseUrl"
              placeholder="https://api.groq.com/openai/v1/chat/completions"
              value="${hasLlmConfig ? llmConn.baseUrl : ""}" />
          </div>
          <div class="llm-field-row">
            <label class="llm-field-label">API Key</label>
            <input type="password" class="llm-input" id="llmApiKey"
              placeholder="${hasLlmConfig ? "••••••••  (saved — enter new to change)" : "gsk_abc123..."}" />
          </div>
          <div class="llm-field-row">
            <label class="llm-field-label">Model</label>
            <input type="text" class="llm-input" id="llmModel"
              placeholder="openai/gpt-oss-120b"
              value="${hasLlmConfig ? llmConn.model : ""}" />
          </div>
          <div class="llm-btn-row">
            <button class="llm-save-btn" onclick="saveLLM()">${hasLlmConfig ? "Update Connection" : "Save Connection"}</button>
            ${hasLlmConfig ? '<button class="llm-disconnect-btn" onclick="disconnectLLM()">Disconnect</button>' : ""}
          </div>
        </div>
        <div class="llm-status" id="llmStatus"></div>
      </div>
    </div>
  </div>

</div>

<!-- Terms Modal -->
<div class="modal-overlay" id="termsModal">
  <div class="modal-container">
    <div class="modal-header">
      <span class="modal-title">Terms of Service</span>
      <span class="modal-close" onclick="closeModal('terms')">✕</span>
    </div>
    <div class="modal-body">
      <iframe src="/terms" title="Terms of Service"></iframe>
    </div>
  </div>
</div>

<!-- Privacy Modal -->
<div class="modal-overlay" id="privacyModal">
  <div class="modal-container">
    <div class="modal-header">
      <span class="modal-title">Privacy Policy</span>
      <span class="modal-close" onclick="closeModal('privacy')">✕</span>
    </div>
    <div class="modal-body">
      <iframe src="/privacy" title="Privacy Policy"></iframe>
    </div>
  </div>
</div>

<script>
var userId = "${userId}";
var currentPlan = "${profileType === "god" ? "premium" : profileType}";
var PLAN_PRICE = { basic: 0, standard: 20, premium: 100 };
var PLAN_ORDER = ["basic", "standard", "premium"];
var ENERGY_RATE = 0.01;

var state = {
  energyAdded: 0,
  selectedPlan: null
};

// =====================
// MODAL
// =====================
function openModal(type) {
  var id = type === "terms" ? "termsModal" : "privacyModal";
  document.getElementById(id).classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeModal(type) {
  var id = type === "terms" ? "termsModal" : "privacyModal";
  document.getElementById(id).classList.remove("show");
  document.body.style.overflow = "";
}

document.querySelectorAll(".modal-overlay").forEach(function(overlay) {
  overlay.addEventListener("click", function(e) {
    if (e.target === overlay) {
      overlay.classList.remove("show");
      document.body.style.overflow = "";
    }
  });
});

document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.show").forEach(function(m) {
      m.classList.remove("show");
    });
    document.body.style.overflow = "";
  }
});

// =====================
// URL STATE
// =====================
function readURL() {
  var p = new URLSearchParams(location.search);
  if (p.get("energy")) state.energyAdded = parseInt(p.get("energy")) || 0;
  if (p.get("plan") && p.get("plan") !== currentPlan) {
    state.selectedPlan = p.get("plan");
  }
}

function writeURL() {
  var p = new URLSearchParams(location.search);
  p.delete("energy");
  p.delete("plan");
  if (!p.has("html")) p.set("html", "");
  if (state.energyAdded > 0) p.set("energy", state.energyAdded);
  if (state.selectedPlan) p.set("plan", state.selectedPlan);
  history.replaceState(null, "", "?" + p.toString());
}

// =====================
// PLAN LOGIC
// =====================
function canSelectPlan(plan) {
  if (plan === "basic") return false;
  var cur = PLAN_ORDER.indexOf(currentPlan);
  var next = PLAN_ORDER.indexOf(plan);
  return next >= cur;
}

function renderPlans() {
  document.querySelectorAll(".plan-box").forEach(function(box) {
    var plan = box.dataset.plan;
    var isSelected = state.selectedPlan === plan;
    var isCurrent = plan === currentPlan && !state.selectedPlan;

    box.classList.toggle("selected", isSelected);
    box.classList.toggle("current-plan", isCurrent);
    box.classList.toggle("disabled", !canSelectPlan(plan));
  });

  var note = document.getElementById("planNote");
  if (state.selectedPlan) {
    if (state.selectedPlan === currentPlan) {
      note.textContent = "Renewing " + state.selectedPlan + " for 30 more days";
    } else {
      note.textContent = "Upgrading to " + state.selectedPlan + " for 30 days";
    }
    note.style.display = "block";
  } else {
    note.style.display = "none";
  }
}

// =====================
// ENERGY
// =====================
function renderEnergy() {
  var el = document.getElementById("energyAdded");
  var val = document.getElementById("energyAddedVal");
  if (state.energyAdded > 0) {
    el.style.display = "block";
    val.textContent = "+" + state.energyAdded + " ($" + (state.energyAdded * ENERGY_RATE).toFixed(2) + ")";
  } else {
    el.style.display = "none";
  }
}

function resetEnergy() {
  state.energyAdded = 0;
  writeURL();
  renderEnergy();
  renderCheckout();
}

function removePlan() {
  state.selectedPlan = null;
  writeURL();
  renderPlans();
  renderCheckout();
}

// =====================
// CHECKOUT
// =====================
function renderCheckout() {
  var container = document.getElementById("checkoutContent");
  var energyCost = state.energyAdded * ENERGY_RATE;
  var planCost = state.selectedPlan ? (PLAN_PRICE[state.selectedPlan] || 0) : 0;
  var total = energyCost + planCost;

  if (total <= 0) {
    container.innerHTML = '<div class="checkout-empty">Select a plan or add energy to continue</div>';
    return;
  }

  var rows = "";

  if (state.selectedPlan) {
    var label = state.selectedPlan === currentPlan
      ? "Renew " + state.selectedPlan
      : "Upgrade to " + state.selectedPlan;
    var desc = state.selectedPlan === currentPlan
      ? "+30 days added to remaining time"
      : "30-day plan starts immediately";

    rows +=
      '<div class="checkout-row">' +
        '<div class="checkout-row-left">' +
          '<div class="checkout-row-icon plan-icon">📋</div>' +
          '<div class="checkout-row-info">' +
            '<div class="checkout-row-label">' + label + '</div>' +
            '<div class="checkout-row-desc">' + desc + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="checkout-row-right">' +
          '<div class="checkout-row-value">$' + planCost.toFixed(2) + '</div>' +
          '<span class="checkout-remove" onclick="removePlan()">✕</span>' +
        '</div>' +
      '</div>';
  }

  if (state.energyAdded > 0) {
    rows +=
      '<div class="checkout-row">' +
        '<div class="checkout-row-left">' +
          '<div class="checkout-row-icon energy-icon">🔥</div>' +
          '<div class="checkout-row-info">' +
            '<div class="checkout-row-label">+' + state.energyAdded + ' Additional Energy</div>' +
            '<div class="checkout-row-desc">Reserve — used after plan energy</div>' +
          '</div>' +
        '</div>' +
        '<div class="checkout-row-right">' +
          '<div class="checkout-row-value">$' + energyCost.toFixed(2) + '</div>' +
          '<span class="checkout-remove" onclick="resetEnergy()">✕</span>' +
        '</div>' +
      '</div>';
  }

  container.innerHTML =
    '<div class="checkout-summary">' +
      rows +
      '<div class="checkout-divider"></div>' +
      '<div class="checkout-total">' +
        '<div class="checkout-total-label">Total</div>' +
        '<div class="checkout-total-value">$' + total.toFixed(2) + '</div>' +
      '</div>' +
    '</div>' +
    '<button class="checkout-btn" onclick="handleCheckout()">Pay with Stripe</button>' +
    '<div class="checkout-legal">' +
      'By purchasing, you agree to our ' +
      '<span class="checkout-legal-link" onclick="openModal(\\'terms\\')">Terms of Service</span>' +
      ' and ' +
      '<span class="checkout-legal-link" onclick="openModal(\\'privacy\\')">Privacy Policy</span>.' +
    '</div>' +
    '<div class="checkout-note">No recurring charges · No refunds · Renew manually</div>';
}

// =====================
// STRIPE CHECKOUT
// =====================
async function handleCheckout() {
  var btn = document.querySelector(".checkout-btn");
  btn.disabled = true;
  btn.textContent = "Processing…";

  try {
    var body = {
      userId: userId,
      energyAmount: state.energyAdded > 0 ? state.energyAdded : 0,
      plan: state.selectedPlan || null,
      currentPlan: currentPlan,
    };

    var res = await fetch("/api/v1/user/" + userId + "/purchase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    var data = await res.json();

    if (data.url) {
      if (window.top !== window.self) {
        window.top.location.href = data.url;
      } else {
        window.location.href = data.url;
      }
    } else if (data.error) {
      alert(data.error);
      btn.disabled = false;
      btn.textContent = "Pay with Stripe";
    }
  } catch (err) {
    alert("Something went wrong. Please try again.");
    btn.disabled = false;
    btn.textContent = "Pay with Stripe";
  }
}

// =====================
// CUSTOM LLM
// =====================
function showLlmStatus(msg, ok) {
  var el = document.getElementById("llmStatus");
  el.style.display = "block";
  el.textContent = msg;
  el.style.color = ok ? "rgba(72, 187, 120, 0.9)" : "rgba(255, 107, 107, 0.9)";
  if (ok) setTimeout(function() { el.style.display = "none"; }, 3000);
}

async function saveLLM() {
  var baseUrl = document.getElementById("llmBaseUrl").value.trim();
  var apiKey = document.getElementById("llmApiKey").value.trim();
  var model = document.getElementById("llmModel").value.trim();

  if (!baseUrl || !model) {
    showLlmStatus("Endpoint URL and Model are required", false);
    return;
  }

  var isUpdate = ${hasLlmConfig ? "true" : "false"};
  if (!isUpdate && !apiKey) {
    showLlmStatus("API Key is required for new connections", false);
    return;
  }

  var payload = { baseUrl: baseUrl, model: model };
  if (apiKey) payload.apiKey = apiKey;

  try {
    var res = await fetch("/api/v1/user/" + userId + "/custom-llm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      showLlmStatus("✓ Connection saved", true);
      setTimeout(function() { location.reload(); }, 1200);
    } else {
      var data = await res.json().catch(function() { return {}; });
      showLlmStatus("✕ " + (data.error || "Failed to save"), false);
    }
  } catch (err) {
    showLlmStatus("✕ Network error", false);
  }
}

async function disconnectLLM() {
  if (!confirm("Disconnect your custom LLM? This will remove the saved connection.")) return;

  try {
    var res = await fetch("/api/v1/user/" + userId + "/custom-llm", {
      method: "DELETE",
    });

    if (res.ok) {
      showLlmStatus("✓ Disconnected", true);
      setTimeout(function() { location.reload(); }, 1000);
    } else {
      showLlmStatus("✕ Failed to disconnect", false);
    }
  } catch (err) {
    showLlmStatus("✕ Network error", false);
  }
}

async function toggleLLM(active) {
  var fields = document.getElementById("llmFields");
  var badge = document.getElementById("llmBadge");

  if (fields) fields.classList.toggle("disabled", !active);
  if (badge) badge.style.display = active ? "flex" : "none";

  try {
    var res = await fetch("/api/v1/user/" + userId + "/custom-llm/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revoked: !active })
    });

    if (res.ok) {
      showLlmStatus(active ? "✓ Custom LLM enabled" : "✓ Custom LLM paused", true);
    } else {
      showLlmStatus("✕ Failed to update", false);
      // Revert
      var toggle = document.getElementById("llmToggle");
      if (toggle) toggle.classList.toggle("active");
      if (fields) fields.classList.toggle("disabled");
      if (badge) badge.style.display = active ? "none" : "flex";
    }
  } catch (err) {
    showLlmStatus("✕ Network error", false);
    var toggle2 = document.getElementById("llmToggle");
    if (toggle2) toggle2.classList.toggle("active");
    if (fields) fields.classList.toggle("disabled");
    if (badge) badge.style.display = active ? "none" : "flex";
  }
}

// =====================
// EVENTS
// =====================
document.querySelectorAll(".plan-box").forEach(function(box) {
  box.onclick = function() {
    var plan = box.dataset.plan;
    if (!canSelectPlan(plan)) return;

    if (state.selectedPlan === plan) {
      state.selectedPlan = null;
    } else {
      state.selectedPlan = plan;
    }

    writeURL();
    renderPlans();
    renderCheckout();
  };
});

document.querySelectorAll(".energy-buy-btn:not(#customEnergyBtn)").forEach(function(btn) {
  btn.onclick = function() {
    state.energyAdded += parseInt(btn.dataset.amount);
    writeURL();
    renderEnergy();
    renderCheckout();
  };
});

document.getElementById("customEnergyBtn").onclick = function() {
  var val = parseInt(prompt("Enter energy amount:"));
  if (!val || val <= 0) return;
  state.energyAdded += val;
  writeURL();
  renderEnergy();
  renderCheckout();
};

// Glass toggle handler
var llmToggle = document.getElementById("llmToggle");
if (llmToggle) {
  llmToggle.onclick = function() {
    var isActive = llmToggle.classList.toggle("active");
    toggleLLM(isActive);
  };
}

// =====================
// INIT
// =====================
readURL();
renderPlans();
renderEnergy();
renderCheckout();
</script>
</body>
</html>`);
  } catch (err) {
    console.error("Energy page error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/user/:userId/purchase", authenticate, async (req, res) => {
  // normalize payload so your existing function works
  req.body.userId = req.params.userId;

  // 🔥 TEMP BLOCK

  //return createPurchaseSession(req, res);
});

// ─────────────────────────────────────────────────────────────────────────
// ENCRYPTION
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────

router.post("/user/:userId/custom-llm", authenticate, async (req, res) => {
  try {
    req.body.userId = req.params.userId;

    const { userId, baseUrl, apiKey, model } = req.body;

    if (!baseUrl || !apiKey || !model) {
      return res.status(400).json({
        error: "Missing required fields: baseUrl, apiKey, model",
      });
    }

    const result = await setCustomLlmConnection(userId, {
      baseUrl,
      apiKey,
      model,
    });

    return res.status(200).json({
      success: true,
      customLlmConnection: result,
    });
  } catch (err) {
    console.error("❌ Failed to save custom LLM:", err.message);
    return res.status(500).json({
      error: "Failed to save custom LLM connection",
    });
  }
});

router.delete("/user/:userId/custom-llm", authenticate, async (req, res) => {
  try {
    const userId = req.params.userId;

    await clearCustomLlmConnection(userId);

    return res.status(200).json({
      success: true,
      removed: true,
    });
  } catch (err) {
    console.error("❌ Failed to clear custom LLM:", err.message);
    return res.status(500).json({
      error: "Failed to remove custom LLM connection",
    });
  }
});

router.post(
  "/user/:userId/custom-llm/revoke",
  authenticate,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { revoked } = req.body;

      // basic validation
      if (typeof revoked !== "boolean") {
        return res.status(400).json({ error: "revoked must be boolean" });
      }

      const result = await setCustomLlmRevoked(userId, revoked);

      return res.json({
        success: true,
        revoked: result.revoked,
      });
    } catch (err) {
      console.error("❌ Failed to toggle custom LLM:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

router.get("/user/:userId/chats", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    const rawLimit = req.query.limit;
    let limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({ error: "Invalid limit" });
    }

    if (limit > 10) {
      limit = 10;
    }

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;
    let sessionId = req.query.sessionId;

    if (typeof sessionId === "string") {
      sessionId = sessionId.replace(/^"+|"+$/g, "");
    }
    const { sessions } = await getAIChats({
      userId,
      sessionLimit: limit || 10,
      sessionId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    const allChats = sessions.flatMap((s) => s.chats);

    if (!wantHtml) {
      return res.json({ userId, count: allChats.length, sessions });
    }

    const chats = allChats;

    const user = await User.findById(userId).lean();
    const username = user?.username || "Unknown user";

    const esc = (str = "") =>
      String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const truncate = (str, len = 200) => {
      if (!str) return "";
      const clean = esc(str);
      return clean.length > len ? clean.slice(0, len) + "…" : clean;
    };

    const formatTime = (d) => (d ? new Date(d).toLocaleString() : "—");

    const formatDuration = (start, end) => {
      if (!start || !end) return null;
      const ms = new Date(end) - new Date(start);
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
      return `${(ms / 60000).toFixed(1)}m`;
    };

    const modeLabel = (path) => {
      if (!path) return "unknown";
      const parts = path.split(":");
      const labels = {
        home: "🏠 Home",
        tree: "🌳 Tree",
      };
      const subLabels = {
        default: "Default",
        structure: "Structure",
        edit: "Edit",
        be: "Be",
        reflect: "Reflect",
        navigate: "Navigate",
        understand: "Understand",
      };
      const big = labels[parts[0]] || parts[0];
      const sub = subLabels[parts[1]] || parts[1] || "";
      return sub ? `${big} → ${sub}` : big;
    };

    const sourceLabel = (src) => {
      const map = {
        user: "👤 User",
        orchestrator: "🤖 Orchestrator",
        subtask: "📋 Subtask",
        system: "⚙️ System",
      };
      return map[src] || src;
    };

    const actionLabel = (action) => {
      const map = {
        create: "Created",
        editStatus: "Status",
        editValue: "Values",
        prestige: "Prestige",
        trade: "Trade",
        delete: "Deleted",
        invite: "Invite",
        editSchedule: "Schedule",
        editGoal: "Goal",
        transaction: "Transaction",
        note: "Note",
        updateParent: "Moved",
        editScript: "Script",
        executeScript: "Ran script",
        updateChildNode: "Child",
        editNameNode: "Renamed",
        rawIdea: "Raw idea",
        branchLifecycle: "Branch",
        purchase: "Purchase",
        understanding: "Understanding",
      };
      return map[action] || action;
    };

    const actionColor = (action) => {
      switch (action) {
        case "create":
          return "#48bb78";
        case "delete":
        case "branchLifecycle":
          return "#c85050";
        case "editStatus":
        case "editValue":
        case "editGoal":
        case "editSchedule":
        case "editNameNode":
        case "editScript":
          return "#5082dc";
        case "executeScript":
          return "#38bdd2";
        case "prestige":
          return "#c8aa32";
        case "note":
        case "rawIdea":
          return "#9b64dc";
        case "invite":
          return "#d264a0";
        case "transaction":
        case "trade":
          return "#dc8c3c";
        case "purchase":
          return "#34be82";
        case "updateParent":
        case "updateChildNode":
          return "#3caab4";
        case "understanding":
          return "#6464d2";
        default:
          return "#736fe6";
      }
    };

    const sessionGroups = sessions;

    const renderChat = (chat) => {
      const duration = formatDuration(
        chat.startMessage?.time,
        chat.endMessage?.time,
      );
      const stopped = chat.endMessage?.stopped;
      const contribs = chat.contributions || [];
      const hasContribs = contribs.length > 0;

      const isCustomLlm = chat.llmProvider?.isCustom === true;
      const modelName = chat.llmProvider?.model || "default";

      const statusBadge = stopped
        ? `<span class="badge badge-stopped">Stopped</span>`
        : chat.endMessage?.time
          ? `<span class="badge badge-done">Done</span>`
          : `<span class="badge badge-pending">Pending</span>`;

      const energyBadge = isCustomLlm
        ? `<span class="badge badge-external">External</span>`
        : `<span class="badge badge-energy">⚡2</span>`;

      const contribRows = contribs
        .map((c) => {
          const nId = c.nodeId?._id || c.nodeId;
          const nName = c.nodeId?.name || nId || "—";
          const nodeRef = nId
            ? `<a href="/api/v1/node/${nId}${tokenQS}">${esc(nName)}</a>`
            : `<span style="opacity:0.5">—</span>`;
          const aiBadge = c.wasAi
            ? `<span class="mini-badge mini-ai">AI</span>`
            : "";
          const cEnergyBadge =
            c.energyUsed > 0
              ? `<span class="mini-badge mini-energy">⚡${c.energyUsed}</span>`
              : "";
          const color = actionColor(c.action);

          return `
          <tr class="contrib-row">
            <td><span class="action-dot" style="background:${color}"></span>${esc(actionLabel(c.action))}</td>
            <td>${nodeRef}</td>
            <td>${aiBadge}${cEnergyBadge}</td>
            <td class="contrib-time">${formatTime(c.date)}</td>
          </tr>`;
        })
        .join("");

      return `
      <li class="note-card">
        <div class="chat-header">
          <div class="chat-header-left">
            <span class="chat-mode">${modeLabel(chat.aiContext?.path)}</span>
            <span class="chat-model">${esc(modelName)}</span>
          </div>
          <div class="chat-badges">
            ${energyBadge}
            ${statusBadge}
            ${duration ? `<span class="badge badge-duration">${duration}</span>` : ""}
            <span class="badge badge-source">${sourceLabel(chat.startMessage?.source)}</span>
          </div>
        </div>

        <div class="note-content">
          <div class="chat-message chat-user">
            <span class="msg-label">You</span>
            <div class="msg-text">${truncate(chat.startMessage?.content, 400)}</div>
          </div>
          ${
            chat.endMessage?.content
              ? `
          <div class="chat-message chat-ai">
            <span class="msg-label">AI</span>
            <div class="msg-text">${truncate(chat.endMessage.content, 400)}</div>
          </div>`
              : ""
          }
        </div>

        ${
          hasContribs
            ? `
        <details class="contrib-dropdown">
          <summary class="contrib-summary">
            ${contribs.length} contribution${contribs.length !== 1 ? "s" : ""} during this chat
          </summary>
          <div class="contrib-table-wrap">
            <table class="contrib-table">
              <thead>
                <tr><th>Action</th><th>Node</th><th></th><th>Time</th></tr>
              </thead>
              <tbody>${contribRows}</tbody>
            </table>
          </div>
        </details>`
            : ""
        }

        <div class="note-meta">
          ${formatTime(chat.startMessage?.time)}
          <span class="meta-separator">·</span>
          <code class="contribution-id">${esc(chat._id)}</code>
        </div>
      </li>`;
    };

    const renderedSections = sessionGroups
      .map((group) => {
        const chatCount = group.chatCount;
        const sessionTime = formatTime(group.startTime);
        const shortId = group.sessionId.slice(0, 8);

        const chatCards = group.chats.map(renderChat).join("");

        return `
      <div class="session-group">
        <div class="session-pane">
          <div class="session-pane-header">
            <div class="session-header-left">
              <span class="session-id">${esc(shortId)}</span>
              <span class="session-info">${chatCount} chat${chatCount !== 1 ? "s" : ""}</span>
            </div>
            <span class="session-time">${sessionTime}</span>
          </div>
          <ul class="notes-list">${chatCards}</ul>
        </div>
      </div>`;
      })
      .join("");

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${esc(username)} — AI Chats</title>
  <style>
:root {
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

body::before,
body::after {
  content: '';
  position: fixed;
  border-radius: 50%;
  opacity: 0.08;
  animation: float 20s infinite ease-in-out;
  pointer-events: none;
}

body::before {
  width: 600px; height: 600px;
  background: white;
  top: -300px; right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px; height: 400px;
  background: white;
  bottom: -200px; left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-30px) rotate(5deg); }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* ── Glass Back Nav ─────────────────────────────── */

.back-nav {
  display: flex; gap: 12px;
  margin-bottom: 20px; flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out;
}

.back-link {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 20px;
  background: rgba(115, 111, 230, var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  color: white; text-decoration: none;
  border-radius: 980px; font-weight: 600; font-size: 14px;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 8px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28);
  position: relative; overflow: hidden;
}

.back-link::before {
  content: ""; position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0; transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1);
  pointer-events: none;
}

.back-link:hover {
  background: rgba(115, 111, 230, var(--glass-alpha-hover));
  transform: translateY(-1px);
}

.back-link:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

/* ── Glass Header ───────────────────────────────── */

.header {
  position: relative; overflow: hidden;
  background: rgba(115, 111, 230, var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px; padding: 32px; margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28);
  color: white;
  animation: fadeInUp 0.6s ease-out 0.1s both;
}

.header::before {
  content: ""; position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0; transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1);
  pointer-events: none;
}

.header:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

.header h1 {
  font-size: 28px; font-weight: 600; color: white;
  margin-bottom: 8px; line-height: 1.3; letter-spacing: -0.5px;
  text-shadow: 0 2px 8px rgba(0,0,0,0.2);
}

.header h1 a {
  color: white; text-decoration: none;
  border-bottom: 1px solid rgba(255,255,255,0.3);
  transition: all 0.2s;
}

.header h1 a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255,255,255,0.8);
}

.message-count {
  display: inline-block; padding: 6px 14px;
  background: rgba(255,255,255,0.25); color: white;
  border-radius: 980px; font-size: 14px; font-weight: 600;
  margin-left: 12px; border: 1px solid rgba(255,255,255,0.3);
}

.header-subtitle {
  font-size: 14px; color: rgba(255,255,255,0.9);
  margin-bottom: 8px; font-weight: 400; line-height: 1.5;
}

/* ── Session Pane with Header ───────────────────── */

.session-group {
  margin-bottom: 20px;
  animation: fadeInUp 0.6s ease-out both;
}

.session-pane {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 20px;
  overflow: hidden;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.session-pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: rgba(255,255,255,0.08);
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.session-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.session-id {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11px;
  font-weight: 600;
  color: rgba(255,255,255,0.55);
  background: rgba(255,255,255,0.1);
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.12);
}

.session-info {
  font-size: 13px;
  color: rgba(255,255,255,0.7);
  font-weight: 600;
}

.session-time {
  font-size: 12px;
  color: rgba(255,255,255,0.4);
  font-weight: 500;
}

/* ── Glass Cards ────────────────────────────────── */

.notes-list {
  list-style: none;
  display: flex; flex-direction: column; gap: 16px;
  padding: 16px;
}

.note-card {
  --card-rgb: 115, 111, 230;
  position: relative;
  background: rgba(var(--card-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px; padding: 24px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28);
  transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
  color: white; overflow: hidden;
  opacity: 0; transform: translateY(30px);
}

.note-card.visible {
  animation: fadeInUp 0.6s cubic-bezier(0.4,0,0.2,1) forwards;
}

.note-card::before {
  content: ""; position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0; transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1);
  pointer-events: none;
}

.note-card:hover {
  background: rgba(var(--card-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(0,0,0,0.18);
}

.note-card:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

/* ── Chat Header Row ────────────────────────────── */

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 8px;
}

.chat-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chat-mode {
  font-size: 11px;
  font-weight: 600;
  color: rgba(255,255,255,0.7);
  background: rgba(255,255,255,0.1);
  padding: 3px 10px;
  border-radius: 980px;
  border: 1px solid rgba(255,255,255,0.15);
}

.chat-model {
  font-size: 11px;
  font-weight: 500;
  color: rgba(255,255,255,0.45);
  font-family: 'SF Mono', 'Fira Code', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.chat-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

/* ── Messages ───────────────────────────────────── */

.note-content {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chat-message {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.msg-label {
  flex-shrink: 0;
  font-weight: 700;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 3px 10px;
  border-radius: 980px;
  margin-top: 3px;
}

.chat-user .msg-label { background: rgba(255,255,255,0.2); color: white; }
.chat-ai .msg-label   { background: rgba(100,220,255,0.25); color: white; }

.msg-text {
  color: rgba(255,255,255,0.95);
  word-wrap: break-word;
  min-width: 0;
  font-size: 15px;
  line-height: 1.65;
  font-weight: 400;
}

.chat-user .msg-text {
  font-weight: 500;
}

/* ── Contribution Dropdown ──────────────────────── */

.contrib-dropdown { margin-bottom: 12px; }

.contrib-summary {
  cursor: pointer; font-size: 13px; font-weight: 600;
  color: rgba(255,255,255,0.85); padding: 8px 14px;
  background: rgba(255,255,255,0.1); border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.15);
  transition: all 0.2s; list-style: none;
  display: flex; align-items: center; gap: 6px;
}

.contrib-summary::-webkit-details-marker { display: none; }

.contrib-summary::before {
  content: "▶"; font-size: 10px;
  transition: transform 0.2s; display: inline-block;
}

details[open] .contrib-summary::before { transform: rotate(90deg); }

.contrib-summary:hover { background: rgba(255,255,255,0.18); }

.contrib-table-wrap {
  margin-top: 10px; overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.contrib-table { width: 100%; border-collapse: collapse; font-size: 13px; }

.contrib-table thead th {
  text-align: left; font-size: 11px; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.5px;
  color: rgba(255,255,255,0.55); padding: 6px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.15);
}

.contrib-row td {
  padding: 7px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.88); vertical-align: middle;
  white-space: nowrap;
}

.contrib-row:last-child td { border-bottom: none; }

.contrib-row a {
  color: white; text-decoration: none;
  border-bottom: 1px solid rgba(255,255,255,0.3);
  transition: all 0.2s;
}

.contrib-row a:hover {
  border-bottom-color: white;
  text-shadow: 0 0 12px rgba(255,255,255,0.8);
}

.contrib-time { font-size: 11px; color: rgba(255,255,255,0.5); }

.action-dot {
  display: inline-block; width: 8px; height: 8px;
  border-radius: 50%; margin-right: 6px; vertical-align: middle;
}

/* ── Mini Badges ────────────────────────────────── */

.mini-badge {
  display: inline-flex; align-items: center;
  padding: 1px 7px; border-radius: 980px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.2px;
  margin-right: 3px;
}

.mini-ai    { background: rgba(255,200,50,0.35); color: #fff; }
.mini-energy { background: rgba(100,220,255,0.3); color: #fff; }

/* ── Badges ─────────────────────────────────────── */

.badge {
  display: inline-flex; align-items: center;
  padding: 3px 10px; border-radius: 980px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.3px;
  border: 1px solid rgba(255,255,255,0.2);
}

.badge-done     { background: rgba(72,187,120,0.35); color: #fff; }
.badge-stopped  { background: rgba(200,80,80,0.35); color: #fff; }
.badge-pending  { background: rgba(255,200,50,0.3); color: #fff; }
.badge-duration { background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.9); }
.badge-source   { background: rgba(100,100,210,0.3); color: #fff; }
.badge-energy   { background: rgba(100,220,255,0.25); color: #fff; border-color: rgba(100,220,255,0.3); }
.badge-external { background: rgba(168,85,247,0.25); color: #fff; border-color: rgba(168,85,247,0.3); }

/* ── Note Meta ──────────────────────────────────── */

.note-meta {
  padding-top: 12px;
  border-top: 1px solid rgba(255,255,255,0.2);
  font-size: 12px; color: rgba(255,255,255,0.85);
  line-height: 1.8;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
}

.meta-separator { color: rgba(255,255,255,0.5); }

.contribution-id {
  background: rgba(255,255,255,0.12);
  padding: 2px 6px; border-radius: 4px;
  font-size: 11px; font-family: 'SF Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.6);
  border: 1px solid rgba(255,255,255,0.1);
}

/* ── Empty State ────────────────────────────────── */

.empty-state {
  position: relative; overflow: hidden;
  background: rgba(115, 111, 230, var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px; padding: 60px 40px; text-align: center;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28); color: white;
}

.empty-state::before {
  content: ""; position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0; transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1);
  pointer-events: none;
}

.empty-state:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

.empty-state-icon { font-size: 64px; margin-bottom: 16px; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.2)); }
.empty-state-text { font-size: 20px; color: white; margin-bottom: 8px; font-weight: 600; text-shadow: 0 2px 8px rgba(0,0,0,0.2); }
.empty-state-subtext { font-size: 14px; color: rgba(255,255,255,0.85); }

/* ── Responsive ─────────────────────────────────── */

@media (max-width: 640px) {
  body { padding: 16px; }
  .header { padding: 24px 20px; }
  .header h1 { font-size: 24px; }
  .message-count { display: block; margin-left: 0; margin-top: 8px; width: fit-content; }
  .note-card { padding: 20px 16px; }
  .back-nav { flex-direction: column; }
  .back-link { width: 100%; justify-content: center; }
  .empty-state { padding: 40px 24px; }
  .chat-header { flex-direction: column; align-items: flex-start; }
  .contrib-row td { font-size: 12px; padding: 5px 6px; }
  .session-pane-header { flex-direction: column; align-items: flex-start; gap: 6px; padding: 12px 16px; }
  .notes-list { padding: 12px; gap: 12px; }
  .chat-model { max-width: 140px; }
  .msg-text { font-size: 14px; }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container { max-width: 700px; }
}
  </style>
</head>
<body>
  <div class="container">
    <div class="back-nav">
      <a href="/api/v1/user/${userId}${tokenQS}" class="back-link">← Back to Profile</a>
    </div>

    <div class="header">
      <h1>
        AI Chats for
        <a href="/api/v1/user/${userId}${tokenQS}">@${esc(username)}</a>
        ${chats.length > 0 ? `<span class="message-count">${chats.length}</span>` : ""}
      </h1>
      <div class="header-subtitle">Your last 10 AI conversation sessions</div>
    </div>

    ${
      sessionGroups.length
        ? renderedSections
        : `
    <div class="empty-state">
      <div class="empty-state-icon">💬</div>
      <div class="empty-state-text">No AI chats yet</div>
      <div class="empty-state-subtext">AI conversations and their actions will appear here</div>
    </div>`
    }
  </div>

  <script>
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry, index) {
        if (entry.isIntersecting) {
          setTimeout(function() { entry.target.classList.add('visible'); }, index * 50);
          observer.unobserve(entry.target);
        }
      });
    }, { root: null, rootMargin: '50px', threshold: 0.1 });
    document.querySelectorAll('.note-card').forEach(function(card) { observer.observe(card); });
  </script>
</body>
</html>
`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


export default router;
