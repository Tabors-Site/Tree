# TreeOS

Terminal client for [Tree](https://treeOS.ai). A context management system for organizing AI, data, and ideas into living structure. Navigate your trees like a filesystem. Connect to any Land, browse the canopy network, and work across federated trees from one terminal.

## Install

```bash
npm install -g treeos
```

## Quick Start

```bash
treeos connect http://localhost:3000   # point at your Land (or skip for treeOS.ai)
treeos login --key YOUR_API_KEY        # get your key from your Land
treeos start                           # launch the interactive shell
```

```
roots                        # list your trees
root Life Plan               # enter a tree
ls                           # list children
mkdir Health, Work, Projects # create nodes
cd Health                    # navigate deeper

chat make me a weekly workout plan
tree                         # see the structure it built
cd Workouts                  # go into a node it created
place did 20 pushups today   # AI logs it in the right spot
note stretch before next session

cd /                         # go to Land root
ls                           # see system nodes, your trees, public trees
cd ..                        # back up one level

idea i should track my sleep # AI places it in the right tree
home                         # back to user home
exit                         # leave the shell
```

---

## Commands

### Session

| Command              | Description                                           |
| -------------------- | ----------------------------------------------------- |
| `connect <url>`      | Set Land URL (e.g. `http://localhost:3000`)            |
| `start` / `shell`    | Launch interactive shell                               |
| `stop` / `exit`      | Exit the shell                                         |
| `login --key <key>`  | Authenticate with your API key                         |
| `logout`             | Clear stored credentials                               |
| `whoami`             | Show login, plan, energy, and active tree              |

### Land Root

At `/` you see the Land. System nodes (`.identity`, `.config`, `.peers`) appear alongside your own trees, shared trees, and public trees on this Land.

| Command        | Description                                                                    |
| -------------- | ------------------------------------------------------------------------------ |
| `cd /`         | Go to Land root from anywhere                                                  |
| `ls` / `ls -l` | List system nodes + your trees + shared trees + public trees. Long format shows type (owned/shared/public/system) |
| `cd <name>`    | Enter a tree or system node                                                    |
| `config`       | View Land runtime configuration                                                |
| `config set <key> <val>` | Set a config value (admin only)                                      |

### User Home

Your home screen before entering a tree.

| Command                      | Description                                    |
| ---------------------------- | ---------------------------------------------- |
| `roots`                      | List all your trees                            |
| `use <name>` / `root <name>` | Enter a tree by name or ID                     |
| `mkroot <name>`              | Create a new tree                              |
| `retire/leave [name] -f`     | Leave a shared tree or delete if sole owner    |
| `home`                       | Leave current tree, return home                |
| `invites`                    | List pending invites from other users          |
| `tags` / `mail`              | Notes where you've been @tagged                |
| `notes`                      | Your user-level notes. `-l` limit, `-q` search |
| `chats`                      | All AI chats across your trees. `-l` limit     |
| `contributions`              | Your recent contributions                      |
| `share-token [token]`        | Show or set your share token                   |
| `share idea <id>`            | Public link to a raw idea                      |

### Raw Ideas

Capture ideas from anywhere. AI figures out where they belong.

| Command                       | Description                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `ideas`                       | List ideas. `-p` pending, `-r` processing, `-s` stuck, `-d` done, `-a` all, `-q` search, `-l` limit |
| `cat idea <id or #>`          | View full content of a raw idea                                                                     |
| `idea <message>`              | AI places your idea in the right tree and navigates you there                                       |
| `idea-store <message>`        | Save an idea for later without processing                                                           |
| `idea-place <id or message>`  | AI-place an idea (fire-and-forget)                                                                  |
| `idea-auto [on/off]`          | Toggle auto-placement every 15 min (Standard plan+)                                                 |
| `idea-transfer <id> <nodeId>` | Manually move an idea to a specific node                                                            |
| `rm-idea <id> -f`             | Delete a raw idea                                                                                   |

---

### Navigation

Move through your tree the way you'd move through a filesystem. Works in local and remote trees.

| Command             | Description                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------------- |
| `pwd`               | Print current path (includes `@domain` prefix when in a remote tree)                         |
| `ls` / `ls -l`      | List children. Long format shows IDs and status                                              |
| `cd <name>`         | Navigate into a child. Supports `..`, `/`, `-r` (search whole tree), path chaining (`A/B/C`) |
| `cd @domain/tree`   | Enter a public tree on a remote land via the canopy proxy                                    |
| `cd @domain`        | List public trees on a remote land                                                           |
| `tree`              | Render subtree. `-a` active, `-c` completed, `-t` trimmed                                    |

Nodes have three statuses: **active** (green), **completed** (gray), **trimmed** (dim).

When inside a remote tree (prompt shows `@domain` in the path), all commands (`ls`, `mkdir`, `note`, `chat`, etc.) automatically route through the canopy proxy to the remote land.

### Node Management

Build and reshape your tree structure.

| Command               | Description                                                         |
| --------------------- | ------------------------------------------------------------------- |
| `mkdir <name>`        | Create child node(s). Comma-separate for multiple: `mkdir foo, bar` |
| `rm <name> -f`        | Delete a node (soft delete)                                         |
| `rename <name> <new>` | Rename a child node                                                 |
| `mv <name> <destId>`  | Move a node to a new parent                                         |
| `complete`            | Set current node and all children to completed                      |
| `activate`            | Set current node and all children to active                         |
| `trim`                | Set current node and all children to trimmed                        |
| `prestige`            | Create a new version of the current node                            |

### Notes & Values

Every note adds context the AI can work with. Values track anything quantitative.

| Command              | Description                                                                       |
| -------------------- | --------------------------------------------------------------------------------- |
| `note <content>`     | Post a note on the current node                                                   |
| `notes`              | List notes on the current node. `-l` limit, `-q` search                           |
| `cat note <id or #>` | View full content of a note                                                       |
| `rm-note <id> -f`    | Delete a note                                                                     |
| `book`               | Print the full book of notes from current node down                               |
| `contributions`      | List contributions on the current node                                            |
| `values`             | List values on the current node. `-g` global totals, `-t` per-node tree breakdown |
| `value <key> <val>`  | Set a value                                                                       |
| `goal <key> <goal>`  | Set a goal                                                                        |

### Scheduling

Date: `MM/DD/YYYY`. Time: `HH:MM` or `HH:MMam/pm`. Reeffect: hours. Use `clear` to remove.

| Command                             | Description                                                       |
| ----------------------------------- | ----------------------------------------------------------------- |
| `schedule <date> [time] [reeffect]` | Set schedule (e.g. `1/11/2025 3`, `1/11/2025 11:45pm 5`, `clear`) |
| `calendar`                          | Show scheduled dates. `-m` month (1-12 or name), `-y` year        |
| `dream-time <HH:MM>`                | Set nightly dream time (or `clear`)                               |

### Collaboration

Work on trees with other people. Use `user@domain` to invite users on other lands.

| Command                     | Description                                            |
| --------------------------- | ------------------------------------------------------ |
| `team`                      | Show owner and contributors. Remote users show @domain |
| `invite <username>`         | Invite a local user to the current tree                |
| `invite <user@domain>`      | Invite a user from a remote land                       |
| `invite accept <id>`        | Accept a pending invite                                |
| `invite deny <id>`          | Decline a pending invite                               |
| `kick <username>`           | Remove a contributor                                   |
| `owner <username>`          | Transfer tree ownership                                |

### Links & Sharing

Clickable terminal hyperlinks. `link` uses your share token; `share` generates public links.

**In a tree:**

| Command           | Description                           |
| ----------------- | ------------------------------------- |
| `link`            | Link to current node                  |
| `link root`       | Link to tree root                     |
| `link book`       | Link to book view                     |
| `link gateway`    | Link to gateway channels              |
| `link note <id>`  | Link to a specific note               |
| `share note <id>` | Public link to a note                 |
| `share book`      | Public book share link (TOC included) |

**From home:**

| Command          | Description                 |
| ---------------- | --------------------------- |
| `link`           | Link to your profile        |
| `link ideas`     | Link to your raw ideas      |
| `link idea <id>` | Link to a specific raw idea |

### AI

AI has full context of the branch you're in. Works in remote trees too (LLM calls proxy through the canopy to the user's home land).

