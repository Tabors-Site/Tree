# OS.md

# TreeOS as an Operating System

## What This Document Is

This document describes the full vision for TreeOS as an operating system — not a packaged appliance, not a hosted application, but the foundational userspace layer between the Linux kernel and everything else. It captures what the architecture would look like at its deepest implementation: every process tracked as a being, every hardware change captured as a fact, every system event part of a replayable chain.

This is not a roadmap for current development. It is a published possibility: a description of what TreeOS could become if and when demand and resources justify the effort. The substrate is being built first. The OS layer is what's next, ready for contributors when the moment is right.

---

## The Core Idea

Every modern operating system carries decades of accumulated complexity. UNIX-derived systems (Linux, macOS, BSD) built up layer after layer of mechanisms — processes, signals, file descriptors, sockets, namespaces, cgroups, capabilities — each added to solve a specific problem at a specific time. The result is enormously capable and enormously hard to reason about. State is scattered across processes, kernel structures, log files, configuration trees. Audit is partial. Recovery is approximate. "What happened on this machine yesterday at 3pm?" is sometimes answerable through forensic effort, often not.

TreeOS proposes a different foundation: **every event on the machine is a fact on a chain, every process is a being, every piece of hardware is matter in spaces, the system's complete state is recoverable from the chain.** The substrate isn't bolted on top of the operating system; the substrate _is_ the operating system.

The result is a machine whose lived experience is fully captured. From the moment PID 1 starts running, every meaningful event becomes a chain fact: every process spawn, every file mutation, every network connection, every user action, every hardware change. The chain holds the truth. Projections cache current state for fast access. Snapshots let boot resume quickly. Replay reconstructs the past exactly. Audit is built in, not bolted on.

---

## Why This Is Possible

The substrate that makes this work has already been built and verified. TreeOS as it currently exists — as a JavaScript runtime — proves out the core architectural primitives:

- Beings, spaces, matter as first-class world primitives.
- Acts producing facts that seal atomically on hash-chained reels.
- Projections derived from facts via deterministic reducers.
- Single-writer doctrine preventing concurrent corruption.
- Able-flow conditional behavior reading the world state.
- Replay-from-genesis as a first-class capability.

These properties don't just enable a clean application substrate. They are _exactly the properties an operating system needs_ in order to do what current operating systems struggle with. The architecture wasn't designed for this — but it falls out for free because the substrate was designed honestly to begin with.

Moving from "TreeOS hosts beings inside a JavaScript runtime" to "TreeOS is the operating system that hosts every process as a being" is not a paradigm shift. It's the same architecture applied at machine scale, with the kernel as plumbing rather than as the master.

---

## What Gets Tracked, In Full

### Every Process Is a Being

This is the deepest commitment of the full vision. When TreeOS is PID 1, every userspace process the kernel spawns becomes a being in the world.

When a process starts, the supervisor stamps a `process:born` fact on a system reel. The new process gets its own reel — a chain of every event that happens to it. The process's state (open file descriptors, memory mapping, working directory, signal mask, scheduling priority) projects onto its being row's qualities. The process is no longer an opaque kernel structure — it is an addressable being in the TreeOS world, with a name, a lineage, and a complete recorded history.

A web server starting up: a being. A user's terminal session: a being. A background daemon: a being. Each has its own reel, its own able, its own connections to other beings. When the web server forks worker processes, those workers are beings minted by the web server being — they inherit lineage from their parent in the same minting tree that already exists for TreeOS beings today.

This means:

- **Every process can be SEE'd**: you ask the world for the state of process 1247 the way you'd ask about any being.
- **Every process can be addressed in IBP**: you can DO actions on it (send signals as DO acts, change its priority, kill it).
- **Every process has a able**: the able determines what it's allowed to access (which files, which network resources, which other processes), encoded as canSee/canDo/canSummon permissions.
- **Every process is replayable**: you can walk the chain and reconstruct what any process did at any point.
- **Every process has identity that persists**: when a process restarts after a crash, the substrate can either give it a fresh being (clean slate) or continue the previous being (state-resuming behavior).

