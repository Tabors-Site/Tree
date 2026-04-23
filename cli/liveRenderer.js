// TreeOS CLI . liveRenderer.js
//
// Render the progress events coming off runConversational() into the
// terminal as they arrive. One function in, one line out. The renderer
// is stateful only insofar as it keeps a spinner frame counter and
// tracks the last thinking chunk so duplicates collapse.

const chalk = require("chalk");

// Truncate a single line so the terminal doesn't wrap. Preserves the
// leading symbol and trailing ellipsis so meaning stays clear.
function oneLine(text, max = 180) {
  if (!text) return "";
  const flat = String(text).replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1) + "…";
}

function formatArgs(args) {
  if (!args || typeof args !== "object") return "";
  for (const key of ["filePath", "path", "name", "query", "command", "action"]) {
    if (args[key] && typeof args[key] !== "object") {
      const v = String(args[key]);
      return v.length > 60 ? v.slice(0, 57) + "…" : v;
    }
  }
  const keys = Object.keys(args).filter(
    (k) => !["userId", "rootId", "nodeId", "chatId", "sessionId"].includes(k),
  );
  return keys.length ? keys.slice(0, 3).join(",") : "";
}

/**
 * Build a renderer bound to the process stdout (or a caller-provided
 * stream). Returns `onProgress(event)` and a `finish()` that clears
 * any in-flight visual state.
 */