| Command           | Description                                    |
| ----------------- | ---------------------------------------------- |
| `chat <message>`  | Chat with AI about the current branch          |
| `place <message>` | AI writes content into the branch              |
| `query <message>` | Ask AI about the branch (read-only, no writes) |
| `chats`           | Chat history for current node. `-l` limit      |
| `chats tree`      | All chat history across the whole tree         |

### Understanding Runs

Compress a branch into a structured encoding the AI can reference.

| Command                     | Description                                        |
| --------------------------- | -------------------------------------------------- |
| `understand [perspective]`  | Start an understanding run. Returns final encoding |
| `understandings`            | List runs                                          |
| `understand-status <runId>` | Check progress                                     |
| `understand-stop <runId>`   | Stop a run                                         |

### Canopy (federation)

Connect to peer lands, discover trees across the network, and navigate into remote trees.

| Command                    | Description                                         |
| -------------------------- | --------------------------------------------------- |
| `peers`                    | List known peer lands                               |
| `peer add <url>`           | Peer with a land by URL                             |
| `peer remove <domain>`     | Remove a peer                                       |
| `peer block <domain>`      | Block a peer land                                   |
| `peer unblock <domain>`    | Unblock a peer land                                 |
| `peer discover <domain>`   | Look up a land in the directory and auto-peer       |
| `peer ping`                | Heartbeat check all peers                           |
| `search [query]`           | Search the directory for public trees               |
| `search -l [query]`        | Search for lands instead of trees                   |
| `browse <domain> [query]`  | List public trees on a specific peer land            |
| `cd @domain/treename`      | Enter a remote tree (all commands proxy through)     |
| `cd @domain`               | List public trees on a remote land                   |

