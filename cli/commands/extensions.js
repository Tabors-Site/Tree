const chalk = require("chalk");
const fetch = require("node-fetch");
const { requireAuth, load, save, currentNodeId } = require("../config");
const { getApi } = require("../helpers");

async function refreshProtocolCache(nodeId) {
  try {
    const cfg = load();
    if (!cfg.landUrl) return;
    let url = cfg.landUrl;
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    // Pass nodeId for position-aware protocol. Without it, returns everything.
    const nid = nodeId || currentNodeId(cfg);
    const qs = nid ? `?nodeId=${encodeURIComponent(nid)}` : "";
    const res = await fetch(`${url}/api/v1/protocol${qs}`);
    if (res.ok) {
      const raw = await res.json();
      cfg.landProtocol = raw.data || raw;
      save(cfg);
    }
  } catch {}
}

function printSearchResults(data, query) {
  if (!data.extensions || data.extensions.length === 0) {
    console.log(chalk.dim(query ? `No extensions found for "${query}"` : "Registry is empty."));
    return;
  }
  console.log(chalk.bold(`Registry (${data.total} extensions)\n`));
  for (const ext of data.extensions) {
    const tags = ext.tags?.length ? chalk.dim(` [${ext.tags.join(", ")}]`) : "";
    const dl = ext.downloads ? chalk.dim(` ${ext.downloads} downloads`) : "";
    console.log(`  ${chalk.cyan(ext.name)} ${chalk.dim("v" + ext.version)}${tags}${dl}`);
    console.log(`  ${chalk.dim(ext.description || "")}`);
    if (ext.authorDomain) console.log(`  ${chalk.dim("by " + ext.authorDomain)}`);
    console.log();
  }
}

