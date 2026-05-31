// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ssrf.js — network safety for LLM connection base URLs.
//
// Every base URL operators (or extensions) hand to addLlmConnection
// passes through here. The point is keeping a misconfigured or
// hostile URL from reaching internal services (cloud metadata, local
// admin panels, the place's own loopback). We block:
//
//   - localhost / 0.0.0.0 / ::1 by hostname
//   - this reality's own URL (so an LLM connection can't ping our
//     own admin surface)
//   - cloud-provider metadata endpoints (169.254.169.254 et al.)
//   - private IP ranges (RFC 1918, link-local, CGNAT, unique-local,
//     IPv6 link-local, ULA)
//   - URLs with embedded credentials, non-http(s) protocols
//
// Opt-in path: `allowedLlmDomains` in reality config. Hosts on that
// list bypass the SSRF gate — that's how an operator stands up
// Ollama on the LAN or a self-hosted LLM gateway. Without that
// opt-in, the gate stays closed.
//
// DNS is resolved at validation time, not at call time, so a host
// that resolves to a private IP today can't be approved with a
// promise to "use only public addresses later." If the host's
// resolution changes after the connection is created, the moment-
// time call still hits the resolved IP and any subsequent re-
// validate would catch a regression.

import dns from "dns/promises";
import { getInternalConfigValue } from "../../../internalConfig.js";
import { getRealityConfigValue } from "../../../realityConfig.js";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "0.0.0.0",
  "[::1]",
  "metadata.google.internal",
  "169.254.169.254",
  "metadata.internal",
]);

// Add this reality's own hostname to the block list at module load
// so a misconfigured LLM connection can't ping our admin surface.
try {
  const realityUrl = getRealityConfigValue("realityUrl");
  if (realityUrl) BLOCKED_HOSTS.add(new URL(realityUrl).hostname);
} catch {}

const BLOCKED_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./,
  /^198\.18\./,
  /^198\.19\./,
  /^fc/i,
  /^fe80/i,
  /^::1$/,
  /^::$/,
];

function isBlockedIp(ip) {
  return BLOCKED_IP_PATTERNS.some((p) => p.test(ip));
}

/**
 * Resolve a hostname and refuse if any A/AAAA record points at a
 * private/internal IP. Plain-IP hostnames check the IP directly.
 * DNS has a hard 5-second deadline; a hang here would block
 * connection setup indefinitely.
 */
export async function resolveAndValidateHost(hostname) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error("URL points to a private/internal IP");
    }
    return;
  }

  try {
    const result = await Promise.race([
      dns.lookup(hostname, { all: true }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("DNS lookup timed out")),
          Number(getInternalConfigValue("dnsLookupTimeout")) || 5000,
        ),
      ),
    ]);
    for (const entry of result) {
      if (isBlockedIp(entry.address)) {
        throw new Error("URL resolves to a private/internal IP");
      }
    }
  } catch (err) {
    if (err.message.includes("private") || err.message.includes("internal")) {
      throw err;
    }
    throw new Error(
      "Could not resolve hostname: " +
        hostname +
        (err.message.includes("timed out") ? " (DNS timeout)" : ""),
    );
  }
}

/**
 * Is this hostname (or any superdomain of it) on the place's
 * `allowedLlmDomains` config list? Returns false when the list is
 * absent or empty — without an explicit opt-in, no host gets the
 * SSRF bypass.
 */
export function hostInAllowedLlmDomains(hostname) {
  const allowed = getRealityConfigValue("allowedLlmDomains");
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.some((d) => {
    const low = d.toLowerCase();
    return hostname === low || hostname.endsWith("." + low);
  });
}

/**
 * Validate an LLM connection's base URL. Returns the canonicalized
 * URL (no trailing slash) on success; throws otherwise.
 *
 *   - protocol must be http(s)
 *   - no embedded credentials
 *   - host on `allowedLlmDomains` → bypass everything else
 *   - blocked hostnames refuse
 *   - private/internal IPs refuse (without allowedLlmDomains opt-in)
 *   - when allowedLlmDomains is set, any host NOT on it refuses
 *
 * Note: this is the SYNCHRONOUS validation. The async DNS resolution
 * check (`resolveAndValidateHost`) runs separately in the CRUD path
 * so the connection setup can refuse late-bound private IPs.
 */
export function validateBaseUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Invalid base URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("URLs with credentials are not allowed");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostInAllowedLlmDomains(hostname)) {
    return parsed.href.replace(/\/+$/, "");
  }
  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error("This base URL is not allowed");
  }
  if (isBlockedIp(hostname)) {
    throw new Error(
      "Local/private network URLs are not allowed. Add the host to " +
        "`allowedLlmDomains` in place config to opt in (e.g. for Ollama " +
        "or a LAN-hosted LLM).",
    );
  }
  const allowed = getRealityConfigValue("allowedLlmDomains");
  if (Array.isArray(allowed) && allowed.length > 0) {
    throw new Error(
      `LLM domain "${hostname}" is not in this reality's allowed list.`,
    );
  }
  return parsed.href.replace(/\/+$/, "");
}