Once inside a remote tree, your shell prompt shows the `@domain` prefix and all commands (navigation, notes, AI, etc.) route transparently through the canopy proxy.

### Blog

No login required.

| Command                 | Description                        |
| ----------------------- | ---------------------------------- |
| `blogs`                 | List published posts               |
| `blog <slug or number>` | Read a post by slug or list number |

### Extensions

Install, manage, and build modular capabilities.

| Command                    | Description                                    |
| -------------------------- | ---------------------------------------------- |
| `ext list`                 | List loaded extensions with status              |
| `ext info <name>`          | Show manifest details                           |
| `ext search [query]`       | Search the extension registry                   |
| `ext view <name>`          | View registry extension (files, manifest)       |
| `ext install <name>`       | Install from registry (auto-resolves deps)      |
| `ext update <name>`        | Update to latest version                        |
| `ext disable <name>`       | Disable (takes effect on restart)               |
| `ext enable <name>`        | Re-enable a disabled extension                  |
| `ext uninstall <name>`     | Remove extension directory (data stays in DB)   |
| `ext publish <name>`       | Publish to the registry                         |
| `protocol`                 | Show land capabilities and loaded extensions    |

### Per-Node AI Customization

Control what the AI can do and how it thinks at every node. Inherits parent to child.

| Command                           | Description                                          |
| --------------------------------- | ---------------------------------------------------- |
| `tools`                           | Show effective tools at current node                 |
| `tools-allow <tool>`              | Add a tool to this node (e.g. execute-shell)         |
| `tools-block <tool>`              | Block a tool at this node (e.g. delete-node-branch)  |
| `tools-clear`                     | Remove all local tool config (inherit from parent)   |
| `modes`                           | Show mode overrides and available modes              |
| `mode-set <intent> <modeKey>`     | Override a mode for an intent at this node           |
| `mode-clear [intent]`             | Clear mode override(s)                               |
| `ext-scope`                       | Show active/blocked extensions at current node       |
| `ext-scope -t`                    | Show block map across entire tree                    |
| `ext-block <name>`                | Block an extension at this node (inherits down)      |
| `ext-allow <name>`                | Remove extension block at this node                  |

### LLM Management

| Command                             | Description                                    |
| ----------------------------------- | ---------------------------------------------- |
| `llms`                              | List your LLM connections                      |
| `llm add`                           | Add a new connection (interactive)             |
| `llm remove <id>`                   | Remove a connection                            |
| `llm assign <slot> <id>`            | Assign to user slot (main)                     |
| `llm tree-assign <slot> <id>`       | Assign to tree slot (default, respond, etc.)   |
| `llm failover`                      | Show failover stack                            |
| `llm failover-push <id>`            | Add backup connection                          |
| `llm failover-pop`                  | Remove last backup                             |

