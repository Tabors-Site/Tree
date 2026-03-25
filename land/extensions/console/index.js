import { setFormatter, setLogLevel, getLogLevel } from "../../seed/log.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const WHITE = "\x1b[37m";

function timestamp() {
  const d = new Date();
  return `${DIM}${d.toLocaleTimeString()}${RESET}`;
}

function formatTag(tag) {
  return `${CYAN}${tag}${RESET}`;
}

function formatter(level, tag, message, ...args) {
  const ts = timestamp();
  const tagStr = formatTag(tag);

  if (level === "error") {
    console.error(`${ts} ${RED}ERR${RESET} ${tagStr} ${message}`, ...args);
    return true;
  }

  if (level === "warn") {
    console.warn(`${ts} ${YELLOW}WRN${RESET} ${tagStr} ${message}`, ...args);
    return true;
  }

  if (level === 1) {
    console.log(`${ts} ${GREEN}${BOLD}${tag}${RESET} ${WHITE}${message}${RESET}`, ...args);
    return true;
  }

  if (level === 2) {
    console.log(`${ts} ${tagStr} ${message}`, ...args);
    return true;
  }

  if (level === 3) {
    console.log(`${ts} ${DIM}${tag} ${message}${RESET}`, ...args);
    return true;
  }

  return false;
}

const router = express.Router();

router.post("/land/log-level", authenticate, async (req, res) => {
  try {
    const level = parseInt(req.body.level, 10);
    if (isNaN(level) || level < 1 || level > 3) {
      return sendError(res, 400, ERR.INVALID_INPUT, "Level must be 1, 2, or 3");
    }
    setLogLevel(level);
    sendOk(res, { level: getLogLevel(), labels: { 1: "info", 2: "verbose", 3: "debug" } });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

router.get("/land/log-level", authenticate, async (req, res) => {
  sendOk(res, { level: getLogLevel(), labels: { 1: "info", 2: "verbose", 3: "debug" } });
});

export async function init(core) {
  setFormatter(formatter);

  const level = parseInt(process.env.LOG_LEVEL, 10);
  if (!isNaN(level)) setLogLevel(level);

  return { router };
}
