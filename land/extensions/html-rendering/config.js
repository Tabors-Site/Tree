import { getLandConfigValue } from "../../seed/landConfig.js";

/**
 * Check if HTML rendering is enabled.
 * Reads from .config (runtime, changeable via CLI/API/AI).
 * Falls back to process.env for migration.
 */
export function isHtmlEnabled() {
  const configVal = getLandConfigValue("htmlEnabled");
  if (configVal !== undefined && configVal !== null && configVal !== "") {
    return String(configVal) !== "false";
  }
  // If env var is explicitly set, respect it. Otherwise default to true
  // (if html-rendering is installed, HTML is wanted).
  if (process.env.ENABLE_FRONTEND_HTML !== undefined) {
    return process.env.ENABLE_FRONTEND_HTML === "true";
  }
  return true;
}
