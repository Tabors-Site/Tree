What's wrong, and the moves

1. ibp/ is not a "support folder." It's the fourth top-level concept — and it should be named like it.
   You wrote "the two support folders" and parked ibp/ and seedReality/ together. That's a fudge. seedReality/ is genuinely a host/runtime concern — it reaches the outside world. ibp/ is the verbs, the universal currency of every act in the system. The verbs are not support for the tenses; they are the thing the tenses are made of. SEE reads the present's fold of the past; DO/BE/SUMMON stamp the past via the present. Calling ibp/ "support" undersells it and groups it with unrelated infrastructure.
   Move: rename the section in your doc from "the two support folders" to two separate things — ibp/ is verbs, top-level peer to the tenses; seedReality/ is the runtime host, separately. No file moves, just stop calling them the same kind of thing.
2. materials/manifest.js is in the wrong tense.
   A manifest is a live in-memory collection sync — it watches things at runtime and updates child spaces as they change. That's not a definition of a kind; it's machinery the present runs. materials/ defines what kinds of facts can be stamped. manifest.js doesn't define a kind; it operates one.
   Move: materials/manifest.js → present/manifest.js (or present/manifests/ if it grows). The kinds it manages stay in materials/; the machinery that syncs them lives where machinery lives.
3. materials/seeds.js is on the edge — leave it, but know why.
   A seed is a plantable scaffold — a recipe for a multi-act batch. It defines a kind of starting state, which is genuinely materials-shaped (a definition of what can be). But it runs through the present. The right place is materials/ because the catalog of plantable things is a catalog of definitions, not a runtime. The act of planting runs through the present, which is correct today. Leave seeds.js where it is; this one's not a mismatch.