module.exports = (program) => {
  const ext = program
    .command("ext")
    .description("Manage land extensions")
    .addHelpText("after", `
Examples:
  ext search               List all extensions in registry
  ext search ai -l 10      Search by keyword, limit 10
  ext view understanding    Full details from registry
  ext install understanding Install from registry
  ext update understanding  Update to latest version
  ext list                  Show loaded extensions on this land
    `)
    .action((args) => {
      if (args?.args?.length) {
        console.log(chalk.red(`Unknown ext command: ${args.args[0]}`));
      }
      ext.outputHelp();
    });

  ext
    .command("list")
    .alias("ls")
    .description("List all loaded extensions")
    .action(async () => {
      try {
        const api = getApi(requireAuth());
        const data = await api.getExtensions();

        if (!data.loaded || data.loaded.length === 0) {
          console.log(chalk.dim("No extensions loaded."));
          return;
        }

        console.log(chalk.bold(`Extensions (${data.count} loaded)\n`));

        // Compact list: name, version, badges. Full description via `ext info <name>`.
        const maxName = Math.max(...data.loaded.map(e => e.name.length), 8);
        for (const ext of data.loaded) {
          const parts = [];
          if (ext.provides.routes) parts.push("routes");
          if (ext.provides.tools) parts.push("tools");
          if (ext.provides.jobs) parts.push("jobs");
          if (ext.provides.models.length) parts.push(`${ext.provides.models.length} models`);

          const badges = parts.length ? chalk.dim(` ${parts.join(", ")}`) : "";
          const name = ext.name.padEnd(maxName);
          // First sentence or first 80 chars of description
          const short = ext.description
            ? ext.description.split(/\.\s/)[0].slice(0, 80) + (ext.description.length > 80 ? "..." : "")
            : "";
          console.log(`  ${chalk.cyan(name)}  ${chalk.dim("v" + ext.version)}${badges}`);
          if (short) console.log(`  ${"".padEnd(maxName)}  ${chalk.dim(short)}`);
        }

        if (data.disabled && data.disabled.length > 0) {
          console.log(chalk.bold("Disabled:\n"));
          for (const d of data.disabled) {
            const name = typeof d === "string" ? d : d.name;
            console.log(`  ${chalk.dim(name)} ${chalk.red("(disabled)")}`);
          }
          console.log();
        }
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("info [name...]")
    .description("Show details for an extension")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: ext info <name>. Run 'ext list' to see loaded extensions."));
      const name = parts.join("-");
      try {
        const api = getApi(requireAuth());
        const data = await api.getExtension(name);

        if (!data.manifest) {
          console.log(chalk.red(`Extension "${name}" not found. Run 'ext list' to see available extensions.`));
          return;
        }

        const m = data.manifest;
        const statusLabel = data.status === "disabled" ? chalk.red(" (disabled)") : chalk.green(" (active)");
        console.log(chalk.bold(m.name), chalk.dim("v" + m.version) + statusLabel);
        if (m.description) console.log(m.description);
        console.log();

        if (m.needs) {
          console.log(chalk.bold("Requires:"));
          if (m.needs.services?.length) console.log(`  services: ${m.needs.services.join(", ")}`);
          if (m.needs.models?.length) console.log(`  models: ${m.needs.models.join(", ")}`);
          if (m.needs.extensions?.length) console.log(`  extensions: ${m.needs.extensions.join(", ")}`);
          console.log();
        }

        if (m.optional?.services?.length || m.optional?.extensions?.length) {
          console.log(chalk.bold("Optional:"));
          if (m.optional.services?.length) console.log(`  services: ${m.optional.services.join(", ")}`);
          if (m.optional.extensions?.length) console.log(`  extensions: ${m.optional.extensions.join(", ")}`);
          console.log();
        }

        if (m.provides) {
          console.log(chalk.bold("Provides:"));
          if (m.provides.routes) console.log("  routes");
          if (m.provides.tools) console.log("  tools");
          if (m.provides.modes) console.log("  modes");
          if (m.provides.jobs) console.log("  jobs");
          if (m.provides.models && Object.keys(m.provides.models).length) {
            console.log(`  models: ${Object.keys(m.provides.models).join(", ")}`);
          }
          if (m.provides.energyActions && Object.keys(m.provides.energyActions).length) {
            console.log(`  energy actions: ${Object.keys(m.provides.energyActions).join(", ")}`);
          }
          if (m.provides.sessionTypes && Object.keys(m.provides.sessionTypes).length) {
            console.log(`  session types: ${Object.keys(m.provides.sessionTypes).join(", ")}`);
          }
          if (m.provides.cli?.length) {
            console.log(chalk.bold("\nCLI Commands:"));
            for (const cmd of m.provides.cli) {
              console.log(`  ${chalk.cyan(cmd.command)} ${chalk.dim(cmd.description || "")}`);
            }
          }
          if (m.provides.env?.length) {
            console.log(chalk.bold("\nRequired env vars:"));
            for (const e of m.provides.env) {
              const envDecl = typeof e === "string" ? { key: e } : e;
              const req = envDecl.required === false ? chalk.dim(" (optional)") : "";
              console.log(`  ${chalk.yellow(envDecl.key)}${req}`);
              if (envDecl.description) console.log(`    ${chalk.dim(envDecl.description)}`);
            }
          }
        }
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("search [query...]")
    .description("Search the extension registry. No login required.")
    .option("-l, --limit [n]", "Max results (default 50)")
    .option("-t, --tag [tag]", "Filter by tag")
    .action(async (parts, opts) => {
      const query = parts ? parts.join(" ") : "";
      try {
        const horizonUrl = "https://horizon.treeos.ai";
        const params = new URLSearchParams();
        if (query) params.set("q", query);
        if (opts.limit) params.set("limit", opts.limit);
        if (opts.tag) params.set("tag", opts.tag);
        const qs = params.toString() ? `?${params}` : "";
        const res = await fetch(`${horizonUrl}/extensions${qs}`, {
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error(`Registry unavailable (${res.status})`);
        const data = await res.json();
        const exts = data.extensions || data || [];
        if (!exts.length) return console.log(chalk.dim("  (no results)"));
        for (const ext of exts) {
          const tags = (ext.tags || []).slice(0, 3).map(t => chalk.dim(`#${t}`)).join(" ");
          const dl = ext.downloads ? chalk.dim(` ${ext.downloads} dl`) : "";
          console.log(`  ${chalk.cyan(ext.name)} ${chalk.dim("v" + ext.version)}${dl}${tags ? "  " + tags : ""}`);
          if (ext.description) console.log(`    ${chalk.dim(ext.description)}`);
        }
        console.log(chalk.dim(`\n  ${exts.length} result(s)`));
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("view [name...]")
    .description("View full details of a registry extension (files, manifest, readme)")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: ext view <name> [version]"));
      const name = parts[0];
      const version = parts[1] || null;
      try {
        const horizonUrl = "https://horizon.treeos.ai";
        const vPath = version ? `/${version}` : "";
        const res = await fetch(`${horizonUrl}/extensions/${encodeURIComponent(name)}${vPath}`);
        if (!res.ok) return console.log(chalk.red(`"${name}" not found in registry.`));
        const data = await res.json();
        const ext = version ? data : data.latest;
        if (!ext) return console.log(chalk.red("Not found."));

        console.log(chalk.bold(ext.name) + " " + chalk.dim("v" + ext.version));
        if (ext.description) console.log(ext.description);
        console.log(chalk.dim(`by ${ext.authorName || ext.authorDomain || "unknown"}, ${ext.downloads || 0} downloads`));
        console.log();

        const m = ext.manifest || {};
        if (m.needs) {
          console.log(chalk.bold("Requires:"));
          if (m.needs.models?.length) console.log(`  models: ${m.needs.models.join(", ")}`);
          if (m.needs.services?.length) console.log(`  services: ${m.needs.services.join(", ")}`);
          if (m.needs.extensions?.length) console.log(`  extensions: ${m.needs.extensions.join(", ")}`);
        }
        if (m.npm?.length) {
          console.log(chalk.bold("npm packages:"), m.npm.join(", "));
        }
        if (m.provides?.cli?.length) {
          console.log(chalk.bold("\nCLI Commands:"));
          for (const cmd of m.provides.cli) {
            console.log(`  ${chalk.cyan(cmd.command)} ${chalk.dim(cmd.description || "")}`);
          }
        }
        if (ext.files?.length) {
          console.log(chalk.bold("\nFiles:"));
          for (const f of ext.files) {
            const lines = (f.content || "").split("\n").length;
            console.log(`  ${chalk.dim(f.path)} (${lines} lines)`);
          }
        }
        if (ext.readme) {
          console.log(chalk.bold("\nReadme:"));
          console.log(chalk.dim(ext.readme.slice(0, 500)));
          if (ext.readme.length > 500) console.log(chalk.dim("  ..."));
        }

        // Show versions if available
        if (data.versions?.length > 1) {
          console.log(chalk.bold("\nVersions:"));
          for (const v of data.versions.slice(0, 10)) {
            console.log(`  ${chalk.dim(v.version)}  ${chalk.dim(v.publishedAt ? new Date(v.publishedAt).toLocaleDateString() : "")}`);
          }
        }

        console.log(chalk.dim(`\ntreeos ext install ${name}`));
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("install [name...]")
    .description("Install an extension from the registry")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: ext install <name> [version]. Run 'ext search' to find extensions."));
      const name = parts[0];
      const version = parts[1] || null;
      try {
        const api = getApi(requireAuth());
        console.log(chalk.dim(`Fetching ${name}${version ? "@" + version : ""} from registry...`));
        const data = await api.installExtension(name, version);
        console.log(chalk.green(`Installed: ${name} v${data.version || "?"}`));
        console.log(chalk.dim(`${data.filesWritten} files written.`));

        // Check if this extension needs other extensions
        if (data.needs?.extensions?.length > 0) {
          const protocol = await api.get("/protocol");
          const loaded = new Set(protocol?.extensions || []);
          const missing = data.needs.extensions.filter(dep => !loaded.has(dep));
          if (missing.length > 0) {
            console.log(chalk.yellow(`\nRequires: ${missing.join(", ")}`));
            let allResolved = true;
            for (const dep of missing) {
              console.log(chalk.dim(`  Installing ${dep}...`));
              try {
                const depData = await api.installExtension(dep);
                console.log(chalk.green(`  Installed: ${dep} v${depData.version || "?"}`));
              } catch (depErr) {
                console.log(chalk.red(`  Failed to install ${dep}: ${depErr.message}`));
                allResolved = false;
              }
            }
            if (!allResolved) {
              console.log(chalk.red(`\nUninstalling ${name}. Required dependencies could not be installed.`));
              try { await api.uninstallExtension(name); } catch {}
              return;
            }
          }
        }

        console.log(chalk.dim("Restart the land to load it."));
        await refreshProtocolCache();
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("update [name...]")
    .description("Update an installed extension to the latest version from the registry")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: ext update <name>. Updates to latest version from registry."));
      const name = parts.join("-");
      try {
        const api = getApi(requireAuth());

        // Get current installed version
        const protocol = await api.get("/protocol");
        const manifests = await api.get("/land/extensions");
        const installed = manifests?.extensions?.find(e => e.name === name);
        if (!installed) return console.log(chalk.red(`"${name}" is not installed.`));

        const currentVersion = installed.version || installed.manifest?.version;

        // Check registry for latest
        console.log(chalk.dim(`Checking registry for ${name}...`));
        let registry;
        try {
          const horizonUrl = await api._getHorizonUrl();
          const res = await fetch(`${horizonUrl}/extensions/${encodeURIComponent(name)}`);
          if (res.ok) registry = await res.json();
        } catch {}
        if (!registry?.latest) return console.log(chalk.red(`"${name}" not found in registry.`));

        const latestVersion = registry.latest.version;

        if (currentVersion === latestVersion) {
          return console.log(chalk.dim(`${name} is already at v${currentVersion} (latest).`));
        }

        console.log(chalk.dim(`Updating ${name}: v${currentVersion} -> v${latestVersion}`));
        const data = await api.installExtension(name, latestVersion);
        console.log(chalk.green(`Updated: ${name} v${latestVersion}`));
        console.log(chalk.dim(`${data.filesWritten} files written. Restart the land to load.`));
        await refreshProtocolCache();
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("publish [name...]")
    .description("Publish a local extension to the registry")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: ext publish <name>. Run 'ext list' to see local extensions."));
      const name = parts.join("-");
      try {
        const api = getApi(requireAuth());
        console.log(chalk.dim(`Publishing ${name} to registry...`));
        const data = await api.publishExtension(name);
        console.log(chalk.green(`Published: ${data.name} v${data.version}`));
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("disable [name...]")
    .description("Disable an extension (takes effect on restart)")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: ext disable <name>. Run 'ext list' to see loaded extensions."));
      const name = parts.join("-");
      try {
        const api = getApi(requireAuth());

        // Validate extension exists on this land
        const allManifests = await api.get("/land/extensions");
        const known = (allManifests?.extensions || []).map(e => e.name);
        if (!known.includes(name)) {
          return console.log(chalk.red(`Extension "${name}" not found on this land. Run 'ext list' to see loaded extensions.`));
        }

        // Warn if other extensions depend on this one
        if (allManifests?.extensions) {
          const dependents = allManifests.extensions
            .filter(e => e.name !== name && (e.needs?.extensions || e.manifest?.needs?.extensions || []).includes(name))
            .map(e => e.name);
          if (dependents.length > 0) {
            console.log(chalk.yellow(`Warning: ${dependents.join(", ")} depend on "${name}" and will fail to load.`));
          }
        }

        const data = await api.disableExtension(name);
        console.log(chalk.yellow(`Disabled: ${name}`));
        console.log(chalk.dim("Restart the land for this to take effect."));
        if (data.disabledExtensions?.length) {
          console.log(chalk.dim("Currently disabled:"), data.disabledExtensions.join(", "));
        }
        await refreshProtocolCache();
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("enable [name...]")
    .description("Re-enable a disabled extension (takes effect on restart)")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: ext enable <name>. Run 'ext list' to see disabled extensions."));
      const name = parts.join("-");
      try {
        const api = getApi(requireAuth());
        const data = await api.enableExtension(name);
        if (data?.error) return console.log(chalk.red(data.error));
        console.log(chalk.green(`Enabled: ${name}`));
        console.log(chalk.dim("Restart the land for this to take effect."));
        await refreshProtocolCache();
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  ext
    .command("uninstall [name...]")
    .description("Remove an extension (data in database is kept)")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: ext uninstall <name>. This removes code but keeps database data."));
      const name = parts.join("-");

      try {
        const api = getApi(requireAuth());

        // Validate and check dependencies
        const allManifests = await api.get("/land/extensions");
        const dependents = [];
        if (allManifests?.extensions) {
          for (const ext of allManifests.extensions) {
            if (ext.name === name) continue;
            const deps = ext.needs?.extensions || ext.manifest?.needs?.extensions || [];
            if (deps.includes(name)) {
              dependents.push(ext.name);
            }
          }
        }

        if (dependents.length > 0) {
          console.log(chalk.red(`Cannot uninstall "${name}". These extensions depend on it:`));
          for (const dep of dependents) {
            console.log(chalk.red(`  ${dep}`));
          }
          console.log(chalk.dim("Uninstall those first, or use --force to remove anyway."));
          if (!parts.includes("--force") && !parts.includes("-f")) return;
        }

        const readline = require("readline");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

        const answer = await new Promise(resolve => {
          rl.question(chalk.yellow(`Remove "${name}"? Code deleted, database data kept. (y/N) `), resolve);
        });
        rl.close();

        if (answer.toLowerCase() !== "y") {
          console.log(chalk.dim("Cancelled."));
          return;
        }

        const data = await api.uninstallExtension(name);
        console.log(chalk.green(`Uninstalled: ${name}`));
        console.log(chalk.dim("Restart the land to apply."));
        await refreshProtocolCache();
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  // -------------------------------------------------------------------------
  // Bundle commands
  // -------------------------------------------------------------------------

  const bundle = program
    .command("bundle")
    .description("Manage extension bundles")
    .addHelpText("after", `
Examples:
  bundle list                  List available bundles
  bundle info treeos-cascade   Look before you plant. Full details.
  bundle install treeos-cascade  Install all member extensions
    `)
    .action(() => bundle.outputHelp());

  bundle
    .command("list")
    .description("List available bundles from the directory")
    .action(async () => {
      try {
        const horizonUrl = "https://horizon.treeos.ai";
        const res = await fetch(`${horizonUrl}/extensions?type=bundle&limit=100`);
        if (!res.ok) throw new Error(`Directory unavailable (${res.status})`);
        const data = await res.json();
        const bundles = data.extensions || [];
        if (!bundles.length) return console.log(chalk.dim("  No bundles published yet."));

        console.log(chalk.bold(`Bundles (${data.total})\n`));
        for (const b of bundles) {
          const count = (b.includes || []).length;
          const dl = b.downloads ? chalk.dim(` ${b.downloads} dl`) : "";
          console.log(`  ${chalk.yellow(b.name)} ${chalk.dim("v" + b.version)} ${chalk.dim(`(${count} extensions)`)}${dl}`);
          if (b.description) console.log(`    ${chalk.dim(b.description)}`);
        }
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  bundle
    .command("info [name...]")
    .description("Look before you plant. Shows bundle details, member list, total size estimate.")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: bundle info <name>"));
      const name = parts.join("-");
      try {
        const horizonUrl = "https://horizon.treeos.ai";

        // Fetch bundle details
        const res = await fetch(`${horizonUrl}/extensions/${encodeURIComponent(name)}`);
        if (!res.ok) return console.log(chalk.red(`Bundle "${name}" not found.`));
        const data = await res.json();
        const b = data.latest;
        if (!b || b.type !== "bundle") return console.log(chalk.red(`"${name}" is not a bundle.`));

        console.log(chalk.bold(chalk.yellow("[bundle]") + " " + b.name) + " " + chalk.dim("v" + b.version));
        if (b.description) console.log(b.description);
        console.log(chalk.dim(`by ${b.authorName || b.authorDomain || "unknown"}, ${b.downloads || 0} downloads`));
        console.log();

        // Fetch ecosystem stats
        const ecoRes = await fetch(`${horizonUrl}/extensions/${encodeURIComponent(name)}/ecosystem`);
        if (ecoRes.ok) {
          const eco = await ecoRes.json();
          if (eco.stats) {
            console.log(chalk.bold("Ecosystem:"));
            console.log(`  ${chalk.dim("Extensions:")} ${eco.stats.extensionCount}`);
            console.log(`  ${chalk.dim("Total installs:")} ${eco.stats.totalDownloads}`);
            console.log(`  ${chalk.dim("Contributors:")} ${eco.stats.contributorCount}`);
            console.log();
          }

          if (eco.members?.length) {
            console.log(chalk.bold("Included Extensions:"));
            let totalBytes = 0;
            for (const m of eco.members) {
              const dl = m.downloads ? chalk.dim(` ${m.downloads} dl`) : "";
              console.log(`  ${chalk.cyan(m.name)} ${chalk.dim("v" + (m.version || "?"))}${dl}`);
              if (m.description) console.log(`    ${chalk.dim(m.description)}`);
              totalBytes += m.totalBytes || 0;
            }
            if (totalBytes > 0) {
              console.log(chalk.dim(`\n  Estimated size: ${(totalBytes / 1024).toFixed(1)} KB`));
            }
          }
        }

        // Show npm deps across all members
        const includes = b.manifest?.includes || b.includes || [];
        console.log(chalk.dim(`\ntreeos bundle install ${name}`));
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  bundle
    .command("install [name...]")
    .description("Install a bundle (installs all member extensions)")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: bundle install <name>. Run 'bundle list' to find bundles."));
      const name = parts.join("-");
      try {
        const api = getApi(requireAuth());
        const horizonUrl = "https://horizon.treeos.ai";

        // Fetch bundle from registry
        console.log(chalk.dim(`Fetching bundle ${name} from directory...`));
        const res = await fetch(`${horizonUrl}/extensions/${encodeURIComponent(name)}`);
        if (!res.ok) return console.log(chalk.red(`Bundle "${name}" not found in directory.`));
        const data = await res.json();
        const b = data.latest;
        if (!b || b.type !== "bundle") return console.log(chalk.red(`"${name}" is not a bundle.`));

        const includes = b.manifest?.includes || b.includes || [];
        if (!includes.length) return console.log(chalk.red("Bundle has no members."));

        console.log(chalk.bold(`Installing ${name}: ${includes.length} extensions\n`));

        let installed = 0;
        let skipped = 0;
        let failed = 0;

        for (const dep of includes) {
          const depName = dep.split("@")[0];
          const depVersion = dep.includes("@") ? dep.split("@")[1] : null;
          try {
            console.log(chalk.dim(`  ${depName}...`));
            const result = await api.installExtension(depName, depVersion);
            console.log(chalk.green(`  Installed: ${depName} v${result.version || "?"}`));
            installed++;
          } catch (err) {
            if (err.message?.includes("already") || err.message?.includes("exists")) {
              console.log(chalk.dim(`  ${depName} already installed.`));
              skipped++;
            } else {
              console.log(chalk.red(`  Failed: ${depName}: ${err.message}`));
              failed++;
            }
          }
        }

        console.log();
        console.log(chalk.bold("Summary:"), `${installed} installed, ${skipped} already present, ${failed} failed`);
        if (failed === 0) {
          console.log(chalk.dim("Restart the land to load."));
        } else {
          console.log(chalk.yellow("Some extensions failed. The bundle may not work correctly."));
        }
        await refreshProtocolCache();
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  // -------------------------------------------------------------------------
  // OS commands
  // -------------------------------------------------------------------------

  const os = program
    .command("os")
    .description("Manage operating systems (extension distributions)")
    .addHelpText("after", `
Examples:
  os list              List available OS distributions
  os info TreeOS       Look before you plant. Full details.
  os install TreeOS    Install everything: bundles, extensions, config.
    `)
    .action(() => os.outputHelp());

  os
    .command("list")
    .description("List available OS distributions from the directory")
    .action(async () => {
      try {
        const horizonUrl = "https://horizon.treeos.ai";
        const res = await fetch(`${horizonUrl}/extensions?type=os&limit=100`);
        if (!res.ok) throw new Error(`Directory unavailable (${res.status})`);
        const data = await res.json();
        const items = data.extensions || [];
        if (!items.length) return console.log(chalk.dim("  No OS distributions published yet."));

        console.log(chalk.bold(`Operating Systems (${data.total})\n`));
        for (const o of items) {
          const bundleCount = (o.bundles || []).length;
          const standaloneCount = (o.standalone || []).length;
          const dl = o.downloads ? chalk.dim(` ${o.downloads} dl`) : "";
          console.log(`  ${chalk.magenta(o.name)} ${chalk.dim("v" + o.version)}${dl}`);
          if (o.description) console.log(`    ${chalk.dim(o.description)}`);
          console.log(`    ${chalk.dim(`${bundleCount} bundles, ${standaloneCount} standalone extensions`)}`);
          console.log();
        }
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  os
    .command("info [name...]")
    .description("Look before you plant. Shows everything the OS installs, configures, and expects.")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: os info <name>"));
      const name = parts.join("-");
      try {
        const horizonUrl = "https://horizon.treeos.ai";

        const res = await fetch(`${horizonUrl}/extensions/${encodeURIComponent(name)}`);
        if (!res.ok) return console.log(chalk.red(`OS "${name}" not found.`));
        const data = await res.json();
        const o = data.latest;
        if (!o || o.type !== "os") return console.log(chalk.red(`"${name}" is not an OS.`));

        const m = o.manifest || {};

        console.log(chalk.bold(chalk.magenta("[os]") + " " + o.name) + " " + chalk.dim("v" + o.version));
        if (o.description) console.log(o.description);
        console.log(chalk.dim(`by ${o.authorName || o.authorDomain || "unknown"}, ${o.downloads || 0} downloads`));
        console.log();

        // Ecosystem stats
        const ecoRes = await fetch(`${horizonUrl}/extensions/${encodeURIComponent(name)}/ecosystem`);
        if (ecoRes.ok) {
          const eco = await ecoRes.json();
          if (eco.stats) {
            console.log(chalk.bold("Ecosystem:"));
            console.log(`  ${chalk.dim("Extensions:")} ${eco.stats.extensionCount}`);
            console.log(`  ${chalk.dim("Total installs:")} ${eco.stats.totalDownloads}`);
            console.log(`  ${chalk.dim("Contributors:")} ${eco.stats.contributorCount}`);
            console.log();
          }

          // Estimate disk footprint
          let totalBytes = 0;
          if (eco.members) {
            for (const mem of eco.members) totalBytes += mem.totalBytes || 0;
          }
          if (totalBytes > 0) {
            console.log(chalk.dim(`  Estimated disk: ${(totalBytes / 1024).toFixed(1)} KB`));
            console.log();
          }
        }

        // Bundles
        const bundles = m.bundles || o.bundles || [];
        if (bundles.length) {
          console.log(chalk.bold("Bundles:"));
          for (const b of bundles) console.log(`  ${chalk.yellow(b)}`);
          console.log();
        }

        // Standalone
        const standalone = m.standalone || o.standalone || [];
        if (standalone.length) {
          console.log(chalk.bold("Standalone Extensions:"));
          for (const s of standalone) console.log(`  ${chalk.cyan(s)}`);
          console.log();
        }

        // Config defaults
        const config = m.config || o.osConfig;
        if (config && Object.keys(config).length) {
          console.log(chalk.bold("Config Defaults:"));
          for (const [k, v] of Object.entries(config)) {
            console.log(`  ${chalk.dim(k)}: ${v}`);
          }
          console.log();
        }

        // Orchestrators
        const orchestrators = m.orchestrators || o.osOrchestrators;
        if (orchestrators && Object.keys(orchestrators).length) {
          console.log(chalk.bold("Orchestrators:"));
          for (const [zone, orch] of Object.entries(orchestrators)) {
            console.log(`  ${chalk.dim(zone)}: ${orch}`);
          }
          console.log();
        }

        // npm dependencies across all members
        const npmDeps = new Set();
        if (m.needs?.npm) m.needs.npm.forEach(d => npmDeps.add(d));

        // Collect from ecosystem members
        const ecoRes2 = await fetch(`${horizonUrl}/extensions/${encodeURIComponent(name)}/ecosystem`);
        if (ecoRes2.ok) {
          const eco2 = await ecoRes2.json();
          for (const mem of (eco2.members || [])) {
            if (mem.npmDependencies) mem.npmDependencies.forEach(d => npmDeps.add(d));
          }
        }

        if (npmDeps.size > 0) {
          console.log(chalk.bold("npm Dependencies (across all extensions):"));
          for (const d of npmDeps) console.log(`  ${chalk.dim(d)}`);
          console.log();
        }

        console.log(chalk.dim(`treeos os install ${name}`));
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });

  os
    .command("install [name...]")
    .description("Install an OS distribution (all bundles, extensions, config)")
    .action(async (parts) => {
      if (!parts || !parts.length) return console.log(chalk.yellow("Usage: os install <name>. Run 'os list' to find OS distributions. Run 'os info <name>' first."));
      const name = parts.join("-");
      try {
        const api = getApi(requireAuth());
        const horizonUrl = "https://horizon.treeos.ai";

        console.log(chalk.dim(`Fetching OS ${name} from directory...`));
        const res = await fetch(`${horizonUrl}/extensions/${encodeURIComponent(name)}`);
        if (!res.ok) return console.log(chalk.red(`OS "${name}" not found in directory.`));
        const data = await res.json();
        const o = data.latest;
        if (!o || o.type !== "os") return console.log(chalk.red(`"${name}" is not an OS.`));

        const m = o.manifest || {};
        const bundles = m.bundles || o.bundles || [];
        const standalone = m.standalone || o.standalone || [];

        console.log(chalk.bold(`Installing ${name}: ${bundles.length} bundles, ${standalone.length} standalone extensions\n`));

        let installed = 0;
        let skipped = 0;
        let failed = 0;

        // Install each bundle's members
        for (const bundleRef of bundles) {
          const bundleName = bundleRef.split("@")[0];
          console.log(chalk.bold(`\nBundle: ${bundleName}`));

          const bRes = await fetch(`${horizonUrl}/extensions/${encodeURIComponent(bundleName)}`);
          if (!bRes.ok) {
            console.log(chalk.red(`  Bundle "${bundleName}" not found in directory.`));
            failed++;
            continue;
          }
          const bData = await bRes.json();
          const b = bData.latest;
          if (!b) {
            console.log(chalk.red(`  Bundle "${bundleName}" has no published version.`));
            failed++;
            continue;
          }

          const includes = b.manifest?.includes || b.includes || [];
          for (const dep of includes) {
            const depName = dep.split("@")[0];
            const depVersion = dep.includes("@") ? dep.split("@")[1] : null;
            try {
              console.log(chalk.dim(`  ${depName}...`));
              const result = await api.installExtension(depName, depVersion);
              console.log(chalk.green(`  Installed: ${depName} v${result.version || "?"}`));
              installed++;
            } catch (err) {
              if (err.message?.includes("already") || err.message?.includes("exists")) {
                console.log(chalk.dim(`  ${depName} already installed.`));
                skipped++;
              } else {
                console.log(chalk.red(`  Failed: ${depName}: ${err.message}`));
                failed++;
              }
            }
          }
        }

        // Install standalone extensions
        if (standalone.length) {
          console.log(chalk.bold("\nStandalone Extensions:"));
          for (const dep of standalone) {
            const depName = dep.split("@")[0];
            const depVersion = dep.includes("@") ? dep.split("@")[1] : null;
            try {
              console.log(chalk.dim(`  ${depName}...`));
              const result = await api.installExtension(depName, depVersion);
              console.log(chalk.green(`  Installed: ${depName} v${result.version || "?"}`));
              installed++;
            } catch (err) {
              if (err.message?.includes("already") || err.message?.includes("exists")) {
                console.log(chalk.dim(`  ${depName} already installed.`));
                skipped++;
              } else {
                console.log(chalk.red(`  Failed: ${depName}: ${err.message}`));
                failed++;
              }
            }
          }
        }

        // Apply config defaults (merge, don't overwrite)
        const config = m.config || o.osConfig;
        if (config && Object.keys(config).length) {
          console.log(chalk.bold("\nApplying config defaults..."));
          try {
            for (const [key, value] of Object.entries(config)) {
              try {
                await api.post("/land/config", { key, value, merge: true });
                console.log(chalk.dim(`  ${key}: ${value}`));
              } catch {
                console.log(chalk.dim(`  ${key}: skipped (already set or invalid)`));
              }
            }
          } catch (err) {
            console.log(chalk.yellow(`  Config apply failed: ${err.message}`));
          }
        }

        console.log(chalk.bold("\nSummary:"));
        console.log(`  ${installed} installed, ${skipped} already present, ${failed} failed`);
        if (failed === 0) {
          console.log(chalk.green(`\n${name} installed successfully.`));
          console.log(chalk.dim("Restart the land to load."));
        } else {
          console.log(chalk.yellow("\nSome components failed. The OS may not work correctly."));
          console.log(chalk.dim("Restart the land to load what was installed."));
        }
        await refreshProtocolCache();
      } catch (err) {
        console.error(chalk.red("Error:"), err.message);
      }
    });
};