Linux's traditional process model is rebuilt as TreeOS's beings model. The kernel's view (struct task_struct) becomes implementation detail; the world's view (a being with qualities and a reel) becomes the primary interface.

### Every File Is Matter

Filesystems become spaces. Files become matter within those spaces. Directories are sub-spaces. The filesystem hierarchy maps to TreeOS's space hierarchy with the kernel's mount tree as the seed.

Every file operation generates a fact. Opening a file: `file:opened`. Writing bytes: `file:wrote`. Closing: `file:closed`. Truncating: `file:truncated`. Renaming: `file:moved`. Deleting: `file:deleted`. The chain captures every interaction.

This means:

- **Every file change has provenance**: not "this file was modified at 14:32" but "process 1247 (running as user tabor in able docker-build) wrote 4096 bytes to /etc/nginx.conf at 14:32:17.423 with this content hash."
- **File history is intrinsic**: you don't need git for files because the chain remembers every version. SEE the file at any past timestamp; replay reconstructs the content from the write facts.
- **Permission violations are facts**: when a process tries to access a file it can't, the substrate stamps `file:access-denied` with the full context. Security investigations have perfect logs by default.
- **Deduplication is automatic**: file content is stored by hash. Writing the same file content from a hundred different places stores it once. Saving an existing file unchanged doesn't write any content — just a fact saying "saved." Storage is efficient by default.

The actual byte content of files lives in a content-addressable store separate from the chain, referenced by hash. The chain holds the _facts about_ file content. Standard pattern; the same one already used in TreeOS for skin upload.

### Every Network Connection Is a Being

Network interfaces become spaces. Connections (TCP sockets, UDP flows, Unix domain sockets) become beings in those spaces, with their own reels recording every packet flow, every state transition, every error.

When a process opens a socket: a connection being is born. When the connection completes its handshake: a fact. When data flows: facts (potentially aggregated into "received N bytes from peer X" rather than per-packet, to keep storage tractable). When the connection closes: a fact.

This means:

- **Every connection has full traceability**: which process opened it, which remote peer it talked to, how much data flowed, when it closed.
- **Network firewall rules become able-based**: a process's able determines which IPs and ports it can canSummon (open connections to). No iptables; just able permissions.
- **Intrusion detection is intrinsic**: an unauthorized connection attempt is a fact. Aggregating "process X tried to connect to Y but was denied 50 times in 30 seconds" is just a fold query against the chain.
- **Network replay is possible**: in security incidents, walk the chain and see every connection that existed during the breach window. No need for separate packet capture infrastructure.

The actual byte content of network traffic is handled like file content: stored by hash if needed for replay, referenced from facts, optional based on capture policy. A high-fidelity machine captures everything; a low-overhead machine captures only metadata (connection establishment, byte counts, peers).

### Every Hardware Device Is Matter

Disks, GPUs, USB devices, network interfaces, displays, input devices — all matter in appropriate spaces. The kernel's `/sys` tree is enumerated at boot; each device becomes a matter row with qualities encoding its properties.

Hot-plug events produce facts. A USB drive plugged in: `device:created` with its identity. A disk encountering a read error: `device:fault`. A GPU under thermal load: `device:overheating` (projected from temperature reads). When hardware changes between boots, the substrate stamps reconciliation facts comparing what was there last time to what's there now.

This means:

- **Hardware inventory is automatic and historical**: "which monitor did I have plugged in last March?" is answerable by folding. "When did this drive start showing read errors?" is answerable by folding.
- **Hardware policy is able-encoded**: a process's able specifies which devices it can access. The webcam being can only be canSee'd by processes whose able permits it. No /dev permission tangles; just able gates.
- **Diagnostics are queries**: "show me every device that had a fault in the last week" is a fact query, not a log scrape.
- **Hot-plug behavior is in-world**: when a new disk is plugged in, a flow on some system being can trigger automatic actions (mount it, scan for filesystem, alert the user). The substrate's existing reactive machinery handles it.

### Every User Action Is an Act

Mouse clicks, keystrokes, window movements, menu selections — every user input is an act on a being (the input device) producing a fact. The desktop session is a being; the user's terminal is a being; the file explorer is a being. Each has a reel of everything the user did with it.