4. present/voices/llm/ is misplaced and mis-grouped.
   LLM cognition is not its own thing the present runs alongside the beats. It's the scripted-or-LLM cognition machinery that momentum (beat 3) calls into. Calling the folder voices/llm/ makes it look like a peer to the beats, and the name voices suggests there are multiple voices (scripted, LLM, future kinds) when really there's one thing — cognition — with current implementations.
   Two problems compound: defaultSummon.js (the scripted-role summon handler) is sitting inside voices/llm/ even though it's not LLM. That's the tell — the folder is misnamed.
   Move: present/voices/llm/ → present/cognition/llm/ and pull defaultSummon.js up to present/cognition/defaultSummon.js (it's scripted cognition, not LLM cognition). The folder name now says what it is: the machinery that produces a CognitionResult, with LLM as one implementation living in a subfolder. When scripted-cognition machinery grows (it will, with the dance + the growing being), it has a place: present/cognition/scripted/ peer to present/cognition/llm/.
5. present/orientation.js is in the right tense but at the wrong altitude.
   Orientation is a fold parameter (INNER-FOLD §1). It belongs to the fold, not the present at large. Sitting at present/ root makes it look like a peer of moment.js and knobs.js, but it's a knob of the fold specifically. The inner/outer classifier is also a fold-side concept (single-writer used as a classifier on ΔF shape, read at seal time).
   Move: present/orientation.js → present/beats/2-fold/orientation.js. Lives with the fold engine and the place-fold. The classifier may end up at present/beats/4-stamped.js instead (it's read at seal); pick by where the consumer lives. My read: orientation rides through the fold (consumed by foldPlace.js), classification is read at seal (consumed by 4-stamped.js). So orientation lives with the fold, and if the inner/outer classifier is a function rather than a parameter, it can be a tiny module at present/beats/4-stamped/innerOuter.js — but that's only if it grows. For now, both in 2-fold/ is fine; one home is better than two.
6. present/cognitionResult.js is at the wrong altitude too.
   It's the discriminated type contract that momentum produces and stamped consumes. It's not a present-wide concern; it's the beat-3-to-beat-4 handoff contract.
   Move: present/cognitionResult.js → present/beats/cognitionResult.js (alongside the beats it bridges) or present/cognition/cognitionResult.js (if you accept move #4 and want it grouped with the machinery that produces it). I'd take the second — it lives with cognition because that's what produces the result; stamped is the consumer and consumers don't own type contracts. So: present/cognition/cognitionResult.js.
7. present/replies.js and present/session.js are correctly placed; the doc framing was the problem.
   You'd flagged earlier that replies and session felt like they were jammed into intake. They're now at present/ root, which is right — replies is the outbound direction of the present, session is per-being machinery the present uses. Leave them. (I'm noting this so you don't move them speculatively while doing the rest.)
8. past/act/inboxProjection.js and threadsProjection.js are arguably mis-placed.
   These are cross-cutting projections — they're maintained by the fold (present-side), they're caches for indexability (their authority is the facts), and they're shaped per-projection-concern not per-aggregate. Putting them in past/act/ ties them to the Act primitive, but inbox-projection is open summons across all beings, not "the act's projection." It's a cross-cutting view of summon facts.
   There's a real choice here:

(a) Leave them in past/act/ — pragmatic, they relate to Acts conceptually (open summons = acts not yet closed).
(b) Move to past/projections/ — truthful naming, says "the cross-cutting projections live here, separate from primitives."

I'd take (b). It also makes room for the open-projection rebuild fix you have outstanding (the one where summons re-open on rebuild because the close event isn't a fact) — having a dedicated past/projections/ folder makes that fix obviously projection-layer work, not act-primitive work.
Move: past/act/inboxProjection.js and inboxProjectionFold.js → past/projections/inbox/; same for threads → past/projections/threads/. past/act/act.js stays (it's the Act primitive). 9. past/reel/appendLock.js — flag, don't move.
This is fine where it is, but tag it: it's in-process only. Cross-process locking is a real gap (you've named it in pending items). Leave the file, leave the location, but add a comment header that the lock is in-process only and the cross-process variant lives elsewhere when built. Just so a future reader doesn't assume single-writer is enforced cross-process by this file. 10. Beats are great. The numbering is great. Keep.
1-assign.js, 2-fold/, 3-momentum.js, 4-stamped.js — ls-orderable, doctrinally aligned, no movement needed. 11. The intake/wakes/replies/session split you already chose stands.
Earlier we decided: intake/ keeps arrivals + scheduler + transportAct (intake proper); wakes/ is sources of intake (sibling); replies.js is outbound; session.js is machinery. Your doc reflects this. Done correctly.
The final shape
seed/
├── present/ THE PRESENT — the live machine
│ ├── moment.js conductor; walks the four beats
│ ├── beats/ the four beats, visibly ordered
│ │ ├── 1-assign.js
│ │ ├── 2-fold/
│ │ │ ├── foldEngine.js
│ │ │ ├── foldPlace.js
│ │ │ ├── reel.js
│ │ │ ├── reelChains.js
│ │ │ └── orientation.js ← MOVED from present/orientation.js
│ │ ├── 3-momentum.js
│ │ └── 4-stamped.js
│ ├── cognition/ ← RENAMED from voices/, broadened
│ │ ├── cognitionResult.js ← MOVED from present/cognitionResult.js
│ │ ├── defaultSummon.js ← MOVED up from voices/llm/
│ │ └── llm/ LLM cognition apparatus (one implementation)
│ │ ├── runTurn.js
│ │ ├── loop.js
│ │ ├── tools.js
│ │ ├── connect.js
│ │ ├── resolution.js
│ │ ├── ssrf.js
│ │ ├── call.js
│ │ ├── assemble.js
│ │ ├── compress.js
│ │ └── seeResolvers.js
│ ├── intake/
│ ├── wakes/
│ ├── replies.js
│ ├── session.js
│ ├── manifest.js ← MOVED from materials/manifest.js
│ ├── roles/
│ └── knobs.js
│
├── past/ THE PAST — durable record
│ ├── act/
│ │ └── act.js (just the primitive now)
│ ├── fact/
│ │ ├── fact.js
│ │ ├── facts.js
│ │ ├── hash.js
│ │ └── verifyReel.js
│ ├── reel/
│ │ ├── reelHead.js
│ │ ├── reelHeads.js
│ │ └── appendLock.js (in-process only; flagged)
│ └── projections/ ← NEW: cross-cutting projection caches
│ ├── inbox/
│ │ ├── inboxProjection.js ← MOVED from past/act/
│ │ └── inboxProjectionFold.js ← MOVED from past/act/
│ └── threads/
│ ├── threadsProjection.js ← MOVED from past/act/
│ └── threadsProjectionFold.js ← MOVED from past/act/
│
├── materials/ THE POSSIBLE — kinds of fact that can be
│ ├── being/
│ ├── space/
│ ├── matter/
│ ├── qualities.js
│ ├── reducerHelpers.js
│ ├── reducers.js
│ ├── projections.js
│ ├── seeds.js
│ └── doCeiling.js
│
├── ibp/ THE VERBS — top-level peer, not "support"
│ ├── verbs.js
│ ├── verbs/
│ ├── address.js
│ ├── resolver.js
│ ├── authorize.js
│ ├── descriptor.js
│ ├── discovery.js
│ ├── operations.js
│ ├── protocol.js
│ ├── pushChannel.js
│ └── stanceProperties.js
│
└── seedReality/
