/**
 * Check if a hostname resolves to a private/internal IP range.
 * Used to prevent SSRF in peer registration and heartbeat redirects.
 */
export function isPrivateHost(hostname) {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|fc|fd|fe80|::1|localhost)/i.test(hostname);
}