### Land Config

View and manage runtime configuration for the Land. Settings stored in the `.config` system node.

| Command                   | Description                        |
| ------------------------- | ---------------------------------- |
| `config`                  | Show Land URL and all config       |
| `config show`             | Show all config values             |
| `config get <key>`        | Get a single config value          |
| `config set <key> <val>`  | Set a config value (admin only)    |

---

## Name Matching

All commands accept names or IDs. No quotes needed for multi-word names. Matching order:

1. Exact ID or ID prefix
2. Exact name (case-insensitive)
3. Name starts with query
4. Name contains query

Multiple matches prompt you to disambiguate by ID.

## Examples

### Let AI build your structure

```
root Startup
chat I need to plan a product launch for March —
     landing page, email sequence, social, and a demo video

tree                             # see what it built
cd Launch/Landing Page
note hero section should lead with the compression angle
```

Don't pre-build the tree. Describe what you need and let AI create the hierarchy, then navigate into it and start adding detail.

### Fire off ideas throughout the day

```
idea we should batch API calls to reduce token waste
idea the onboarding flow feels too long
idea what if nodes could have expiration dates
ideas                            # see what's pending
ideas -d                         # check what landed
```

Ideas don't need a tree selected. AI matches each one to the right tree and places it. Check back later to see where things ended up.

### Track values across a whole tree

```
root Fitness
cd Workouts/Pushups
value reps 20
cd /Workouts/Running
value miles 3.1
cd /
values -g                        # totals across every branch
values -t                        # per-node breakdown
goal miles 100
```

Values roll up. Set them deep in the tree, read them from anywhere.

### Compress a branch before a decision

```
root Product
cd Roadmap
understand what are the open questions and blockers
```

An understanding run reads every node and note under the branch and returns a compressed encoding. Useful before planning sessions or when a branch gets deep.

### Collaborate on a shared tree

```
root Team Wiki
invite alex
invite sara@other-land.com       # invite from another land
team                             # see contributors (remote users show @domain)
notes -q "auth"                  # find what others added
tags                             # see where you've been @mentioned
```

### Explore the canopy network

```
peers                            # see connected lands
peer add https://friend.land     # connect to a new land
search machine learning          # find public trees across the network
browse friend.land               # see what's public on a specific land
cd @friend.land/Research         # enter a remote tree
ls                               # browse it like your own
note interesting approach here   # leave a note (if you have access)
cd /                             # back to your Land
```

When you `cd @domain/treename`, the CLI proxies all operations through the canopy. The remote land handles auth and access. Your prompt shows where you are.

### Morning routine from the terminal

```
treeos start
root Life
calendar                         # what's scheduled today
cd -r Workouts                   # jump straight there
place ran 5k, felt good
cd /
dream-time 9:30pm               # AI cleans up tonight
```

Set a dream time and the AI will reorganize, compress, and maintain your tree overnight.

### Share your work

```
cd Projects/Blog Post
book                             # preview the full book of notes
share book                       # get a public link
link gateway                     # open the gateway view
```

### Connect to your own Land

```bash
treeos connect http://localhost:3000   # self-hosted Land
treeos login --key YOUR_KEY
treeos start
```

If you skip `connect`, the CLI defaults to `https://treeOS.ai`.

---

## How It Works

All commands map to the [Tree REST API](https://treeOS.ai/about/api). Remote tree operations route through the [Canopy protocol](https://treeOS.ai/about) via `/canopy/proxy/:domain/*`. Config stored in `~/.treeos/config.json`.

## Links

- [TreeOS](https://treeOS.ai)
- [Full Guide](https://treeOS.ai/guide)
- [AI Architecture](https://treeOS.ai/ai)
- [The Network](https://treeOS.ai/decentralized)
- [API Reference](https://treeOS.ai/about/api)
- [CLI Guide](https://treeOS.ai/about/cli)
- [Extensions](https://treeOS.ai/about/extensions)
- [Directory](https://dir.treeOS.ai)
- [GitHub](https://github.com/Tabors-Site/Tree)
