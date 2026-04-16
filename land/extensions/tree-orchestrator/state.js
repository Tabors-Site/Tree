// TreeOS Tree Orchestrator . state.js
// All visitor-scoped state Maps and their accessors.
// No business logic. No execution. Pure state management.
//
// Internal pipeline code should use the ctx object, NOT getActiveRequest.
// getActiveRequest is exported only for external consumers (misroute).

import Node from "../../seed/models/node.js";

// ─────────────────────────────────────────────────────────────────────────
// PATH CACHE (30s TTL)
// ─────────────────────────────────────────────────────────────────────────

const _pathCache = new Map();
const PATH_TTL = 30000;

export async function buildCurrentPath(nodeId) {
  const cached = _pathCache.get(String(nodeId));
  if (cached && Date.now() - cached.ts < PATH_TTL) return cached.path;

  const parts = [];
  let current = await Node.findById(nodeId).select("name parent rootOwner").lean();
  let depth = 0;
  while (current && depth < 20) {
    parts.unshift(current.name || String(current._id));
    if (current.rootOwner || !current.parent) break;
    current = await Node.findById(current.parent).select("name parent rootOwner").lean();
    depth++;
  }
  const path = "/" + parts.join("/");

  _pathCache.set(String(nodeId), { path, ts: Date.now() });
  if (_pathCache.size > 500) {
    const oldest = [..._pathCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < 100; i++) _pathCache.delete(oldest[i][0]);
  }
  return path;
}

// ─────────────────────────────────────────────────────────────────────────
// INTELLIGENCE BRIEF CACHE (60s TTL)
// ─────────────────────────────────────────────────────────────────────────

const briefCache = new Map();
const BRIEF_TTL = 60000;
const BRIEF_CACHE_MAX = 100;

export async function getIntelligenceBrief(rootId, userId) {
  const cached = briefCache.get(rootId);
  if (cached && Date.now() - cached.timestamp < BRIEF_TTL) return cached.brief;

  const brief = await buildIntelligenceBrief(rootId, userId);

  if (briefCache.size >= BRIEF_CACHE_MAX && !briefCache.has(rootId)) {
    const oldest = briefCache.keys().next().value;
    briefCache.delete(oldest);
  }
  briefCache.set(rootId, { brief, timestamp: Date.now() });
  return brief;
}