This means:

- **Activity history is intrinsic**: "what was I doing yesterday at 3pm?" is answerable by replaying the relevant reels.
- **Workflows can be replayed and shared**: an expert's workflow on a complex task is just a chain segment; replay it on your machine and see exactly what they did.
- **Accessibility tools become natural**: a screen reader for a blind user is a different _renderer_ of the same fact stream as the visual display. The world the user experiences is the same; the modality differs.
- **Privacy is configurable**: capture-level for user input is per-machine policy. A personal machine might capture everything (helpful for "find that file I had open last Tuesday"); a shared machine might capture only window-level events.

### Every Kernel Event Worth Recording Is a Fact

The kernel surfaces events through several interfaces: `inotify` for filesystem changes, `netlink` for network events, the `audit` subsystem for syscall-level visibility, `eventfd` for general kernel notifications. TreeOS as PID 1 attaches to these and projects them into chain facts.

Not every syscall becomes a fact (that would be ruinous for storage). The TreeOS supervisor makes editorial decisions: meaningful events become facts, repetitive low-information events get aggregated, and the policy is configurable per machine.

The chain becomes the unified log for everything the kernel knows happened. Linux currently has audit logs, system logs, application logs, kernel logs — all separate, all partial. TreeOS-as-OS has one chain.

---

## What This Makes Possible

### Replay From Boot

The chain begins when PID 1 starts. Every event from that millisecond forward is recorded. You can replay the machine's entire post-boot life:

- Watch processes spawn and die in the order they originally did.
- See files mutate in the sequence they originally mutated.
- Watch network connections form and dissolve.
- See user input arrive in the order it arrived.

Replay-from-genesis gives you a complete reconstruction. This isn't a "snapshot" mechanism that captures a moment; it's a _history_ that lets you traverse arbitrary time ranges.

For development: reproduce a bug exactly. The state that caused the bug is reconstructed from the chain. Not "approximately the conditions" — exactly the conditions.

For security: trace an intrusion forward from the moment of compromise. See every action the attacker took, what they accessed, what they exfiltrated. The audit isn't reconstructed from partial logs; it's walked from the actual chain.

For science: a research workstation's complete computational history is recoverable. Reproducibility crisis: solved at the OS level. The paper says "we ran this experiment"; the chain shows literally what happened, replayable on any TreeOS machine.

### True Audit By Default

Compliance frameworks (HIPAA, SOC 2, PCI-DSS, GDPR) require detailed audit trails. Currently this is met by enabling audit subsystems, configuring log retention, deploying SIEM tools, and accepting that audit is approximate and lossy.

In TreeOS, audit is the substrate. There's no "enable audit mode" — every event is captured by definition. Asking "who accessed this file" returns an exact answer. Asking "what was the system state when this breach happened" returns an exact reconstruction.

For organizations under heavy regulatory burden, this is transformative. Compliance becomes a query against the chain, not a forensic exercise.

### Process Isolation With Real Identity

Linux's permission model accumulated over decades. Users, groups, capabilities, namespaces, cgroups, SELinux, AppArmor, seccomp — each layer solving a specific issue, none giving a coherent permission model. The result is that "what is process 1247 allowed to do?" has no simple answer.

TreeOS-as-OS replaces this with the able model. Every process has a able; the able declares canSee/canDo/canSummon/canBe permissions. Permission questions become "what does this process's able permit?" — answerable in one lookup.

When a process forks, the child inherits its parent's able by default but can be configured (via the parent's flow logic) to take on a different able. A web server worker has a tightly scoped able; a system maintenance process has a broad able; a user shell has whatever able the user authorized for that session.

When a process tries to do something its able doesn't permit, it gets denied AND a fact is stamped. Security visibility is intrinsic. Misconfigurations produce visible failure modes (acts that get denied with explanations) rather than silent permission failures.

### Self-Programmable Behavior

The flow system already lets beings declaratively define their behavior conditional on world state. Applied to OS-level processes, this becomes a deeply powerful capability:

