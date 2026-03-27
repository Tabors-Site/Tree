# TreeOS

Terminal client for [Tree](https://treeOS.ai). A context management system for organizing AI, data, and ideas into living structure. Navigate your trees like a filesystem. Run multiple AI conversations in parallel. Connect to any Land, browse the canopy network, and work across federated trees from one terminal.

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

@fitness how's my bench      # named session, pinned here
cd /Projects                 # navigate away
@fitness add 5 reps to last set  # still talks to Health/Workouts
sessions                     # see all active sessions

cd /                         # go to Land root
home                         # back to user home
exit                         # leave the shell
```

---

## Commands

### Connection

| Command              | Description                                           |
| -------------------- | ----------------------------------------------------- |
| `connect <url>`      | Set Land URL (e.g. `http://localhost:3000`)            |
| `start` / `shell`    | Launch interactive shell                               |
| `stop` / `exit`      | Exit the shell                                         |
| `login --key <key>`  | Authenticate with your API key                         |
| `logout`             | Clear stored credentials                               |
| `whoami`             | Show login, plan, energy, and active tree              |
| `help`               | Refresh available commands and show help               |
| `protocol`           | Show land capabilities, extensions, command count       |

### Sessions

Named conversations pinned to positions. Start a session anywhere, navigate away, come back to it from anywhere. Each session maintains its own AI context at its pinned position.

| Command                   | Description                                              |
| ------------------------- | -------------------------------------------------------- |
| `@name <message>`         | Send a message to a named session. Creates it if new.    |
| `@name`                   | Switch to a named session (prompt updates)               |
| `@default`                | Switch back to default session (follows navigation)      |
| `sessions`                | List all active sessions with positions                  |
| `sessions kill <handle>`  | End a named session                                      |

Sessions are pinned to the position where they were created. `@fitness` created at `/Health/Fitness` always talks to that position, even if you navigate to `/Projects`. The AI responds with the full context of the pinned branch.

Navigating with `cd` switches back to the default session. Named sessions stay alive. `@fitness` from anywhere brings you right back.

In the shell, the prompt shows your active session:

```
tabor@treeos.ai/MyTree @fitness >
```

### AI

AI has full context of the branch you're in. Works in remote trees too.

| Command           | Description                                    |
| ----------------- | ---------------------------------------------- |
| `chat <message>`  | Chat with AI about the current branch          |
| `place <message>` | AI writes content into the branch              |
| `query <message>` | Ask AI about the branch (read-only, no writes) |
| `chats`           | Chat history for current node. `-l` limit      |
| `chats tree`      | All chat history across the whole tree         |

Use `@name` for named sessions (see Sessions above). `@fitness hello` is the natural way. `chat` is for messages at the current position without a session name.

### Land Root

At `/` you see the Land. System nodes (`.identity`, `.config`, `.peers`) appear alongside your own trees, shared trees, and public trees.

| Command        | Description                                                                    |
| -------------- | ------------------------------------------------------------------------------ |
| `cd /`         | Go to Land root from anywhere                                                  |
| `ls` / `ls -l` | List system nodes + your trees + shared trees + public trees                   |
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
| `cc`                | Open the command center (tools, modes, extensions at this position)                          |

Nodes have three statuses: **active** (green), **completed** (gray), **trimmed** (dim).

When inside a remote tree (prompt shows `@domain`), all commands route through the canopy proxy to the remote land.

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
| `peer discover <domain>`   | Look up a land on the Horizon and auto-peer         |
| `peer ping`                | Heartbeat check all peers                           |
| `search [query]`           | Search the Horizon for public trees                 |
| `search -l [query]`        | Search for lands instead of trees                   |
| `browse <domain> [query]`  | List public trees on a specific peer land            |
| `cd @domain/treename`      | Enter a remote tree (all commands proxy through)     |
| `cd @domain`               | List public trees on a remote land                   |

Once inside a remote tree, your shell prompt shows the `@domain` prefix and all commands route transparently through the canopy proxy.

### Blog

No login required.

| Command                 | Description                        |
| ----------------------- | ---------------------------------- |
| `blogs`                 | List published posts               |
| `blog <slug or number>` | Read a post by slug or list number |

### Extensions

Install, manage, and build modular capabilities. Commands from installed extensions appear automatically after `help` refreshes the protocol.

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

### Bundles and OS

Install entire capability bundles or full OS distributions in one command.

| Command                    | Description                                           |
| -------------------------- | ----------------------------------------------------- |
| `bundle list`              | List available bundles from the directory              |
| `bundle info <name>`       | Full details, member list, size estimate               |
| `bundle install <name>`    | Install all member extensions                          |
| `os list`                  | List available OS distributions                        |
| `os info <name>`           | Everything it installs, configures, and expects        |
| `os install <name>`        | Install everything: bundles, extensions, config         |

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
| `ext-allow <name>`                | Allow a confined extension at this node              |

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

### Multiple sessions in parallel

```
root Fitness
cd Workouts
@fitness track my bench progress      # creates @fitness pinned here

cd /Projects/Backend
@work what's the status on the API    # creates @work pinned here

@fitness add 5 reps to bench          # talks to Workouts from Projects
@work prioritize the auth refactor    # talks to Backend from Projects
sessions                              # see both sessions
@default                              # back to following navigation
```

### Let AI build your structure

```
root Startup
chat I need to plan a product launch for March --
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

When you `cd @domain/treename`, the CLI proxies all operations through the canopy. The remote land handles auth and access.

### Morning routine from the terminal

```
treeos start
root Life
calendar                         # what's scheduled today
cd -r Workouts                   # jump straight there
place ran 5k, felt good
@fitness log bench 135x8, 155x5  # quick session note from anywhere
cd /
dream-time 9:30pm               # AI cleans up tonight
```

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

### Extension-Provided Commands

These appear when the extension is installed. Run `help` to refresh.

| Command                      | Extension      | Description                                          |
| ---------------------------- | -------------- | ---------------------------------------------------- |
| `scout <query>`              | scout          | Triangulate across the tree with five search strategies |
| `explore <query>`            | explore        | Navigate downward through a branch to find information  |
| `explore deep <query>`       | explore        | More iterations, lower confidence threshold             |
| `explore map`                | explore        | Last exploration map at this position                   |
| `trace <concept>`            | trace          | Follow one thread through the entire tree chronologically |
| `changelog`                  | changelog      | What changed at this branch. `--since 7d`, `--land`    |
| `digest`                     | digest         | Today's daily briefing from the tree                    |
| `delegate`                   | delegate       | Pending work suggestions for team members               |
| `competence`                 | competence     | Knowledge boundaries at this position                   |
| `governance`                 | governance     | Governance status for all configured directories        |
| `evolve`                     | evolve         | Detected patterns and extension proposals               |
| `flow`                       | flow           | Cascade signals scoped to current position              |
| `inverse`                    | inverse-tree   | Your profile as the AI sees it                          |
| `intent`                     | intent         | Autonomous intent queue and recent executions            |
| `intent pause`               | intent         | Pause autonomous behavior on this tree                  |
| `intent history`             | intent         | What the tree did on its own                            |

---

## Deep Dive: @Sessions

Sessions are the most powerful feature of the CLI. They let you hold multiple parallel conversations at different positions in the tree, switch between them instantly, and never lose context.

### The basics

```
@fitness how's my bench press progress
```

This creates a session called `fitness`, pins it to your current position, and sends the message. The AI responds with full context of that branch. You can navigate anywhere else and keep talking to it.

### Why sessions matter

Without sessions, the AI context follows your navigation. `cd` somewhere and the AI forgets where you were. Sessions break that coupling. The AI at `@fitness` always thinks from the position where you created it, regardless of where you are now.

### Multiple conversations at once

```
cd Health/Fitness
@fitness what should I do today

cd /Work/Backend
@work what's blocking the auth refactor

cd /Life/Journal
@journal I've been thinking about balance

@fitness add 10 lbs to squat
@work create a ticket for the token migration
@journal that felt good to write down
```

Three sessions. Three positions. Three AI contexts. You're standing at `/Life/Journal` but talking to all three branches. Each one responds from its own position with its own tools, modes, and context.

### Switching vs sending

- `@fitness hello` sends a message to the fitness session
- `@fitness` alone (no message) switches your active session. The prompt changes. All subsequent `chat` commands go to that session without the prefix.
- `@default` switches back to the default session that follows your navigation.

### The prompt tells you

```
tabor@treeos.ai/Life/Journal @fitness >
```

This means: you're at `/Life/Journal` but your active session is `@fitness`. A plain `chat` message would go to the fitness session, not to Journal.

### Sessions survive navigation

```
@fitness log bench 135x8
cd /                           # navigate to land root
@fitness and squats 225x5      # still talks to Health/Fitness
home                           # go to user home
@fitness what's my weekly total # still talks to Health/Fitness
```

The session doesn't care where you are. It talks to where it was born.

### Managing sessions

```
sessions                       # list all active sessions
sessions kill fitness          # end a session
@default                       # back to following navigation
```

### When to use sessions vs navigation

**Navigate** when you want to work at a position. `cd Work/API` and then `chat`, `note`, `place`. The AI context matches where you are.

**Use sessions** when you want to talk to multiple positions without navigating back and forth. `@fitness` from anywhere. `@work` from anywhere. The AI remembers.

### Hypothetical: sessions across trees

Imagine three trees: Health, Work, Personal.

```
@health log my run today, 5k in 28 minutes
@work the deploy finished, update the status
@journal feeling productive today
```

Three trees. Three conversations. One terminal. Each session holds its own tree root, node position, and AI context. You never navigate between trees. The sessions are your portals.

### Hypothetical: sessions with extensions

With the intent extension installed, sessions become even more powerful:

```
@fitness what did the tree do overnight
```

The AI at `@fitness` checks intent history for the Health tree and tells you: "Intent compressed the old workout logs and nudged you about running." You didn't navigate there. You asked from wherever you were.

With delegate installed:

```
@team-api any delegate suggestions for me
```

The AI checks delegate suggestions near your session position and tells you what needs attention.

Sessions turn the CLI from a navigation tool into a command center. You don't go to the work. The work comes to you.

---

## How It Works

All commands map to the [Tree REST API](https://treeOS.ai/about/api). Named sessions use `sessionHandle` to maintain conversation context across messages. Remote tree operations route through the [Canopy protocol](https://treeOS.ai/about) via `/canopy/proxy/:domain/*`. Config stored in `~/.treeos/config.json`.

## Links

- [TreeOS](https://treeOS.ai)
- [Full Guide](https://treeOS.ai/guide)
- [AI Architecture](https://treeOS.ai/ai)
- [The Network](https://treeOS.ai/decentralized)
- [API Reference](https://treeOS.ai/about/api)
- [CLI Guide](https://treeOS.ai/about/cli)
- [Extensions](https://treeOS.ai/about/extensions)
- [The Horizon](https://horizon.treeOS.ai)
- [GitHub](https://github.com/taborgreat/TreeOS)
