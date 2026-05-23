// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// My voice in the host realm.
//
// The reality's inner beings speak to each other through SUMMONs. I
// speak to the operator outside the reality through this module. Three
// severity levels:
//
//   1 (info)    reality lifecycle: boot, connect, online, shutdown
//   2 (verbose) extension loading, sessions, jobs, mode switches
//   3 (debug)   per-LLM-call, per-tool-call, per-hook noise
//
// Default level is 2 (verbose). Set LOG_LEVEL env or call
// setLogLevel() to change at runtime. The console extension may
// register a formatter for color and prefixes; without it, output
// goes to console.log / warn / error as plain text. JSON mode for
// log aggregators (LOG_FORMAT=json) emits one JSON object per line.

let currentLevel = parseInt(process.env.LOG_LEVEL, 10) || 2;
let formatter = null;
const jsonMode = process.env.LOG_FORMAT === "json";

function jsonLog(stream, level, tag, message, args) {
  const entry = { ts: new Date().toISOString(), level, tag, msg: message };
  if (args.length > 0) {
    entry.data = args.length === 1 ? args[0] : args;
  }
  stream.call(console, JSON.stringify(entry));
}

export function setLogLevel(level) {
  currentLevel = Math.max(1, Math.min(3, level));
}

export function getLogLevel() {
  return currentLevel;
}

// Set by the console extension during init. Receives (level, tag,
// message, ...args) and returns true to suppress the default output.
export function setFormatter(fn) {
  formatter = fn;
}

export function info(tag, message, ...args) {
  if (currentLevel < 1) return;
  if (formatter && formatter(1, tag, message, ...args)) return;
  if (jsonMode) return jsonLog(console.log, "info", tag, message, args);
  console.log(`[${tag}] ${message}`, ...args);
}

export function verbose(tag, message, ...args) {
  if (currentLevel < 2) return;
  if (formatter && formatter(2, tag, message, ...args)) return;
  if (jsonMode) return jsonLog(console.log, "verbose", tag, message, args);
  console.log(`[${tag}] ${message}`, ...args);
}

export function debug(tag, message, ...args) {
  if (currentLevel < 3) return;
  if (formatter && formatter(3, tag, message, ...args)) return;
  if (jsonMode) return jsonLog(console.log, "debug", tag, message, args);
  console.log(`[${tag}] ${message}`, ...args);
}

// warn and error are always shown. Level gating does not apply.
export function warn(tag, message, ...args) {
  if (formatter && formatter("warn", tag, message, ...args)) return;
  if (jsonMode) return jsonLog(console.warn, "warn", tag, message, args);
  console.warn(`[${tag}] ${message}`, ...args);
}

export function error(tag, message, ...args) {
  if (formatter && formatter("error", tag, message, ...args)) return;
  if (jsonMode) return jsonLog(console.error, "error", tag, message, args);
  console.error(`[${tag}] ${message}`, ...args);
}

// Namespaced logger bound to a single tag, so call sites are one
// argument shorter:
//
//   const elog = createLogger("CodeWorkspace");
//   elog.info("something happened");
//   elog.trace("workspace-add-file", "OK", "path=foo.js bytes=123");
//   // prints [CodeWorkspace] workspace-add-file OK: path=foo.js bytes=123
//
// `trace` is the three-arg "action / tag / detail" shape used for
// tool / branch / hook event noise that benefits from a consistent
// format across modules. Not a new severity level; just an info line.
export function createLogger(ns) {
  return {
    info:    (msg, ...args) => info(ns, msg, ...args),
    verbose: (msg, ...args) => verbose(ns, msg, ...args),
    debug:   (msg, ...args) => debug(ns, msg, ...args),
    warn:    (msg, ...args) => warn(ns, msg, ...args),
    error:   (msg, ...args) => error(ns, msg, ...args),
    trace:   (action, tag, detail) => info(ns, `${action} ${tag}: ${detail ?? ""}`),
  };
}

export default { info, verbose, debug, warn, error, setLogLevel, getLogLevel, setFormatter, createLogger };
