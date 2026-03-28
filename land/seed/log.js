// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Core Log Module
 *
 * Three severity levels:
 *   1 (info)    - Essential land lifecycle: boot, connect, online, shutdown
 *   2 (verbose) - Extension loading, session events, mode switches, jobs
 *   3 (debug)   - Individual LLM calls, hook fires, contribution logs, tool calls
 *
 * Default level: 2 (verbose). Set LOG_LEVEL env or change at runtime.
 *
 * The console extension can override the formatter for colors, prefixes, etc.
 * Without the extension, output goes to console.log/warn/error as plain text.
 */

let currentLevel = parseInt(process.env.LOG_LEVEL, 10) || 2;
let formatter = null; // Set by console extension if loaded
const jsonMode = process.env.LOG_FORMAT === "json";

/**
 * Structured JSON log line. Used when LOG_FORMAT=json.
 * Outputs one JSON object per line for log aggregation (ELK, Datadog, etc.).
 */
function jsonLog(stream, level, tag, message, args) {
  const entry = { ts: new Date().toISOString(), level, tag, msg: message };
  if (args.length > 0) {
    entry.data = args.length === 1 ? args[0] : args;
  }
  stream.call(console, JSON.stringify(entry));
}

/**
 * Set the log level at runtime. 1 = quiet, 2 = normal, 3 = everything.
 */
export function setLogLevel(level) {
  currentLevel = Math.max(1, Math.min(3, level));
}

export function getLogLevel() {
  return currentLevel;
}

/**
 * Set a custom formatter. Called by the console extension during init().
 * Formatter receives (level, tag, message, ...args) and handles output.
 * Return true to suppress default output.
 */
export function setFormatter(fn) {
  formatter = fn;
}

/**
 * Log at info level (1). Always shown unless LOG_LEVEL=0.
 * Land lifecycle, boot, connect, online, errors.
 */
export function info(tag, message, ...args) {
  if (currentLevel < 1) return;
  if (formatter && formatter(1, tag, message, ...args)) return;
  if (jsonMode) return jsonLog(console.log, "info", tag, message, args);
  console.log(`[${tag}] ${message}`, ...args);
}

/**
 * Log at verbose level (2). Shown at LOG_LEVEL >= 2.
 * Extensions, sessions, mode switches, jobs, hooks.
 */
export function verbose(tag, message, ...args) {
  if (currentLevel < 2) return;
  if (formatter && formatter(2, tag, message, ...args)) return;
  if (jsonMode) return jsonLog(console.log, "verbose", tag, message, args);
  console.log(`[${tag}] ${message}`, ...args);
}

/**
 * Log at debug level (3). Shown at LOG_LEVEL >= 3.
 * LLM calls, tool execution, contribution details.
 */
export function debug(tag, message, ...args) {
  if (currentLevel < 3) return;
  if (formatter && formatter(3, tag, message, ...args)) return;
  if (jsonMode) return jsonLog(console.log, "debug", tag, message, args);
  console.log(`[${tag}] ${message}`, ...args);
}

/**
 * Warning. Always shown. Something unexpected but recoverable.
 */
export function warn(tag, message, ...args) {
  if (formatter && formatter("warn", tag, message, ...args)) return;
  if (jsonMode) return jsonLog(console.warn, "warn", tag, message, args);
  console.warn(`[${tag}] ${message}`, ...args);
}

/**
 * Error. Always shown. Something broke.
 */
export function error(tag, message, ...args) {
  if (formatter && formatter("error", tag, message, ...args)) return;
  if (jsonMode) return jsonLog(console.error, "error", tag, message, args);
  console.error(`[${tag}] ${message}`, ...args);
}

export default { info, verbose, debug, warn, error, setLogLevel, getLogLevel, setFormatter };
