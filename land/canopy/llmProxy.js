import { signCanopyToken } from "./identity.js";
import { getPeerByDomain, getPeerBaseUrl } from "./peers.js";

const UNREACHABLE_STATUSES = new Set(["blocked", "dead", "unreachable"]);

/**
 * Create an OpenAI-compatible proxy client that routes LLM calls
 * through a remote user's home land.
 *
 * The home land resolves the user's actual LLM connection, runs inference,
 * and deducts energy. Tool execution stays local on the calling land.
 */
export function createCanopyLlmProxyClient({ userId, homeLand, slot }) {
  return {
    _isCanopyProxy: true,
    chat: {
      completions: {
        async create(params, opts) {
          // Bail immediately if caller already aborted
          if (opts?.signal?.aborted) {
            throw new Error("LLM proxy request aborted");
          }

          const peer = await getPeerByDomain(homeLand);
          if (!peer || UNREACHABLE_STATUSES.has(peer.status)) {
            throw new Error(
              !peer
                ? "Home land not found as peer: " + homeLand
                : "Home land status is " + peer.status + ": " + homeLand
            );
          }

          const token = await signCanopyToken(userId, homeLand);
          const baseUrl = getPeerBaseUrl(peer);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 120000);

          // Forward caller's abort signal
          if (opts?.signal) {
            opts.signal.addEventListener("abort", () => controller.abort());
          }

          console.log("[Canopy] LLM proxy call to %s for user %s (slot: %s)", homeLand, userId, slot || "main");

          try {
            const res = await fetch(baseUrl + "/canopy/llm/proxy", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "CanopyToken " + token,
              },
              body: JSON.stringify({
                messages: params.messages,
                model: params.model,
                tools: params.tools,
                tool_choice: params.tool_choice,
                slot: slot || "main",
              }),
              signal: controller.signal,
            });

            if (!res.ok) {
              // Try to parse JSON error, fall back to status text
              let message;
              try {
                const errData = await res.json();
                message = errData.message || errData.error || res.statusText;
              } catch {
                message = "HTTP " + res.status + ": " + res.statusText;
              }
              throw new Error("LLM proxy failed: " + message);
            }

            const data = await res.json();

            if (!data.success) {
              throw new Error(
                data.error === "no_llm"
                  ? "No LLM connection configured on home land"
                  : data.message || "LLM proxy request failed"
              );
            }

            return data.completion;
          } finally {
            clearTimeout(timeout);
          }
        },
      },
    },
  };
}