async function buildIntelligenceBrief(rootId, userId) {
  let getExtension;
  try {
    ({ getExtension } = await import("../loader.js"));
  } catch { return null; }

  const sections = [];

  try {
    const comp = getExtension("competence");
    if (comp?.exports?.getCompetence) {
      const data = await comp.exports.getCompetence(rootId);
      if (data?.totalQueries >= 10) {
        const strong = (data.strongTopics || []).slice(0, 5).join(", ");
        const weak = (data.weakTopics || []).slice(0, 5).join(", ");
        if (strong || weak) {
          sections.push(`Competence: answers well on [${strong || "unknown"}]. Weak on [${weak || "unknown"}]. Answer rate: ${Math.round((data.answerRate || 0) * 100)}%.`);
        }
      }
    }
  } catch {}

  try {
    const exp = getExtension("explore");
    if (exp?.exports?.getExploreMap) {
      const map = await exp.exports.getExploreMap(rootId);
      if (map && map.confidence > 0) {
        const findings = (map.map || []).slice(0, 3).map(f => f.nodeName || f.nodeId).join(", ");
        const gaps = (map.gaps || []).slice(0, 2).join("; ");
        sections.push(`Explored: ${map.coverage} coverage, ${map.nodesExplored} nodes checked. Key areas: ${findings || "none"}.${gaps ? " Gaps: " + gaps : ""}`);
      }
    }
  } catch {}

  try {
    const con = getExtension("contradiction");
    if (con?.exports?.getUnresolved) {
      const unresolved = await con.exports.getUnresolved(rootId);
      if (Array.isArray(unresolved) && unresolved.length > 0) {
        const top = unresolved.slice(0, 2).map(c => `"${c.claim}" vs "${c.conflictsWith}"`).join("; ");
        sections.push(`Contradictions: ${unresolved.length} unresolved. ${top}`);
      }
    }
  } catch {}

  try {
    const pur = getExtension("purpose");
    if (pur) {
      const root = await Node.findById(rootId).select("metadata").lean();
      const meta = root?.metadata instanceof Map ? root.metadata.get("purpose") : root?.metadata?.purpose;
      if (meta?.thesis) {
        const coherence = meta.recentCoherence != null ? ` Coherence: ${Math.round(meta.recentCoherence * 100)}%.` : "";
        sections.push(`Purpose: "${meta.thesis}"${coherence}`);
      }
    }
  } catch {}

  try {
    const evo = getExtension("evolution");
    if (evo?.exports?.getDormant) {
      const dormant = await evo.exports.getDormant(rootId);
      if (Array.isArray(dormant) && dormant.length > 0) {
        const names = dormant.slice(0, 3).map(d => d.name || d.nodeName).join(", ");
        sections.push(`Dormant: ${dormant.length} branch${dormant.length > 1 ? "es" : ""}. ${names}.`);
      }
    }
  } catch {}

  try {
    const rem = getExtension("remember");
    if (rem) {
      const root = await Node.findById(rootId).select("metadata").lean();
      const meta = root?.metadata instanceof Map ? root.metadata.get("remember") : root?.metadata?.remember;
      if (meta?.departed?.length > 0) {
        const recent = meta.departed.slice(-3).map(d => `${d.name} (${d.note})`).join("; ");
        sections.push(`Departed: ${recent}`);
      }
    }
  } catch {}

  if (sections.length === 0) return null;
  return "Intelligence:\n" + sections.map(s => "  " + s).join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// CONVERSATION MEMORY (survives mode switches, 10-turn ring per visitor)
// ─────────────────────────────────────────────────────────────────────────

const orchestratorMemory = new Map();
const MAX_MEMORY_TURNS = 10;

export function getMemory(visitorId) {
  return orchestratorMemory.get(visitorId) || [];
}

export function pushMemory(visitorId, userMessage, assistantResponse) {
  const mem = getMemory(visitorId);
  mem.push(
    { role: "user", content: userMessage },
    { role: "assistant", content: assistantResponse },
  );
  while (mem.length > MAX_MEMORY_TURNS) mem.shift();
  orchestratorMemory.set(visitorId, mem);
}

export function clearMemory(visitorId) {
  orchestratorMemory.delete(visitorId);
}

export function formatMemoryContext(visitorId) {
  const mem = getMemory(visitorId);
  if (mem.length === 0) return "";
  const lines = mem.map((m) =>
    m.role === "user" ? `User: ${m.content}` : `Assistant: ${m.content}`,
  );
  return `\n\nRecent conversation:\n${lines.join("\n")}`;
}

// ─────────────────────────────────────────────────────────────────────────
// PRONOUN STATE (visitor-scoped reference resolution)
// ─────────────────────────────────────────────────────────────────────────

const _pronounState = new Map();

export function getPronounState(visitorId) {
  return _pronounState.get(visitorId) || { active: null, lastMod: null, lastNoun: null, lastMode: null, lastMessage: null };
}

export function updatePronounState(visitorId, updates) {
  const current = getPronounState(visitorId);
  _pronounState.set(visitorId, { ...current, ...updates });
}

// ─────────────────────────────────────────────────────────────────────────
// LAST ROUTING (ring buffer for misroute detection)
// ─────────────────────────────────────────────────────────────────────────

const _lastRouting = new Map();
const LAST_ROUTING_RING = 3;

export function recordRoutingDecision(visitorId, decision) {
  if (!visitorId || !decision) return;
  const existing = _lastRouting.get(visitorId) || [];
  existing.unshift({ ...decision, ts: Date.now() });
  while (existing.length > LAST_ROUTING_RING) existing.pop();
  _lastRouting.set(visitorId, existing);
}

export function getLastRouting(visitorId) {
  const ring = _lastRouting.get(visitorId);
  return ring?.[0] || null;
}

export function getLastRoutingRing(visitorId) {
  return _lastRouting.get(visitorId) || [];
}

export function clearLastRouting(visitorId) {
  _lastRouting.delete(visitorId);
}

// ─────────────────────────────────────────────────────────────────────────
// ACTIVE REQUESTS (external consumers ONLY, e.g. misroute extension)
// Internal pipeline uses the ctx object passed as function params.
// ─────────────────────────────────────────────────────────────────────────

const _activeRequests = new Map();
const ACTIVE_REQUEST_TTL_MS = 30 * 1000;

export function setActiveRequest(visitorId, ctx) {
  if (!visitorId) return;
  _activeRequests.set(visitorId, { ...ctx, _ts: Date.now() });
}

export function getActiveRequest(visitorId) {
  if (!visitorId) return null;
  const entry = _activeRequests.get(visitorId);
  if (!entry) return null;
  if (Date.now() - entry._ts > ACTIVE_REQUEST_TTL_MS) {
    _activeRequests.delete(visitorId);
    return null;
  }
  return entry;
}