- A backup process's flow says "when disk usage exceeds 80%, switch to aggressive-cleanup able." No cron job, no monitoring daemon — the able-flow conditionally activates aggressive behavior based on world signals.
- A web server's flow says "when request rate exceeds threshold, stack rate-limited modifier." Behavior adapts to load without external configuration changes.
- A monitoring process's flow says "when error rate on service X exceeds threshold for 5 minutes, summon alert-being to notify operator." Alerting logic is in-world data, not in external systems.

The OS becomes self-aware in a meaningful sense: processes can adapt their behavior based on observed system state. And critically, this adaptation is _declarative and replayable_ — the same world conditions always produce the same behavioral response.

### Time Travel and Counterfactual Exploration

Because state is derived from facts, you can ask: "what would the system look like if these events had happened differently?" Re-run a portion of the chain with one fact altered and see what state emerges. Useful for security investigation ("what if this connection had succeeded?"), development ("what if this assertion had held?"), and education ("what if I had configured this differently?").

This is impossible on current operating systems. State is destroyed and overwritten constantly. TreeOS preserves it.

### Cross-Machine Coordination as Native Operation

Because IBP is the native protocol — not bolted on top of HTTP — multiple TreeOS machines can speak to each other natively. A being on machine A can SUMMON a being on machine B. Facts can reference matter on other machines. Spaces can span machines.

This makes distributed systems substantially simpler than current architectures. A web app running across three TreeOS machines isn't "three machines coordinating via HTTP"; it's one TreeOS world spread across three substrates, with the IBP protocol handling the distributed coordination semantics.

For cluster operators: the cluster is one world. For application developers: the application doesn't care which machine its beings live on. For users: the experience is unified across whatever physical infrastructure backs it.

### Hardware Migration Without State Loss

Because a machine's identity is its chain, you can migrate to new hardware by copying the chain. The new physical box reads the chain, reconstructs current state via projections, and resumes exactly where the old machine left off. Hardware change becomes a fact (new device IDs, different capabilities), but the world's continuity is preserved.

For users: upgrade your laptop and your computing environment moves with it, not just your files. Every running process resumes. Every window is in its place. Every connection re-establishes. The chain is the machine's soul; the hardware is the body, replaceable.

For data centers: machine replacement becomes trivial. Snapshot the chain, restore on new hardware, point traffic at it. Failover and disaster recovery become straightforward applications of the substrate's standard mechanics.

### Personal Computing With Memory

A TreeOS-as-OS personal computer remembers everything. Not in a creepy surveillance sense — the user controls capture policy — but in a useful "I can find anything that happened" sense.

"What was on my screen when I had that idea last Tuesday?" Replay your session.

"What did this configuration file look like before I edited it?" Fold the chain.

"Why did this application start consuming memory abnormally?" Walk the fact stream.

"When did I last visit this website?" Query the connection facts.

Current operating systems forget aggressively. TreeOS remembers honestly. For users who value their computing history, this is genuinely valuable. For users who don't, the policy is configurable.

### Educational and Forensic Power

A teacher demonstrates a complex computing task once on a TreeOS machine. The student's machine replays that chain segment and the same operations unfold step by step on the student's screen. Learning by example becomes literal.

A security researcher recovers a TreeOS chain from a compromised machine. They replay the breach in their own lab, watching every action the attacker took, every file accessed, every connection made. Attribution and analysis become exact.

A debugging session on a customer's machine: get their chain segment, replay locally, see the bug occur in your own environment. The "works on my machine" problem dissolves.

---

## The Technical Architecture

### Components

The full implementation has these primary components:

**The Rust Substrate.** A reimplementation of the current TreeOS substrate (currently in JavaScript) in Rust. The fold engine, the able-flow evaluator, the able composer, the projection layer, the seal mechanism. Translation, not reinvention.

**The Reel Storage Layer.** Append-only hash-chained logs on disk. Per-being reels, atomic multi-reel seals via a coordinator pattern. Built either on existing tools (SQLite WAL, RocksDB, sled) or custom for tighter control. Crash recovery is the hard part; everything else is straightforward.

**The Content-Addressable Store.** Binary content (files, network captures, asset bytes) stored by hash, deduplicated. References from the chain are hash-pointers. Cleanup happens by reference counting projected from the chain.