function createLiveRenderer({ stream = process.stdout, verbose = false } = {}) {
  let lastModeKey = null;
  let lastThinkingKey = null;
  let firstEventSeen = false;

  function line(str) {
    stream.write(str + "\n");
  }

  function onProgress(ev) {
    if (!ev || !ev.type) return;

    if (!firstEventSeen) {
      firstEventSeen = true;
      // Clear the initial "Thinking..." spinner line in the caller.
    }

    switch (ev.type) {
      case "modeSwitched": {
        const mode = ev.mode || ev.modeKey || ev.to || "?";
        if (mode !== lastModeKey) {
          line(chalk.cyan("↪ ") + chalk.bold(mode));
          lastModeKey = mode;
        }
        return;
      }
      case "orchestratorStep": {
        // Show only the mode header when first crossed; the full JSON
        // is too noisy for the terminal. In verbose mode, dump it.
        const mode = ev.modeKey || "?";

        // Special-case the classifier step: surface the chosen intent,
        // target mode, and confidence inline. This is the moment the
        // tree orchestrator decides "extension: code-workspace mode
        // tree:code-plan conf=0.96" — the user wants to see that, not
        // just "↪ intent" with the details hidden behind --verbose.
        if (mode === "intent") {
          let parsed = ev.result;
          if (typeof parsed === "string") {
            try { parsed = JSON.parse(parsed); } catch { parsed = null; }
          }
          if (parsed && typeof parsed === "object") {
            const intent = parsed.intent || "?";
            const conf = typeof parsed.confidence === "number" ? ` conf=${parsed.confidence.toFixed(2)}` : "";
            const targetMode = parsed.mode ? ` → ${parsed.mode}` : "";
            const summary = parsed.summary ? chalk.dim(` — ${oneLine(parsed.summary, 80)}`) : "";
            line(chalk.cyan("🎯 ") + chalk.bold(intent) + chalk.dim(targetMode + conf) + summary);
            lastModeKey = mode;
            return;
          }
        }

        if (mode !== lastModeKey) {
          line(chalk.cyan("↪ ") + chalk.bold(mode));
          lastModeKey = mode;
        }
        if (verbose && ev.result) {
          line(chalk.dim("  " + oneLine(typeof ev.result === "string" ? ev.result : JSON.stringify(ev.result), 240)));
        }
        return;
      }
      case "executionStatus": {
        const phase = ev.phase || "";
        const text = ev.text || "";
        if (!text && (phase === "intent" || phase === "done")) return;
        line(chalk.dim("· " + (text || phase)));
        return;
      }
      case "thinking": {
        const text = oneLine(ev.text, 200);
        if (!text) return;
        const key = text.slice(0, 60);
        if (key === lastThinkingKey) return;
        lastThinkingKey = key;
        line(chalk.magenta("… ") + chalk.dim(text));
        return;
      }
      case "messageQueued": {
        // Stream extension ACK: a mid-flight message was absorbed into
        // the running turn and will be injected at the next tool-loop
        // checkpoint. Distinct symbol from ↪/↻/✓ so it doesn't look
        // like a mode switch or tool result.
        const snippet = oneLine(ev.message, 80);
        line(chalk.magenta("↺ ") + chalk.dim("merged mid-flight") + (snippet ? chalk.dim(" — " + snippet) : ""));
        return;
      }
      case "toolCalled": {
        const name = ev.tool || "?";
        const hint = formatArgs(ev.args);
        line(chalk.yellow("  · ") + chalk.bold(name) + (hint ? chalk.dim(" (" + hint + ")") : ""));
        return;
      }
      case "toolResult": {
        const name = ev.tool || "?";
        const ok = ev.success !== false && !ev.error;
        if (ok) {
          // Short preview of what the tool returned so the user sees
          // progress even when the model chains tool calls with no
          // prose between them. First non-empty line, clipped.
          let preview = "";
          if (typeof ev.result === "string" && ev.result.trim()) {
            const firstLine = ev.result.split("\n").find((l) => l.trim()) || "";
            preview = oneLine(firstLine, 120);
          }
          if (preview) {
            line(chalk.green("  ✓ ") + chalk.dim(name) + chalk.dim(" — " + preview));
          } else {
            line(chalk.green("  ✓ ") + chalk.dim(name));
          }
        } else {
          const errTxt = oneLine(ev.error || "failed", 160);
          line(chalk.red("  ✗ ") + chalk.dim(name) + (errTxt ? " " + chalk.red(errTxt) : ""));
        }
        return;
      }
      case "swarmDispatch": {
        const count = ev.count || (ev.branches?.length || 0);
        const labels = (ev.branches || []).map((b) => b.name).filter(Boolean);
        const label = labels.length
          ? labels.slice(0, 6).join(", ") + (labels.length > 6 ? ` +${labels.length - 6}` : "")
          : "";
        line(chalk.blue("⎇ swarm: ") + chalk.bold(`${count} branch${count === 1 ? "" : "es"}`) + (label ? chalk.dim(` [${label}]`) : ""));
        return;
      }
      case "branchStarted": {
        const name = ev.name || "?";
        const pos = ev.index != null && ev.total != null ? `${ev.index}/${ev.total}` : "";
        line(chalk.blue("  ▶ ") + chalk.bold(name) + (pos ? chalk.dim(" " + pos) : ""));
        return;
      }
      case "branchCompleted": {
        const name = ev.name || "?";
        const st = ev.status || "done";
        if (st === "done") {
          line(chalk.green("  ✓ ") + chalk.dim("branch ") + chalk.bold(name));
        } else {
          const err = oneLine(ev.error || st, 140);
          line(chalk.red("  ✗ ") + chalk.dim("branch ") + chalk.bold(name) + (err ? " " + chalk.red(err) : ""));
        }
        return;
      }

      // ── Plan-first swarm events ────────────────────────────────
      case "swarmPlanProposed":
      case "swarmPlanUpdated": {
        const isUpdate = ev.type === "swarmPlanUpdated";
        const version = ev.version != null ? `v${ev.version}` : "";
        const branchList = Array.isArray(ev.branches) ? ev.branches : [];
        const count = branchList.length;
        const header = isUpdate ? "Updated plan" : "Proposed plan";
        const title = chalk.blue("⎇ ") + chalk.bold(header) + (version ? chalk.dim(" " + version) : "") +
          chalk.dim(`  ${count} branch${count === 1 ? "" : "es"}`);
        line(title);
        if (isUpdate && ev.trigger) {
          line(chalk.dim("    ↪ " + oneLine(ev.trigger, 120)));
        }
        for (const b of branchList) {
          const name = chalk.bold(b.name || "?");
          const path = b.path ? chalk.dim(` · path: ${b.path}`) : "";
          const files = Array.isArray(b.files) && b.files.length
            ? chalk.dim(" · files: " + oneLine(b.files.join(", "), 80))
            : "";
          const mode = b.mode ? chalk.dim(` · ${b.mode}`) : "";
          line("    " + name + path + mode + files);
          if (b.spec) {
            line(chalk.dim("      " + oneLine(b.spec, 140)));
          }
        }
        line(chalk.dim('Reply "yes" to run, or describe what to change. "cancel" to drop.'));
        return;
      }
      case "swarmPlanArchived": {
        const count = ev.branchCount != null ? `${ev.branchCount} branch${ev.branchCount === 1 ? "" : "es"}` : "a plan";
        const reason = ev.reason ? ` (${ev.reason})` : "";
        line(chalk.gray("📦 archived plan: ") + chalk.dim(count + reason));
        return;
      }

      // ── Scout phase events ───────────────────────────────────────
      case "swarmScoutsDispatched": {
        const cycle = ev.cycle != null ? ` (cycle ${ev.cycle})` : "";
        const n = ev.branchCount != null ? `${ev.branchCount} branch${ev.branchCount === 1 ? "" : "es"}` : "project";
        line(chalk.magenta("🔍 dispatching scouts") + chalk.dim(cycle + " over " + n + "…"));
        return;
      }
      case "swarmScoutReport": {
        const branch = ev.branch || "?";
        const detail = oneLine(ev.detail || "(no detail)", 180);
        const counter = ev.counterpartBranch ? chalk.dim(` ↔ ${ev.counterpartBranch}`) : "";
        line(chalk.yellow("  ⚠ ") + chalk.bold(branch) + counter + chalk.dim(": " + detail));
        return;
      }
      case "swarmIssuesRouted": {
        const cycle = ev.cycle != null ? `cycle ${ev.cycle} · ` : "";
        if (!ev.total) {
          line(chalk.green("  ✓ ") + chalk.dim(cycle + "no mismatches found"));
        } else {
          const affected = Array.isArray(ev.affectedBranches) && ev.affectedBranches.length
            ? ` → ${ev.affectedBranches.slice(0, 6).join(", ")}${ev.affectedBranches.length > 6 ? " +" + (ev.affectedBranches.length - 6) : ""}`
            : "";
          line(chalk.blue("  📬 routing ") + chalk.bold(`${ev.total} issue${ev.total === 1 ? "" : "s"}`) + chalk.dim(affected));
        }
        return;
      }
      case "swarmRedeploying": {
        const cycle = ev.cycle != null ? ` (cycle ${ev.cycle + 1})` : "";
        const names = Array.isArray(ev.branches) ? ev.branches.join(", ") : "";
        line(chalk.cyan("  🔧 redeploying") + chalk.dim(cycle + ": ") + chalk.bold(names));
        return;
      }
      case "swarmReconciled": {
        const cycles = ev.cycles != null ? `${ev.cycles} cycle${ev.cycles === 1 ? "" : "s"}` : "";
        const status = ev.status || "done";
        const total = ev.totalIssues != null ? `, ${ev.totalIssues} issue${ev.totalIssues === 1 ? "" : "s"}` : "";
        const color = status === "clean" ? chalk.green
          : status === "stuck" ? chalk.yellow
          : status === "capped" ? chalk.yellow
          : chalk.dim;
        line(color("✓ swarm reconciled") + chalk.dim(` (${status}${cycles ? ` · ${cycles}` : ""}${total})`));
        return;
      }

      default:
        if (verbose) line(chalk.dim("[" + ev.type + "]"));
    }
  }

  function finish() {
    // No in-flight spinner in the current design; stays a no-op for now.
  }

  return { onProgress, finish };
}

module.exports = { createLiveRenderer };