**The IBP Wire Protocol.** Bare binary IBP for TreeOS-native clients (machine-to-machine, native applications). The same envelope shape as the current JS implementation, but binary-encoded for efficiency. Encoded with MessagePack or CBOR. Length-prefixed framing. TLS for security. Designed for streaming where needed (SUMMON sequences) and request/response where appropriate (SEE queries).

**The Wrappers.** WebSocket wrapper translates between WS frames and IBP envelopes for web clients. HTTP wrapper for legacy compatibility (REST-style endpoints that proxy to IBP underneath). The substrate speaks one protocol; transports vary.

**PID 1 Implementation.** The Rust binary that the kernel hands off to after boot. Responsibilities: mount essential filesystems, bring up network interfaces, supervise child processes (the beings), reap zombies, handle signals, run the seed. Small (1000-2000 lines) but must be rock-solid.

**The Process Supervisor.** Spawns child processes representing beings, configures their isolation (cgroups for resources, namespaces for filesystem and network, seccomp for syscall restrictions). Routes IBP traffic between beings via Unix domain sockets or shared-memory ring buffers. Reaps and stamps facts on death.

**The Kernel Event Projector.** Reads from `inotify`, `netlink`, the audit subsystem, `/proc`, `/sys`. Translates kernel events into TreeOS facts. Stamps them on appropriate reels. Configurable policy for what gets captured.

**The Hardware Enumerator.** At boot and on hot-plug events, walks `/sys` and projects hardware into matter rows. Maintains the hardware-spaces tree. Stamps reconciliation facts on hardware changes between boots.

**The Boot Sequence.** Kernel boots → hands off to TreeOS PID 1 → PID 1 mounts essentials and brings up network → PID 1 starts the seed → seed loads most recent snapshot → seed replays any post-snapshot facts → world is alive → IBP listener accepts connections → portals can connect → user interacts with the world.

### Storage Strategy

Storage scales by tier:

**Hot tier** (SSD, fast access): last 24-48 hours of chain data, uncompressed. Current projections in memory and on disk. Active being state.

**Warm tier** (disk): last 30-90 days of chain data, compressed (zstd, typically 8-12x reduction). Projections at periodic snapshots.

**Cold tier** (archived, possibly offsite): older chain data, heavily compressed. Accessible but slow. Optional based on retention policy.

For a typical desktop machine: hot tier maybe 1-2 GB, warm tier maybe 10-30 GB, cold tier maybe 50-200 GB per year. Modest by modern standards. For a server: scale up proportionally; retention policy determines costs.

### Performance Considerations

Several places where performance matters and the architecture addresses:

**Fact write throughput.** Append-only sequential I/O is what SSDs and modern disks do best. Batched writes, in-memory buffering, periodic fsync. Achievable: 100K+ facts per second on consumer hardware, well above realistic OS event rates.

**Projection read latency.** Projections live in memory for hot access, with disk fallback. Standard database technique. Sub-millisecond lookups for current state.

**Network protocol overhead.** Binary IBP with efficient framing is comparable to gRPC or QUIC for throughput. The protocol isn't the bottleneck.

**Replay speed.** Cold replay (rebuilding state from genesis) is slow but rarely needed. Warm replay (rebuilding from last snapshot) is fast — typically a few seconds for thousands of facts.

**Storage growth.** Discussed above; manageable with proper tiering and compression.

### Security Model

Security in TreeOS-as-OS is fundamentally different from current systems:

- **Identity is first-class.** Every actor has an identity that traces through the chain. No anonymous actions.
- **Permissions are able-based and declarative.** Ables describe what their bearers can do. Permission checks happen at every act dispatch.
- **All security-relevant events are facts.** Failed auth attempts, denied permissions, unusual access patterns — all visible in the chain.
- **No privileged-vs-unprivileged divide in the substrate.** Privileged operations exist (writing to system spaces, modifying other beings' qualities) but they require explicit able permission. No setuid magic.
- **Replay enables exact post-incident analysis.** When an intrusion happens, you reconstruct exactly what occurred from the chain. No "we think the attacker did X" — exact answer.

Threat model considerations: physical access to the disk is still a vulnerability (encryption at rest is standard practice). Kernel-level compromise (rootkit) still bypasses substrate-level guarantees because the chain depends on the kernel for honest event delivery. These limits are fundamental — TreeOS-as-OS doesn't claim to solve them, just to make every layer above the kernel transparent and accountable.

---

## Build Phases

The work breaks into phases with clear deliverables at each stage:

### Phase 1: Substrate Port to Rust

Take the current JavaScript TreeOS substrate and reimplement in Rust. Module-by-module translation. Each module's tests must pass in Rust before moving to the next. End state: a Rust binary that can host the current TreeOS world identically to the JS version.

Scope: the substrate proper. Fold engine, able-flow evaluator, able composer, projection layer, seal mechanism, BE-op handlers, DO-op dispatch, fact storage interface (not yet implementing storage itself, just the interface).

Estimated effort: 2-3 months with focused work and AI-assisted translation. Most of the time is in careful translation; the architecture is already locked.

### Phase 2: Storage Layer

Implement reel storage, projection storage, snapshots, crash recovery. This is the hardest engineering work in the whole project because crash recovery has many edge cases.

End state: the Rust substrate has its own native storage; no longer depends on MongoDB.

Estimated effort: 2-3 months.

### Phase 3: IBP Wire Protocol

Spec the binary wire format. Implement encoder, decoder, framing, connection handling, authentication. Build the WebSocket wrapper for web compatibility.

End state: the Rust substrate listens for IBP connections natively; web clients connect via the wrapper; native clients (eventually) connect via bare IBP.

Estimated effort: 2 months.

### Phase 4: PID 1 and Basic OS Integration

Make the Rust substrate runnable as PID 1. Implement filesystem mounting, signal handling, basic process spawning. Boot a minimal Linux image where TreeOS is PID 1 and nothing else runs.

End state: a VM boots, kernel hands off to TreeOS, TreeOS runs as PID 1, listens on IBP. No beings-as-processes yet; everything still runs in the substrate process.

Estimated effort: 2 months.

### Phase 5: Beings as Processes

Implement the supervisor that spawns OS processes for beings, configures their isolation, routes IBP traffic between them. Migrate from "all beings in one process" to "each being in its own process."

End state: a machine boots, each TreeOS being is a real Linux process, they coordinate via IBP through the supervisor.

Estimated effort: 3-4 months.

### Phase 6: Kernel Event Projection

Implement readers for `inotify`, `netlink`, audit subsystem, `/proc`, `/sys`. Translate kernel events into TreeOS facts. Configurable capture policy.

End state: the machine boots and from PID 1 onward every meaningful kernel event becomes a fact on the chain. Files, processes, networks all reflect their state in the world.

Estimated effort: 3-4 months for v1; an ongoing area of refinement.

### Phase 7: Hardware as Matter

Walk `/sys` at boot; project hardware into matter rows. Handle hot-plug. Stamp reconciliation facts on changes between boots.

End state: every piece of hardware on the machine is addressable in the TreeOS world. Devices have qualities, ables can permit/deny access by device, hot-plug produces facts.

Estimated effort: 2-3 months.

### Phase 8: Polish and Real-World Use

Get it onto real hardware (Raspberry Pi, NUC, server). Find and fix the bugs that only show up outside of VMs. Tune performance. Document for users and contributors.

End state: a TreeOS machine you'd be willing to put in front of someone.

Estimated effort: 3-6 months.

**Total estimated effort: 18-24 months for a focused team of 2-3 systems programmers, longer for solo work with AI assistance.**

---

## What's Required to Start

Concrete prerequisites:

1. **The substrate stable as JS.** The OS work translates a stable substrate; if the substrate is still evolving rapidly, translation diverges from the moving target. Substrate must be in a "feature complete for v1" state first.

2. **Funding or contributor commitment.** This is real engineering effort. Either funded development time or sufficient contributor interest to sustain the work. The vision needs to be compelling enough to attract systems programmers.

3. **A wire protocol spec.** Before code, a written specification of binary IBP. This is a few weeks of design work that unblocks subsequent implementation.

4. **A test harness for the substrate.** Before translation begins, the JavaScript substrate needs comprehensive tests that codify expected behavior. The Rust port must pass the same tests. Without this, the port has no validation criterion.

5. **A target user.** Someone — internal team, friendly customer, research collaborator — who genuinely wants TreeOS-as-OS for a real use case. This grounds the work in actual requirements rather than aesthetic preferences.

---

## What This Architecture Does Not Solve

Honest limits worth naming:

**Kernel-level vulnerabilities still affect everything.** TreeOS-as-OS depends on the Linux kernel for hardware access, process isolation, and event delivery. A kernel exploit bypasses substrate-level guarantees. The architecture moves the trust boundary up to the kernel but doesn't eliminate it.

**Storage is not infinite.** Even with aggressive tiering and compression, chain data accumulates. Retention policy is required; some data eventually gets pruned or archived. The chain is not an "always recoverable forever" guarantee.

**Privacy implications are real.** A system that records everything carries privacy weight. Per-machine capture policy is necessary; users must control what their machine remembers. Default policies need careful thought.

**Hardware support is the kernel's job.** TreeOS doesn't write drivers. If the Linux kernel doesn't support some piece of hardware, TreeOS-as-OS on that hardware doesn't work. Compatibility tracks the kernel.

**Performance overhead is real.** Capturing every meaningful event has cost. Not enormous, but measurable. Some use cases (high-frequency trading, real-time control systems) may require selective capture or hybrid architectures. Most applications don't.

**Compatibility with existing software is partial.** Many existing Linux applications assume traditional process semantics, traditional filesystem semantics, traditional networking. TreeOS-as-OS can host them (Phase 5+) but they don't automatically benefit from the substrate's properties unless they're written to it. A legacy compatibility layer maintains them; full benefits require code that talks IBP natively.

---

## Why This Is Worth Building

Current operating systems are foundational software that everyone uses, that almost nobody questions, and that work in fundamentally the way they did decades ago. The opportunity to build an operating system with substantially different architectural properties — one where audit, replay, and rich identity are intrinsic rather than bolted on — comes along rarely.

The substrate that makes this possible exists. The work is engineering, not research. The market exists wherever current operating systems' lack of these properties causes real pain: compliance-heavy industries, security-conscious deployments, scientific computing, agent runtimes, anywhere that "what really happened on this machine" is a hard question.

This is not a hobbyist project pretending to be more. It is a real possible future direction for what an operating system can be, built on a substrate that's already proven the architectural primitives work. Someone will build something like this eventually. The question is whether TreeOS becomes that thing, or whether someone else does it differently in 10-15 years.

If you're a systems programmer reading this and find the vision compelling: contributions are welcome. The substrate is where current development is focused; the OS layer is what's next. There is real work ready to be done, with clear deliverables, on a foundation that already works.

The first contribution that matters: a wire protocol spec for binary IBP. Anyone with networking background and an interest in the architecture can read the current TreeOS code, understand the IBP envelope shape, and propose a binary encoding. That alone unblocks the next phase. After that, the Rust substrate port begins, and the operating system starts to take shape.

---

## How to Engage

If you've read this far and want to engage:

**As a contributor:** start by understanding the current substrate. Read FACTORY.md, MOMENT.md, able-manager.md. Run the JavaScript implementation locally. Build a small extension. Once you understand the model, you'll see where you can contribute. The OS work has clear phases; pick one.

**As a researcher or academic:** there are interesting research questions in the substrate itself (replay correctness under partial failures, optimal storage layouts for event-sourced systems, able composition algebras). The OS layer adds more (kernel integration patterns, process isolation strategies, performance characteristics of fact-driven schedulers).

**As a potential user:** the substrate is real and usable today. The OS layer is future. If you have a specific use case that would benefit from TreeOS-as-OS, talk to the project — your use case might be the one that justifies the work.

**As an investor or sponsor:** the substrate is the immediate value. The OS direction is a long-term strategic possibility. Both are worth knowing about; only the substrate is shippable today.

This document is the canonical statement of the vision. Subsequent designs build from here. When the OS layer eventually exists, this document will be the reason it does.
