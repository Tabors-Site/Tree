# Phase 0 cut list (result)

This file is the complete inventory of every in-world site in the TreeOS seed, each cut into one of two categories by a single test applied at every site: does this code carry world-specific meaning a reality could decide differently (**word**), or is it the generic engine machinery that runs acts and keeps the chain the same way for every reality (**host**)?

**Counts:** 580 sites — 201 word, 379 host. Per slice: see-op: 30 · DO-op: 75 · BE-op: 25 · NAME-op: 11 · flow: 18 · type: 20 · seed: 5 · genesis: 4 · auth: 16 · host: 376.

## The cut (every in-world site)

### see-op (30)

| File | Symbol | Tag | Reason |
| --- | --- | --- | --- |
| `reality/seed/ibp/descriptor.js` | buildDiscovery | **word** | Discovery payload (roles, templates, matter types) is the reality's self-description. |
| `reality/seed/ibp/descriptor.js` | buildNameDescriptor + buildNameTree + lastOpenBeingForName | **word** | Name and being biography shapes are world-semantics for identity presentation. |
| `reality/seed/ibp/descriptor.js` | buildPlaceDescriptor | **word** | Descriptor is the world's shaped view — what the reality chooses to show from a position. The shape itself (children, beings, matters, qualities) is world semantics. |
| `reality/seed/ibp/resolver.js` | resolveStance | **word** | Stance resolution bridges parsing (grammar) to world substrate — the WHAT a parsed address points at (space/being/role).  A different reality has different spaces and beings. |
| `reality/seed/materials/matter/classify.js` | classify-matter SEE operation + registration | **word** | The meaning of classification as a readable world query - agents ask 'what would this become' |
| `reality/seed/materials/publish/ops.js` | capture-being SEE op | **word** | SEE operation for capturing being's identity-preserving graft - world perception (authority-gated) |
| `reality/seed/materials/publish/ops.js` | capture-template DO op | **word** | SEE operation declaration registering a named perception - world act exposed via the seed surface |
| `reality/seed/materials/publish/ops.js` | clones SEE op | **word** | SEE operation for clone discovery/catalog - world perception surface |
| `reality/seed/present/intake/inboxOps.js` | registerSeeOperation my-inbox | **word** | SEE op declaration: reality-specific behavior (the inbox query exposed to roles and UI); agents could extend/override |
| `reality/seed/present/roles/arrival/role.js` | arrivalRole | **word** | Arrival's role declaration: required cognition (scripted), canSee (arrival-view), canSummon (mate at cherub, federation-manager), canBe (birth/connect/release). The WHAT: anonymous visitor permissions and contact surface. Becomes .word role declaration. |
| `reality/seed/present/roles/branch-manager/role.js` | branchManagerRole | **word** | Role declaration: defines branch-manager as scripted delegate for divergent-world creation and management; declares canDo (create-branch) and permissions (do only) |
| `reality/seed/present/roles/cherub/role.js` | cherubRole | **word** | Cherub's role declaration: required cognition (scripted), canDo (grant-role:human/global), canSummon (mate as receiver), canBe (birth/connect/release). The WHAT: cherub's capability surface and dispatch rules. Becomes .word role declaration. |
| `reality/seed/present/roles/federation-manager/handlers.js` | handleIncomingIntent | **word** | Incoming SUMMON dispatcher: classifies federation intents (offer-template, accept-template, reject-template, deliver-template, deliver-being, request-template, template-result) and routes; defines the meaning and rules of each intent |
| `reality/seed/present/roles/federation-manager/ops.js` | federation-status | **word** | SEE operation: reads negotiation queues (pending offers, requests, outbound, completed); operator-gated, defines federation state visibility |
| `reality/seed/present/roles/federation-manager/role.js` | federationManagerRole | **word** | Role declaration: defines federation-manager's capabilities (canSee, canDo, canSummon), permissions, and scripted cognition model for peer-reality transfers |
| `reality/seed/present/roles/llm-assigner/ops.js` | llm-chain SEE operation (WHAT) | **word** | The semantics of LLM resolution chain preview: a being can query which LLM will be used for a given receiver/actor/role triple |
| `reality/seed/present/roles/llm-assigner/ops.js` | llm-connections SEE operation (WHAT) | **word** | The semantics of LLM connection introspection: a being can read their registered connections and current slot assignments |
| `reality/seed/present/roles/llm-assigner/role.js` | llmAssignerRole | **word** | Role definition: describes LLM-configuration delegate; respondMode, permissions (be), triggerOn - declares what the delegate is and what it can do |
| `reality/seed/present/roles/merge-mediator/role.js` | mergeMediatorRole | **word** | Role declaration: defines merge-mediator as LLM helper for conflict resolution; declares permissions (see branches, do state-setting), prompt, and docs for handling merge conflicts per-reel |
| `reality/seed/present/roles/merge-mediator/role.js` | REALITY_MANAGER_PROMPT | **word** | System prompt: defines cognitive behavior and strategy for resolving merge conflicts; the rules the LLM follows are reality-specific |
| `reality/seed/present/roles/public-commons/role.js` | publicCommonsRole | **word** | Visitor role template declaration: name, canSee, canDo (move, set-coord, create-space, create-matter), canSummon, acquisition policy - defines public access pattern |
| `reality/seed/present/roles/reality-manager/role.js` | REALITY_MANAGER_PROMPT | **word** | System prompt: defines cognitive behavior for managing reality-level state on operator behalf; rules specific to how each reality is configured and governed |
| `reality/seed/present/roles/reality-manager/role.js` | realityManagerRole | **word** | Role declaration: defines reality-manager as LLM-driven place manager with canSee (identity, config, peers, extensions, tools, roles, operations), canDo (set/delete config, install/uninstall/enable/disable extensions), and system prompt |
| `reality/seed/present/roles/role-finder/role.js` | roleFinderRole | **word** | LLM helper role definition: canSee (roles, tools, operations), canDo (set-role, delete-role), system prompt - defines the helper's capabilities and personality |
| `reality/seed/present/roles/role-manager/role.js` | roleManagerRole | **word** | Role capability declaration: name, permissions, canDo list, respondMode, triggerOn - defines agent's capabilities |
| `reality/seed/present/roles/websocket-pool/ops.js` | connections (SEE op) | **host** | A SEE operation handler that reads live socket.io state and projects it. The how—reading external state—is host infrastructure |
| `reality/seed/present/roles/angel/role.js` | angel.canSee | **word** | Reality-specific wide perception: angel can see anything (wildcard), part of super-sudo capability grant |
| `reality/seed/present/roles/birther/role.js` | birther.canSee | **word** | Reality-specific perception rule: birther perceives place block to make mate-request decisions (inner-face doctrine) |
| `reality/seed/present/roles/global/role.js` | global.canSee | **word** | Reality-specific baseline perception: authorizes seeing place, classify-matter, verify-reel, chain-root (authorization floor) |
| `reality/seed/present/roles/human/role.js` | human.canSee | **word** | Reality-specific broad perception: humans see everything (wildcard) in this reality's authorization model |

### DO-op (75)

| File | Symbol | Tag | Reason |
| --- | --- | --- | --- |
| `reality/seed/ibp/setRender.js` | set-render WHAT | **word** | Sensory write act: declare how matter/space/being renders across all sensory channels; world-specific perception rule |
| `reality/seed/materials/matter/matters.js` | createMatter function + field validation | **word** | The what of matter creation (when to allow, basic semantics) before handler |
| `reality/seed/materials/matter/ops.js` | create-matter operation | **word** | The meaning and rules of matter creation - agents create matter, type classification, content validation are world behaviors |
| `reality/seed/materials/matter/ops.js` | end-matter operation | **word** | The meaning of matter ending (soft-delete, chain-disconnect) - a world verb with semantics |
| `reality/seed/materials/matter/ops.js` | purge-content operation | **word** | The meaning: explicit content deletion when accidentally posted - world-level scalpel with audit |
| `reality/seed/materials/matter/ops.js` | rename-matter operation | **word** | Named intent for matter renaming distinct from bare field write - a world-level act with audit trail |
| `reality/seed/materials/matter/ops.js` | set-matter operation | **word** | The meaning and rules of matter mutation - agents write fields, qualities, coordinates - world semantics |
| `reality/seed/materials/modelOp.js` | assertMaySetModel | **word** | Set-model authorization — THE RULE governing who may set what model (being-self, matter-author, space-owner) is WORLD behavior |
| `reality/seed/materials/modelOp.js` | ensureSkinsSpace | **word** | Skins space bootstrap — The rule that models catalog in a species-local space is WORLD behavior (every reality may have different render hierarchy) |
| `reality/seed/materials/modelOp.js` | resolveModelMatter | **word** | Model matter resolution — Part of the set-model rule (model must exist, be type=model, have live bytes) is world specification |
| `reality/seed/materials/modelOp.js` | setModelHandler | **word** | Set-model operation — CORE world operation defining how beings acquire bodies (the WHAT they become, not the storage HOW) |
| `reality/seed/materials/moveOp.js` | moveHandler | **word** | Move operation logic — THE RULES defining what moves are valid and where (coord clamp, self-move check, bounds validation) are world behavior |
| `reality/seed/materials/name/keyOps.js` | key-export operation semantics (who can export what key) | **word** | The meaning of key export (identity-initiated, auth-gated, audit-recorded) |
| `reality/seed/materials/portalOp.js` | formPortalHandler | **word** | Form-portal operation — CORE world operation defining how portals are created and what they point to |
| `reality/seed/materials/portalOp.js` | IBPA_RE | **word** | Portal target address regex — THE RULE defining valid foreign IBPA addresses a portal can open onto |
| `reality/seed/materials/publish/ops.js` | capture-graft DO op | **word** | DO operation for capturing full reality as seed - world act via the seed surface (heaven-gated authority) |
| `reality/seed/materials/publish/ops.js` | graft-being DO op | **word** | DO operation for importing a being-graft into live reality - world act (mutation, heaven-gated) |
| `reality/seed/materials/publish/ops.js` | plant-template DO op | **word** | DO operation for applying a clone bundle into a subtree - world act (mutation) via the seed surface |
| `reality/seed/materials/publish/ops.js` | plant-template-by-name DO op | **word** | DO operation for grafting registered clone by name - world act via seed surface |
| `reality/seed/materials/space/ops.js` | create-space operation | **word** | The meaning of space creation - agents bring spaces into existence, a world verb |
| `reality/seed/materials/space/ops.js` | end-space operation | **word** | The meaning of space ending (chain-disconnect) - a world verb |
| `reality/seed/materials/space/ops.js` | set-space operation | **word** | The meaning of space mutation - agents write fields, a world verb |
| `reality/seed/materials/space/spaces.js` | Space operations (createSpace, deleteSpace, moves, retype) | **word** | Space tree semantics and creation logic - world behavior |
| `reality/seed/present/roles/acquisition.js` | DEFAULT_ACQUISITION, normalizeAcquisition | **word** | Defines the acquisition contract (asked/grabbed/autoOnEntry policies); world semantics for how roles are distributed |
| `reality/seed/present/roles/acquisitionOps.js` | ask-role (registerOperation) | **word** | A DO operation: beings ask for roles. The rules and act semantics are world; what this reality allows |
| `reality/seed/present/roles/acquisitionOps.js` | take-role (registerOperation) | **word** | A DO operation: beings take roles. The rules and act semantics are world; what this reality allows |
| `reality/seed/present/roles/branch-manager/ops.js` | create-branch | **word** | DO operation: forks a new world from a past point of an existing branch, inheriting history up to anchor; defines branching rules and fork semantics |
| `reality/seed/present/roles/branch-manager/ops.js` | delete-branch | **word** | DO operation: soft-deletes a branch; defines deletion rules (deleted branches refuse DO/BE/SUMMON, SEEs work, undelete is always available) |
| `reality/seed/present/roles/branch-manager/ops.js` | delete-pointer | **word** | DO operation: removes named pointer from registry; defines pointer deletion rules and reserved-pointer protection |
| `reality/seed/present/roles/branch-manager/ops.js` | merge-branches | **word** | DO operation: combines two source branches into a third whose parent is their common ancestor; defines merge semantics (third branch inherits ancestor state, source branches stay immutable, reconciliation via normal ops with params._merge) |
| `reality/seed/present/roles/branch-manager/ops.js` | pause-branch | **word** | DO operation: toggles Branch row paused state; defines freeze/thaw rules (paused branches refuse DO/BE/SUMMON, SEEs work for inspection) |
| `reality/seed/present/roles/branch-manager/ops.js` | set-pointer | **word** | DO operation: assigns named pointer (e.g. #main, #prod) to a canonical branch path; defines pointer semantics (name → path mapping, pointer algebra) |
| `reality/seed/present/roles/branch-manager/ops.js` | undelete-branch | **word** | DO operation: reverses soft deletion; defines resurrection rules |
| `reality/seed/present/roles/branch-manager/ops.js` | unpause-branch | **word** | DO operation: toggles paused state off; defines reactivation rules for branches |
| `reality/seed/present/roles/federation-manager/handlers.js` | handleOfferTemplate\|handleAcceptTemplate\|handleRejectTemplate\|handleDeliverTemplate\|handleDeliverBeing\|handleRequestTemplate\|handleTemplateResult | **word** | Intent handlers: implement negotiation state transitions and payload interpretation for federation protocol; define what each intent means |
| `reality/seed/present/roles/federation-manager/ops.js` | accept-template | **word** | DO operation: operator approves an incoming offer-template; defines acceptance rules in federation negotiation |
| `reality/seed/present/roles/federation-manager/ops.js` | fulfill-request | **word** | DO operation: operator approves an incoming pull request, pushing the requested template back to requester; defines pull fulfillment rules |
| `reality/seed/present/roles/federation-manager/ops.js` | offer-being | **word** | DO operation: operator grafts a being (identity + chain, verbatim) to a peer reality one-shot; defines being-graft federation rules |
| `reality/seed/present/roles/federation-manager/ops.js` | offer-template | **word** | DO operation: operator initiates outbound push of a template subtree to a peer reality; defines negotiation protocol rules |
| `reality/seed/present/roles/federation-manager/ops.js` | refuse-request | **word** | DO operation: operator refuses an incoming pull request; defines request refusal rules in federation |
| `reality/seed/present/roles/federation-manager/ops.js` | reject-template | **word** | DO operation: operator refuses an incoming offer-template; defines rejection rules in federation negotiation |
| `reality/seed/present/roles/federation-manager/ops.js` | request-template | **word** | DO operation: operator initiates outbound pull of a template from a peer reality; defines pull negotiation rules |
| `reality/seed/present/roles/host.js` | hostRoleAt | **word** | World act: makes a space the host of a role by writing to qualities.roles[name]. A reality's role-installation act |
| `reality/seed/present/roles/llm-assigner/ops.js` | add-llm operation (WHAT) | **word** | The semantics of adding an LLM connection: an authenticated being can register a new LLM service endpoint; auto-binding to default slot on first connection |
| `reality/seed/present/roles/llm-assigner/ops.js` | assign-slot operation (WHAT) | **word** | The semantics of slot binding: a being associates a connection with a role-specific slot or default slot |
| `reality/seed/present/roles/llm-assigner/ops.js` | delete-llm operation (WHAT) | **word** | The semantics of connection removal: a being can remove a registered LLM connection; cascading slot cleanup follows |
| `reality/seed/present/roles/llm-assigner/ops.js` | llm-assigner:complete-tutorial operation (WHAT) | **word** | The semantics of tutorial completion: tutorial matter is consumed when finished |
| `reality/seed/present/roles/llm-assigner/ops.js` | llm-assigner:save-playback operation (WHAT) | **word** | The semantics of video playback tracking: tutorial matter carries playback position that persists across reloads |
| `reality/seed/present/roles/llm-assigner/ops.js` | llm-assigner:start-tutorial operation (WHAT) | **word** | The semantics of tutorial spawning: a matter is placed in a space, idempotent, carries the tutorial marker - defines what 'starting the tutorial' means |
| `reality/seed/present/roles/llm-assigner/ops.js` | set-being-llm operation (WHAT) | **word** | The semantics of being-level LLM configuration: a being configures per-role slots and force flags for their own identity |
| `reality/seed/present/roles/llm-assigner/ops.js` | set-reality-llm operation (WHAT) | **word** | The semantics of reality-level LLM configuration: heaven authority can set default LLM slots and force flags for the entire place |
| `reality/seed/present/roles/llm-assigner/ops.js` | set-space-llm operation (WHAT) | **word** | The semantics of space-level LLM configuration: a space owner can configure LLM slots and force flags for their space |
| `reality/seed/present/roles/merge-mediator/ops.js` | registerMergeMediatorOps | **word** | V1 entry point: defines that mediator uses normal state-setting ops (set-being, set-matter, set-space) WITH params._merge metadata for forensic audit; the metadata meaning is world-level |
| `reality/seed/present/roles/role-manager/ops.js` | delete-role operation (WHAT) | **word** | The semantics of role deletion: roles can be removed if unreferenced (or force-deleted); reference tracking rules |
| `reality/seed/present/roles/role-manager/ops.js` | set-role operation (WHAT) | **word** | The semantics of role authoring: a being can declare a new role with canSee/canDo/canSummon/canBe; validation rules for role names and cognition types are world rules |
| `reality/seed/materials/being/credentialOps.js` | credential-attach | **word** | DO op: parent re-asserts authority, world relationship behavior |
| `reality/seed/materials/being/credentialOps.js` | credential-detach | **word** | DO op: being declares independence, world relationship behavior |
| `reality/seed/materials/being/credentialOps.js` | credential-read | **word** | DO op: read being credential, world authority + audit behavior |
| `reality/seed/materials/being/credentialOps.js` | credential-reset | **word** | DO op: re-mint being credential, world authority behavior |
| `reality/seed/materials/being/identity/birth.js` | _anointGlobal | **word** | Stamps grant-role fact for global baseline, world single-gate doctrine |
| `reality/seed/materials/being/identity/birth.js` | _inheritParentRoles | **word** | Stamps grant-role facts inheriting parent roles, world dual-parent doctrine |
| `reality/seed/materials/being/identity/birth.js` | birthBeing | **word** | Mints new Being via be:birth Fact, world identity creation logic with inheritation + role inheritance |
| `reality/seed/materials/being/inheritationOps.js` | grant-inheritation | **word** | DO op: grant inheritation point, world delegation behavior |
| `reality/seed/materials/being/inheritationOps.js` | revoke-inheritation | **word** | DO op: revoke inheritation point, world delegation behavior |
| `reality/seed/materials/being/ops.js` | add-llm-connection | **word** | DO op: register LLM connection, world cognition configuration |
| `reality/seed/materials/being/ops.js` | assign-llm-slot | **word** | DO op: bind connection to slot, world cognition orchestration |
| `reality/seed/materials/being/ops.js` | delete-llm-connection | **word** | DO op: remove LLM connection, world cognition behavior |
| `reality/seed/materials/being/ops.js` | end-being | **word** | DO op stub: symmetric identity ending (impl on BE verb) |
| `reality/seed/materials/being/ops.js` | grant-role | **word** | DO op: grant role to being, world authorization behavior |
| `reality/seed/materials/being/ops.js` | revoke-role | **word** | DO op: revoke role from being, world authorization behavior |
| `reality/seed/materials/being/ops.js` | set-being | **word** | DO op: write Being field or qualities, world behavior agents perform |
| `reality/seed/materials/being/ops.js` | update-llm-connection | **word** | DO op: modify LLM connection, world cognition behavior |
| `reality/seed/present/roles/angel/role.js` | angel.canDo | **word** | Reality-specific super-sudo actions: can do anything and grant any role (recursive primitive); defines heaven-class authority |
| `reality/seed/present/roles/global/role.js` | global.canDo | **word** | Reality-specific baseline action floor: defines what every authenticated being can do (move, coordinate, ask-role, create-matter:model, set-model) |
| `reality/seed/present/roles/human/role.js` | human.canDo | **word** | Reality-specific broad action capability: humans can perform any action (wildcard) in this reality's authorization floor |

### BE-op (25)

| File | Symbol | Tag | Reason |
| --- | --- | --- | --- |
| `reality/seed/ibp/beOps.js` | BE_OPS.birth | **word** | Identity lifecycle act: a being's genesis into the world; declaration of birth bond to Name and cherub role |
| `reality/seed/ibp/beOps.js` | BE_OPS.connect | **word** | Identity lifecycle act: binding a Name's session to drive a being; world-specific being-to-Name bond rule |
| `reality/seed/ibp/beOps.js` | BE_OPS.death | **word** | Identity lifecycle act: closing a being's lifecycle; world-specific cherub death ceremony |
| `reality/seed/ibp/beOps.js` | BE_OPS.release | **word** | Identity lifecycle act: releasing a Name's session from a being; world-side role closure rule |
| `reality/seed/ibp/beOps.js` | BE_OPS.switch | **word** | Identity lifecycle act: changing a session's branch on a being; world-specific session branch rule |
| `reality/seed/ibp/beOps.js` | BE_OPS.truename | **word** | Identity lifecycle act: hand being to a Name by setting trueName; world-specific Name reassignment rule |
| `reality/seed/ibp/verbs/be.js` | birth operation path | **word** | Birth operation (self-birth, birther-path, cherub bootstrap); reality-specific being-creation rule |
| `reality/seed/ibp/verbs/be.js` | connect operation path | **word** | Connect operation (cherub credential/inherit modes); reality-specific identity-binding rule |
| `reality/seed/ibp/verbs/be.js` | death operation path | **word** | Death operation; reality-specific being-closure rule |
| `reality/seed/ibp/verbs/be.js` | release operation path | **word** | Release operation; reality-specific session-clearing rule |
| `reality/seed/ibp/verbs/be.js` | switch operation path | **word** | Switch operation (per-session branch change); reality-specific being-world-switch rule |
| `reality/seed/ibp/verbs/be.js` | truename operation path | **word** | Truename operation (reassign being's Name identity); reality-specific identity-transfer rule |
| `reality/seed/ibp/verbs/see.js` | maybeAutoGrantOnEntry | **word** | Acquisition rule (autoOnEntry); reality-specific role-grant behavior on entry |
| `reality/seed/present/roles/cherub/role.js` | _registerHumanWithFreshHome | **word** | Compound birth semantics: create home space, birth being, set owner, grant roles, record lineage. The WHAT: the registration flow's step sequence and role-grant doctrine (human role + angel anoint on first being). Becomes .word action sequence / compound act. |
| `reality/seed/present/roles/cherub/role.js` | birthHandler | **word** | BE:birth operation semantics — what it means for a being to be born (identity minting, parent binding, home creation, role anointing). The WHAT: being-tree lineage, password setup, first-being bootstrap logic. Becomes a .word act declaration + handler chain. |
| `reality/seed/present/roles/cherub/role.js` | cherubBeOps | **word** | BE operation registry: birth, connect, release, switch, death, truename. Each carries description, args schema, and handler. The structure itself — op definitions, arg validation, authorization gates — is world; the manifest of what a reality supports. Becomes .word op declarations. |
| `reality/seed/present/roles/cherub/role.js` | connectHandler | **word** | BE:connect operation semantics — eligibility rules (descendant gate, father-admit, owned connect, credential-based bind). The WHAT: who can inhabit what being under what conditions. Becomes .word act declaration + predicate logic. |
| `reality/seed/present/roles/cherub/role.js` | deathHandler | **word** | BE:death operation semantics — a being's lifecycle closes, no future ops accepted. The WHAT: finality contract. Becomes .word act declaration. |
| `reality/seed/present/roles/cherub/role.js` | releaseHandler | **word** | BE:release operation semantics — unbind a session, drop being access, reset to homeBranch. The WHAT: the binding contract and its dissolution. Becomes .word act declaration. |
| `reality/seed/present/roles/cherub/role.js` | switchHandler | **word** | BE:switch operation semantics — per-session branch seating eligibility (existence gate, death gate, orphan reel gate). The WHAT: when a session can move to a branch. Becomes .word act declaration + predicates. |
| `reality/seed/present/roles/cherub/role.js` | truenameHandler | **word** | BE:truename operation semantics — hand a being to a Name, re-point identity. The WHAT: being ownership transfer. Becomes .word act declaration. |
| `reality/seed/present/roles/angel/role.js` | angel.canBe | **word** | Reality-specific wide BE capability: angel can perform any BE operation (wildcard) |
| `reality/seed/present/roles/birther/role.js` | birther.canBe | **word** | Reality-specific birth capability: birther can perform birth operations (births vessels when receiving mate summons) |
| `reality/seed/present/roles/global/role.js` | global.canBe | **word** | Reality-specific BE capability: every being can perform release (log out) in this reality |
| `reality/seed/present/roles/human/role.js` | human.canBe | **word** | Reality-specific BE capability: humans can perform any BE operation including birth (wildcard) |

### NAME-op (11)

| File | Symbol | Tag | Reason |
| --- | --- | --- | --- |
| `reality/seed/ibp/nameOps.js` | banishHandler | **word** | Banish semantics: targeting addressed Name, closure rule that locks signing forever |
| `reality/seed/ibp/nameOps.js` | connectNameHandler WHAT | **word** | Connect semantics: Name-session bond, takeover-on-password-match rule, banishment gate |
| `reality/seed/ibp/nameOps.js` | declareHandler WHAT | **word** | Declare semantics: realname uniqueness rule, keypair generation/import logic, identity spec schema (parentNameId, soulType, name) |
| `reality/seed/ibp/nameOps.js` | NAME_OPS.banish | **word** | Name identity act: Name self-tombstones; world-specific irreversible closure ceremony |
| `reality/seed/ibp/nameOps.js` | NAME_OPS.connect | **word** | Name identity act: bind a Name to session for signing; world-specific Name-session ceremony with takeover rule |
| `reality/seed/ibp/nameOps.js` | NAME_OPS.declare | **word** | Name identity act: mint a new ed25519-backed Name facet; world-specific identity creation ceremony |
| `reality/seed/ibp/nameOps.js` | NAME_OPS.release | **word** | Name identity act: release a Name from its session; world-specific session closure rule |
| `reality/seed/ibp/nameOps.js` | releaseNameHandler WHAT | **word** | Release semantics: Name-session unbond rule; gate requires prior connection state |
| `reality/seed/ibp/verbs/name.js` | banish operation path | **word** | Banish operation (close a Name); reality-specific identity-closure rule |
| `reality/seed/ibp/verbs/name.js` | declare operation path | **word** | Declare operation (mint new Name/identity); reality-specific identity-minting rule |
| `reality/seed/materials/name/closure.js` | isNameBanished + isBanishFact (name:banish semantics) | **word** | The meaning of name banish (identity-layer closure, no future facts signed by it) |

### flow (18)

| File | Symbol | Tag | Reason |
| --- | --- | --- | --- |
| `reality/seed/present/intake/inboxRenderers.js` | registerInboxRenderer | **word** | Inbox renderer registration: reality-specific rules for HOW the inbox intent appears; roles declare their own UI shape |
| `reality/seed/present/roles/cherub/role.js` | handleCherubMate | **word** | summon:mate handler semantics — a Name mints its first top-level being through cherub, owned by the name (sovereign, not vessel). The WHAT: sovereignty vs. parentage, name-driven being creation. Becomes .word summon:mate act declaration. |
| `reality/seed/present/roles/role-manager/ops.js` | set-world-signal operation (WHAT) | **word** | The semantics of world signals: namespace/key/value publication rules; beings' roleFlows read these signals to react to environmental state |
| `reality/seed/present/roles/role-manager/roleFlowOp.js` | set-being-roleflow operation (WHAT) | **word** | The semantics of roleFlow authoring: a being's behavioral program is an array of role-selection clauses with optional conditions and stacking; referenced roles must exist |
| `reality/seed/present/roles/roleflow-composer/role.js` | roleflowComposerRole | **word** | LLM helper role definition: canSee, canDo (set-being-roleflow), system prompt - defines the behavioral program composer's capabilities and coaching instructions |
| `reality/seed/present/roles/roleFlow.js` | roleFlow (data structure and doctrine) | **word** | The WHAT: a being's conditional role selection rules (when/role pairs, stacking). This is world semantics; the data beings author |
| `reality/seed/present/roles/seedResolvers.js` | pattern resolver for 'glob' | **word** | Registers world-specific glob-matching capability expansion; being-name patterns in this world |
| `reality/seed/present/roles/seedResolvers.js` | rel resolver for 'parent', 'mother', 'father' | **word** | Registers world-specific relationship resolvers; what relations this world exposes in capability expansion |
| `reality/seed/present/wakes/subscriptions.js` | subscribe | **word** | Flow declaration: a being's standing rule to wake when an event happens; reality-specific attention assignment |
| `reality/seed/present/wakes/subscriptions.js` | unsubscribe | **word** | Flow rule cancellation: drops a being's attention assignment |
| `reality/seed/present/wakes/wakeSchedule.js` | schedule | **word** | Flow declaration: a being's standing rule to wake on a cadence; reality-specific attention assignment |
| `reality/seed/present/wakes/wakeSchedule.js` | unschedule | **word** | Flow rule cancellation: drops a being's cadence-based wake |
| `reality/seed/present/roles/angel/role.js` | angel.canSummon | **word** | Reality-specific wide summon reach: angel can summon any being (wildcard), part of super-sudo capability |
| `reality/seed/present/roles/birther/role.js` | birther.canSummon:mate | **word** | Reality-specific summon intent: mate summons define cross-world citizenship rules (father/mother tuple recording, vessel commissioning) |
| `reality/seed/present/roles/birther/role.js` | birther.summon.handleMateRequest | **word** | Reality-specific mate-request semantics: vessel naming rule, father tuple construction, homeSpace resolution, name collision check are all world decisions |
| `reality/seed/present/roles/birther/role.js` | resolveBeingName | **word** | Vessel naming algorithm: default name template and fallback rule are world decisions (DEFAULT_BIRTHER_NAME_PREFIX pattern is reality-specific behavior) |
| `reality/seed/present/roles/global/role.js` | global.canSummon | **word** | Reality-specific baseline summon reach: every being can address cherub (the gate) in this reality |
| `reality/seed/present/roles/human/role.js` | human.canSummon | **word** | Reality-specific summon reach: humans can summon any being (wildcard pattern) in this reality |

### type (20)

| File | Symbol | Tag | Reason |
| --- | --- | --- | --- |
| `reality/seed/materials/matter/anchor.js` | CAS anchor primitive function + mime table | **word** | The model (disk → CAS one-way sync) is world architecture; mime detection helps classify |
| `reality/seed/materials/matter/casSweep.js` | Content retention policies ("all" vs "latest") | **word** | Reality-specific retention doctrine - which realities keep full history vs latest only |
| `reality/seed/materials/matter/classify.js` | classifyMatter function + scoring rules | **word** | Classification logic (what type becomes what based on signals) is a registry-driven world behavior, not a host engine |
| `reality/seed/materials/matter/contentStore.js` | putContent + getContent + content addressing | **word** | CAS addressing model (bytes → hash) is world doctrine; every reality has owned bytes addressed by content hash |
| `reality/seed/materials/matter/matterId.js` | matterContentId function (content-addressed hash generation) | **word** | Identity derivation from spec is part of the matter's world meaning (same spec → same id) - deterministic world rule |
| `reality/seed/materials/matter/matters.js` | resolveMatterName + generateUniqueMatterName | **word** | Matter naming rules (explicit → filename → generated) is world doctrine, not storage |
| `reality/seed/materials/matter/types.js` | registerMatterType + type registry | **word** | Matter type declarations define what matter IS (content kinds, operations, classification rules) - reality-specific matter capabilities |
| `reality/seed/materials/name/keys.js` | encodeKeyId + isKeyId (ed25519 public key id encoding) | **word** | Key id format (multibase base58btc z-prefix) is world identity standard every reality uses |
| `reality/seed/materials/name/mnemonic.js` | BIP39 24-word form (entropyToMnemonic, mnemonicToEntropy) | **word** | Paper form of seed (24 BIP39 words) is world-standard backup format |
| `reality/seed/materials/name/name.js` | Name as identity layer doctrine (pubkey id, lineage, above-branch timeline) | **word** | Name identity architecture (Keys are Wallets) is substrate doctrine |
| `reality/seed/materials/name/passwordKey.js` | Password encryption model (scrypt KDF + AES-256-GCM) | **word** | Optional password-locking is world identity feature (paper-form mnemonic as backup) |
| `reality/seed/materials/name/registry.js` | resolveNameId (pubkey vs real-name resolution) | **word** | Real-name as addressing alias is world capability (federation-friendly ibpa names) |
| `reality/seed/materials/space/factory.js` | Factory addressing and structure (stamper space routing, thread listing) | **word** | Factory as a world concept (stamper visibility, reel explorer) - derived projection of world state |
| `reality/seed/materials/space/heavenLineage.js` | heavenLineage classification (heaven never branches) | **word** | Heaven architecture (identity layer above branch timeline) is substrate doctrine every reality uses |
| `reality/seed/materials/space/source.js` | Source matter type and one-way sync model | **word** | Source as a world concept (read-only reflection of disk) - world architecture choice |
| `reality/seed/materials/space/spaceCircuit.js` | Tree circuit breaker health equation + trip/revive semantics | **word** | Circuit doctrine (health thresholds, owner-only revive) is reality-specific world rule |
| `reality/seed/materials/space/spaceLocks.js` | Space-tree lock semantics (three-tier serialization, structural-mutation gating) | **word** | Structural mutation doctrine (Tier 3 serialize: move, delete, ownership) is substrate invariant |
| `reality/seed/materials/space/spaces.js` | assertValidSpaceName + space naming rules | **word** | Naming rules (1-80 chars, letter/digit start, no slashes) are world doctrine every reality shares |
| `reality/seed/materials/space/threads.js` | Thread addressing, rootCorrelation semantics, thread identity | **word** | Thread as a world concept (coordinated SUMMONs, cuttable) is a world abstraction |
| `reality/seed/materials/being/being.js` | BeingSchema | **word** | Being TYPE declaration: stored row shape, identity + figure + cache-control fields |

### seed (5)

| File | Symbol | Tag | Reason |
| --- | --- | --- | --- |
| `reality/seed/materials/space/heavenSpaces.js` | SPACE_ROOT, HEAVEN, Tier-3 spaces doctrine + philosophy | **word** | Heaven spaces are part of world architecture that every reality has (I_AM's working memory, fixed nine) |
| `reality/seed/present/roles/cherub/role.js` | cherubBeing | **word** | Static metadata defining cherub's identity and welcome policy; a reality-specific character at the gate. Becomes .word declaration. |
| `reality/seed/present/roles/llm-assigner/role.js` | Tutorial constants (MARK, URL, VIDEO_ID) | **word** | World-specific configuration: defines the tutorial URL and marker that llm-assigner operations reference; part of the world behavior specification |
| `reality/seed/materials/being/seedBeings.js` | I_AM | **word** | Doctrinal root being constant, world-level identity |
| `reality/seed/materials/being/seedDelegates.js` | SEED_DELEGATES | **word** | Roster of seed beings (arrival, cherub, llm-assigner), world-level role identity |

### genesis (4)

| File | Symbol | Tag | Reason |
| --- | --- | --- | --- |
| `reality/seed/present/roles/http-server/role.js` | httpServerRole | **word** | A being role declaration: describes an infrastructure-wrapping being that sees/does world-specific things (request logging, stats monitoring) |
| `reality/seed/present/roles/mongo/role.js` | mongoRole | **word** | A being role declaration: infrastructure-wrapping being that observes Mongo connection lifecycle as world-observable facts |
| `reality/seed/present/roles/websocket-pool/role.js` | websocketPoolRole | **word** | A being role declaration: infrastructure-wrapping being that manages connection lifecycle as world-observable facts |
| `reality/seed/sprout.js` | I-Am acts (acts inside withIAmAct) | **word** | I-Am's genesis and signing acts - root world behavior (I_AM declares itself and structures reality) |

### auth (16)

| File | Symbol | Tag | Reason |
| --- | --- | --- | --- |
| `reality/seed/ibp/authorize.js` | authorize | **word** | Authorization rules via roles are world-specific — every reality decides who can see/do/summon/be via roleAuth.js. |
| `reality/seed/ibp/authorize.js` | getAuthConfig | **word** | Birth/connect toggling is a reality-level policy decision, not engine machinery. |
| `reality/seed/ibp/nameOps.js` | declareHandler HOW | **host** | Key custody plumbing: encryption (password KDF vs system), credential storage, keypair import transport |
| `reality/seed/ibp/nameOps.js` | keypairFromImport | **host** | Host key import machinery: PKCS8 PEM parsing and BIP39 mnemonic-to-entropy conversion |
| `reality/seed/ibp/roleAuth.js` | authorizeViaRoles | **word** | Role grants, reach patterns, and canX matching are reality-specific authorization rules. |
| `reality/seed/ibp/roleAuth.js` | checkArrivalFloor | **word** | Arrival role definition and its permissions are world-specific, defined per reality. |
| `reality/seed/ibp/roleAuth.js` | findNearestOwnedAncestor | **word** | Ownership semantics (nearest-claim-wins) is a world rule, not engine machinery. |
| `reality/seed/ibp/roleAuth.js` | permits + helpers (permitsSee, permitsDo, permitsSummon, permitsBe, matchBeingNamePattern) | **word** | The canX matching grammar and pattern logic are reality-defined permission semantics. |
| `reality/seed/ibp/roleAuth.js` | permitsReceiverSummon | **word** | Receiver-side summon acceptance rules are world-specific role declarations. |
| `reality/seed/materials/name/login.js` | nameConnect semantics (password-unlock for signing session) | **word** | Login flow (real-name + password → session key) is world identity feature |
| `reality/seed/materials/name/signingSession.js` | signingSession semantics (password-locked key TTL, session lifecycle) | **word** | Session doctrine (password-optional, TTL-slide on activity) is world identity pattern |
| `reality/seed/materials/space/extensionScope.js` | Extension scope (global vs confined, allowed/blocked lists) | **word** | Extension scope doctrine (manifest declares scope, rules walk ancestor chain) is world authority pattern |
| `reality/seed/materials/space/members.js` | getSpaceOwner + setSpaceOwner (owner field semantics) | **word** | Owner authority doctrine (current-owner-authorizes-transfer, parent-owner-claims-unowned) |
| `reality/seed/materials/space/ownership.js` | setOwner + removeOwner (convenience wrappers) | **word** | Ownership is the one base-axiom authority class - world doctrine |
| `reality/seed/present/roles/spaceLookup.js` | reach pattern vocabulary and space-role binding | **word** | The WHAT: role reach policies (host + descendants, path filters); world semantics for role coverage |
| `reality/seed/present/roles/public/role.js` | public.canSee:canDo:canSummon:canBe | **word** | Reality-specific authorization model: empty capabilities represent world doctrine (public is silent lock, not an actor), defines commons semantics |

### host (376)

| File | Symbol | Tag | Reason |
| --- | --- | --- | --- |
| `reality/genesis.js` | bootMode detection | **host** | Determines Beginning/Awakening/Restored state by probing space root - host startup machinery |
| `reality/genesis.js` | genesis | **host** | Boot orchestration: DB connection, indexes, optional plant mode, genesis sequence coordination - host machinery for substrate startup |
| `reality/genesis.js` | PLANT_FROM_GRAFT mode | **host** | Optional boot path: load graft JSON, verify chain root, plant into empty DB - host machinery for genome restoration |
| `reality/seed/ibp/address.js` | computeIbpStampAddress, canonicalStancePair, stanceString, loadBeingStanceFields | **host** | Act lane composition is engine machinery for reel/act chain bookkeeping. |
| `reality/seed/ibp/address.js` | getRealityDomain | **host** | Bare domain lookup is engine plumbing for addressing. |
| `reality/seed/ibp/address.js` | parse, format, expand, validate, parseStance, formatStance, expandStance | **host** | IBP address grammar and parsing are the shared wire protocol — the same across all realities. |
| `reality/seed/ibp/address.js` | parseFromSocket, parseWithContext | **host** | Wire-layer parse context assembly is engine protocol machinery. |
| `reality/seed/ibp/address.js` | resolveBeingIds, resolveBranchPointers | **host** | Async being/branch resolution are engine machinery for canonical stance assembly. |
| `reality/seed/ibp/authorize.js` | VERB_DISPATCH_ENTRY_POINT | **host** | The verb dispatch coordination and short-circuit gates are engine routing logic shared by every reality. |
| `reality/seed/ibp/beOps.js` | getBeOp | **host** | Registry lookup function; host dispatch plumbing for BE verb |
| `reality/seed/ibp/beOps.js` | listBeOpNames | **host** | Registry introspection; host machinery for license filtering |
| `reality/seed/ibp/branchResolve.js` | resolveTargetBranch | **host** | Branch precedence is a unified engine rule applied both by authorize and verb dispatch to keep authorization and fact stamping consistent. |
| `reality/seed/ibp/crossWorld.js` | checkAndRecordForeignAct, resolveLocalTargetBranch | **host** | Foreign act dedup and branch resolution are federation engine machinery. |
| `reality/seed/ibp/crossWorld.js` | crossRealityDispatch | **host** | Cross-reality act opening and response handling is transport/federation engine machinery. |
| `reality/seed/ibp/crossWorld.js` | runVerbAsForeignActor | **host** | Foreign-actor synthesis and fact-emission is engine machinery that runs world verbs as a guest. |
| `reality/seed/ibp/descriptor.js` | foldRead, placeAtSpaceRoot, placeAtSpace, childrenOf, mattersAt, enrichBeings + helpers | **host** | Fold machinery, projection loading, and state reads are engine infrastructure shared by every reality. |
| `reality/seed/ibp/descriptor.js` | serializeQualities, serializeAsOf, beingsAtSpace, occupantsByPosition, summonToActivity | **host** | State serialization and position machinery are engine plumbing for delivery, not world semantics. |
| `reality/seed/ibp/nameOps.js` | connectNameHandler HOW | **host** | Session channel host plumbing: address parsing, projection loading, banishment state lookup |
| `reality/seed/ibp/nameOps.js` | getNameOp | **host** | Registry lookup function; host dispatch plumbing for NAME verb |
| `reality/seed/ibp/nameOps.js` | listNameOpNames | **host** | Registry introspection; host machinery for portal action menus |
| `reality/seed/ibp/nameOps.js` | releaseNameHandler HOW | **host** | Session closure plumbing: address parsing, projection state checking (connected field) |
| `reality/seed/ibp/operations.js` | getOperation | **host** | Operation lookup; registry query for dispatcher |
| `reality/seed/ibp/operations.js` | isNamespaceKeyedAction | **host** | Namespace-keyed auth key detection; authorization dispatch logic |
| `reality/seed/ibp/operations.js` | listOperations | **host** | Operation enumeration; registry inspection for clients |
| `reality/seed/ibp/operations.js` | registerOperation | **host** | Operation registry CRUD; the container machinery for any reality's operations |
| `reality/seed/ibp/operations.js` | syncOperationsToSubstrate | **host** | Manifest synchronization; registry ↔ substrate projection, bootstrap machinery |
| `reality/seed/ibp/operations.js` | unregisterOperation | **host** | Operation deregistry; extension unload machinery |
| `reality/seed/ibp/operations.js` | unregisterOperationsFromExtension | **host** | Batch operation deregistry; extension teardown machinery |
| `reality/seed/ibp/protocol.js` | httpStatusFor + ok + error + sendOk + sendError + sendCaughtError | **host** | Response shaping and HTTP translation are wire-layer engine machinery. |
| `reality/seed/ibp/protocol.js` | IBP_ERR enum + isIbpError + mapPatternsToIbpError | **host** | Wire error codes and class are the shared IBP protocol contract understood by every reality. |
| `reality/seed/ibp/pushChannel.js` | setPushChannel + resetPushChannel + hasPushChannel + emitToBeing + emitToBeingRoom + pushIbp + emitNavigate + getIO + getHttpServer + registerSocketHandler + unregisterSocketHandler | **host** | Push channel is a transport adapter pattern — the abstraction that lets seed reach speakers via any wired connection. The same machinery for every reality. |
| `reality/seed/ibp/resolver.js` | walkSpacePath + base + derivation helpers | **host** | The machinery that traverses the space tree and loads rows is engine substrate, not world-specific. |
| `reality/seed/ibp/seeOps.js` | EXT_NAME_RE | **host** | Host name-shape validation: regex for extension-prefixed SEE op name format |
| `reality/seed/ibp/seeOps.js` | getSeeOperation | **host** | Registry lookup; host dispatch plumbing for named perceptions |
| `reality/seed/ibp/seeOps.js` | isSeeOpName | **host** | Registry detection; host dispatch plumbing to distinguish SEE op names from addresses |
| `reality/seed/ibp/seeOps.js` | listSeeOperations | **host** | Registry introspection; host machinery for portal menus and license filtering |
| `reality/seed/ibp/seeOps.js` | MAX_REGISTERED | **host** | Host capacity limit: registry size cap (500) to prevent resource exhaustion |
| `reality/seed/ibp/seeOps.js` | registerSeeOperation | **host** | Registry machinery: validation, duplicate detection, cap enforcement, extension ownership tracking |
| `reality/seed/ibp/seeOps.js` | SEED_NAME_RE | **host** | Host name-shape validation: regex for seed-bare-name format enforcement |
| `reality/seed/ibp/seeOps.js` | unregisterSeeOperation | **host** | Registry mutation; host machinery for dynamic op removal |
| `reality/seed/ibp/seeOps.js` | unregisterSeeOperationsFromExtension | **host** | Registry cleanup; host machinery for extension unload |
| `reality/seed/ibp/setRender.js` | setRenderHandler HOW | **host** | Dispatch plumbing: target kind detection, inner doVerb call, summonCtx threading for atomic fact grouping |
| `reality/seed/ibp/setRender.js` | VALID_KEYS | **host** | Host schema: allowed top-level render block keys (model, scale, rotation, animations, sounds, merge) |
| `reality/seed/ibp/setRender.js` | validateRenderBlock | **host** | Host validation: shape enforcement, type checking, rejection of unknown keys and typos |
| `reality/seed/ibp/verbs/_shared.js` | assertVerbCaller | **host** | Perimeter gate enforcing being-identity requirement; verb-dispatch machinery |
| `reality/seed/ibp/verbs/_shared.js` | captureCallerFrame | **host** | Stack walking for error diagnostics; logging/debugging infrastructure |
| `reality/seed/ibp/verbs/_shared.js` | normalizeIdentity | **host** | Identity normalization utility; same shape gating across all verbs regardless of reality |
| `reality/seed/ibp/verbs/_shared.js` | refuseHistoricalWrite | **host** | Doctrine gate; enforces substrate invariant that write verbs cannot act in past |
| `reality/seed/ibp/verbs/_shared.js` | resolveBranchForFact | **host** | Branch resolution for fact emission; perimeter threading, substrate machinery |
| `reality/seed/ibp/verbs/be.js` | beVerb | **host** | BE dispatcher; routing, auth gating, fact emission, branch resolution across all five ops |
| `reality/seed/ibp/verbs/be.js` | extractBeingFromAddress | **host** | Address parsing; @being qualifier extraction for dispatcher routing |
| `reality/seed/ibp/verbs/be.js` | extractRealityFromAddress | **host** | Address parsing; reality prefix extraction for cross-reality rejection |
| `reality/seed/ibp/verbs/be.js` | writeBeFact | **host** | BE fact emission; audit Fact stamping for all five BE operations |
| `reality/seed/ibp/verbs/do.js` | checkReadOnlySource | **host** | Source-matter read-only gate; mirror mount doctrine enforcement |
| `reality/seed/ibp/verbs/do.js` | doVerb | **host** | DO dispatcher; routing, operation lookup, auth gating, fact emission, branch resolution |
| `reality/seed/ibp/verbs/do.js` | resolveAuditTarget | **host** | Fact-target resolution from handler result; audit machinery |
| `reality/seed/ibp/verbs/do.js` | resolveAuthSpaceId | **host** | Auth-target resolution; maps various entity types to space for stance-based role-walk |
| `reality/seed/ibp/verbs/do.js` | summarizeAuditResult | **host** | Result summarization for fact; size capping and Mongoose collapse logic |
| `reality/seed/ibp/verbs/name.js` | nameVerb | **host** | NAME dispatcher; routing, address parsing, auth gating, fact emission |
| `reality/seed/ibp/verbs/name.js` | parseNameAddress | **host** | Identity-layer address parsing; dispatcher input validation |
| `reality/seed/ibp/verbs/name.js` | writeNameFact | **host** | NAME fact emission; audit Fact stamping for declare/banish |
| `reality/seed/ibp/verbs/see.js` | _redirectResolvedToSpace | **host** | Stance resolution helper for historical follow; resolver machinery |
| `reality/seed/ibp/verbs/see.js` | inferAddressKind | **host** | Address shape inference; parser utility for the dispatcher |
| `reality/seed/ibp/verbs/see.js` | normalizeAtQualifier | **host** | Historical-qualifier validation; schema gating for verb input |
| `reality/seed/ibp/verbs/see.js` | registerSeeOperation / unregisterSeeOperation / getSeeOperation / listSeeOperations | **host** | SEE op registry machinery; attached to seeVerb like operations registry on doVerb |
| `reality/seed/ibp/verbs/see.js` | seeAtTime | **host** | Historical read mechanism; substrate fold/replay infrastructure |
| `reality/seed/ibp/verbs/see.js` | seeVerb | **host** | SEE dispatcher; routing, address parsing, auth gating, discovery/thread/synthetic short-circuits all engine machinery |
| `reality/seed/ibp/verbs/summon.js` | _dispatchSummon | **host** | SUMMON dispatch tail; auth, fact emission, role-handler invocation, response gating |
| `reality/seed/ibp/verbs/summon.js` | pathOfResolved | **host** | Stance reconstruction from resolver output; helper for reply addressing |
| `reality/seed/ibp/verbs/summon.js` | runSummoning | **host** | Sync-mode role invocation framework; dispatcher handling for synchronous responses |
| `reality/seed/ibp/verbs/summon.js` | summonByResolved | **host** | Internal SUMMON entry (no parse/resolve); for scheduled/triggered summons, still routes through auth/dispatch |
| `reality/seed/ibp/verbs/summon.js` | summonVerb | **host** | SUMMON dispatcher; routing, stance resolution, auth gating, branch resolution, response-mode handling |
| `reality/seed/ibp/verbs/summon.js` | validateSummonMessage | **host** | Envelope schema validation; verb input gating |
| `reality/seed/materials/_targetShape.js` | _modelFor | **host** | Model loader by kind — HOST MACHINERY for dynamic model imports (internal helper) |
| `reality/seed/materials/_targetShape.js` | detectTargetKind | **host** | Target kind detection — HOST MACHINERY for identifying the shape (stance/typed/string) of a DO target |
| `reality/seed/materials/_targetShape.js` | loadTargetRow | **host** | Target row loader — HOST MACHINERY for fetching Mongoose docs and handling branch-aware resolution |
| `reality/seed/materials/_targetShape.js` | targetIdOf | **host** | Target id extraction — HOST MACHINERY for extracting id from any valid target shape |
| `reality/seed/materials/branch/branch.js` | Branch (Mongoose model) | **host** | Branch metadata schema; branching machinery. |
| `reality/seed/materials/branch/branchCreation.js` | createBranch, allocBranchPath | **host** | Branch allocation and creation machinery; machinery. |
| `reality/seed/materials/branch/branches.js` | resolveBranchLineage, getBranchPoint, isMain, isBranchPaused | **host** | Branch read-side helpers; lineage and ancestry machinery; branch-aware dispatch gate. |
| `reality/seed/materials/branch/branchesCatalog.js` | branchesCatalog, getBranches | **host** | Branch list read-side; machinery. |
| `reality/seed/materials/branch/branchPath.js` | branchPath parsing and validation | **host** | Branch path validation; alternating number/letter scheme; machinery. |
| `reality/seed/materials/branch/branchRegistry.js` | branchRegistry (in-memory cache) | **host** | In-memory branch ancestry cache; machinery. |
| `reality/seed/materials/branch/branchScope.js` | branchScope, withBranchScope | **host** | Branch context threading; machinery. |
| `reality/seed/materials/branch/projection.js` | Projection (Mongoose model) | **host** | Branch-aware projection cache schema; keyed by branch:type:id; machinery. |
| `reality/seed/materials/branch/resetReels.js` | resetReelsOnBranch | **host** | Branch reset machinery; machinery. |
| `reality/seed/materials/doCeiling.js` | checkWriteSize | **host** | Write size checker with pressure hook — HOST MACHINERY for pre-write validation against MongoDB ceiling |
| `reality/seed/materials/doCeiling.js` | estimateDocSize | **host** | Document size estimator — HOST MACHINERY for BSON overhead calculation |
| `reality/seed/materials/doCeiling.js` | estimateWriteSize | **host** | Write data size estimator — HOST MACHINERY utility for size checking |
| `reality/seed/materials/doCeiling.js` | getMaxBytes | **host** | Document size limit getter — HOST MACHINERY for MongoDB BSON ceiling enforcement |
| `reality/seed/materials/doCeiling.js` | guardQualityWrite | **host** | Quality write guard — HOST MACHINERY for enforcing document size ceiling before any quality fact |
| `reality/seed/materials/host/host.js` | initHostRuntime, enqueueBeingAct, noteSocketConnected, noteSocketDisconnected | **host** | Host runtime lifecycle and per-being serial lanes; HTTP/WS/Mongo connection tracking; machinery. |
| `reality/seed/materials/host/requestLog.js` | noteRequestQueued, noteRequestComplete | **host** | Per-request HTTP fact pipeline; request logging fact machinery. |
| `reality/seed/materials/matter/anchor.js` | File walks, skip patterns, disk hashing | **host** | Filesystem traversal and I/O machinery - host operations |
| `reality/seed/materials/matter/casSweep.js` | Sweep mechanics (grace period, TOCTOU guard, per-cycle cap, timers) | **host** | Background garbage collection machinery - host task scheduling and safety |
| `reality/seed/materials/matter/contentStore.js` | File I/O, hashing, PREVIEW_CHARS, TEXT_CACHE, disk operations | **host** | Filesystem mechanics, caching, preview building, blob storage - host persistence machinery |
| `reality/seed/materials/matter/matter.js` | Matter schema (MatterSchema, Mongoose model) | **host** | Database schema and storage projection mechanics for Matter - host persistence layer |
| `reality/seed/materials/matter/matterId.js` | canonicalize import + crypto mechanics | **host** | Hash function and cryptographic machinery - host computation engine |
| `reality/seed/materials/matter/matters.js` | Database queries, hooks, storage operations | **host** | Matter persistence layer - database access and mutations |
| `reality/seed/materials/matter/ops.js` | create-matter handler mechanics (content store interaction, CAS ref handling, coordinate clamping) | **host** | The how: storage system integration, hashing, database mechanics - host execution plumbing |
| `reality/seed/materials/matter/ops.js` | purge-content handler (refcount checks, force flag, physical deletion) | **host** | Deduplication safety machinery, shared-fate decision enforcement, physical byte deletion - host mechanics |
| `reality/seed/materials/matter/ops.js` | rename-matter handler (uniqueness checks, allowReplace logic) | **host** | Per-folder uniqueness enforcement and atomic replace mechanics - host storage layer |
| `reality/seed/materials/matter/ops.js` | set-matter handler mechanics (field validation, coordinate bounds checking, qualities namespace enforcement) | **host** | Storage layer writes and validation enforcement - host persistence |
| `reality/seed/materials/matter/reducer.js` | Matter reducer (initial + reduce function) | **host** | State folding machinery - the host's fold engine that accumulates state from facts |
| `reality/seed/materials/matter/types.js` | REGISTRY mechanics (registration, validation, unregistration) | **host** | The registry storage and enforcement machinery (MAX_REGISTERED, name validation patterns, deduplication checks) - substrate machinery |
| `reality/seed/materials/modelOp.js` | isRootOwner | **host** | Root owner lookup — HOST UTILITY for permission check (resolves current state from projection) |
| `reality/seed/materials/modelOp.js` | set-model-operation-registration | **host** | Set-model operation registration — HOST MACHINERY for registering the handler with the dispatcher |
| `reality/seed/materials/moveOp.js` | move-operation-registration | **host** | Move operation registration metadata — HOST MACHINERY for registering the move handler with the dispatcher |
| `reality/seed/materials/name/bip39Words.js` | BIP39_EN wordlist | **host** | Canonical reference data for encoding - host constant |
| `reality/seed/materials/name/closure.js` | Projection reads, gate exceptions, idempotence | **host** | Stamper-side gate implementation - host fact validation |
| `reality/seed/materials/name/keyOps.js` | key-export handler mechanics (socket-level auth, key decryption, mnemonic generation) | **host** | Key custody and cryptographic operations - host security machinery |
| `reality/seed/materials/name/keys.js` | b58encode/b58decode functions, crypto operations, MULTICODEC constants | **host** | Cryptographic encoding machinery - host crypto layer |
| `reality/seed/materials/name/login.js` | Password verification, key decryption, session setup | **host** | Authentication machinery - host security layer |
| `reality/seed/materials/name/mnemonic.js` | Crypto operations (sha256, bit manipulation, checksum) | **host** | Cryptographic encoding - host crypto layer |
| `reality/seed/materials/name/name.js` | NameSchema + Mongoose model (ed25519 key id, lineage, private key, soul) | **host** | Database schema for Name projection - host storage |
| `reality/seed/materials/name/passwordKey.js` | encryptWithPassword/decryptWithPassword (crypto operations, scrypt params) | **host** | Cryptographic machinery - host crypto layer |
| `reality/seed/materials/name/reducer.js` | Name reducer (initial + reduce + apply functions) | **host** | State folding machinery - host fold engine |
| `reality/seed/materials/name/registry.js` | Projection queries, token parsing | **host** | Lookup machinery - host query layer |
| `reality/seed/materials/name/signingSession.js` | In-memory latch, key holding, expiry logic, locks map | **host** | Session state machinery - host memory management |
| `reality/seed/materials/portalOp.js` | form-portal-operation-registration | **host** | Form-portal operation registration — HOST MACHINERY for registering the handler with the dispatcher |
| `reality/seed/materials/projections.js` | assertBranchOrThrow | **host** | Branch validation — HOST MACHINERY for enforcing branch thread requirement at consumer boundaries |
| `reality/seed/materials/projections.js` | countByParent | **host** | Parent lineage count — FOLD MACHINERY for being children cardinality |
| `reality/seed/materials/projections.js` | countByType | **host** | Aggregate count — FOLD MACHINERY for type-scoped enumeration |
| `reality/seed/materials/projections.js` | findByHeavenSpace | **host** | Heaven seed-space finder — FOLD MACHINERY for singleton reality-level lookups (.config, .threads, etc) |
| `reality/seed/materials/projections.js` | findByName | **host** | Name-scoped query with branch lineage — FOLD MACHINERY for lazy-inherited name resolution |
| `reality/seed/materials/projections.js` | findByNamePattern | **host** | Regex name query — FOLD MACHINERY for pattern-based name lookups |
| `reality/seed/materials/projections.js` | findByParent | **host** | Parent-scoped query — FOLD MACHINERY for lazy-inherited being lineage walks |
| `reality/seed/materials/projections.js` | findByPosition | **host** | Position-scoped query — FOLD MACHINERY for lazy-inherited branch-aware lookups |
| `reality/seed/materials/projections.js` | findHeavenSpace | **host** | Heaven seed-space accessor — FOLD MACHINERY wrapper locked to branch 0 |
| `reality/seed/materials/projections.js` | findInHeaven | **host** | Heaven-scoped name lookup — FOLD MACHINERY wrapper locked to branch 0 |
| `reality/seed/materials/projections.js` | findRoot | **host** | Root aggregate finder — FOLD MACHINERY for identity tree roots |
| `reality/seed/materials/projections.js` | findRootOperator | **host** | Root operator discoverer — FOLD MACHINERY for finding first non-system being (bootstrap utility) |
| `reality/seed/materials/projections.js` | fold, rebuild, initProjection, saveProjection, loadProjection, findByHeavenSpace, findByName | **host** | Projection cache API; generic over all reel types; branch-aware read/write machinery; no material-specific names. |
| `reality/seed/materials/projections.js` | initProjection | **host** | Projection initializer — FOLD MACHINERY for cold-fold landing (insert-or-overwrite) |
| `reality/seed/materials/projections.js` | listByType | **host** | Type-scoped enumeration — FOLD MACHINERY for .beings/.spaces/.matters catalog with lazy inheritance |
| `reality/seed/materials/projections.js` | listMatterNamesInFolder | **host** | Matter folder enumeration — FOLD MACHINERY for per-space matter name uniqueness scoping |
| `reality/seed/materials/projections.js` | loadHeavenProjection | **host** | Heaven projection loader — FOLD MACHINERY wrapper locked to branch 0 |
| `reality/seed/materials/projections.js` | loadOrFold | **host** | Lazy cold-fold loader — FOLD MACHINERY for branch-aware lineage walk and cache miss handling |
| `reality/seed/materials/projections.js` | loadProjection | **host** | Single slot loader — FOLD MACHINERY for reading cached projection (read-back validation after stamp) |
| `reality/seed/materials/projections.js` | loadProjections | **host** | Batch slot loader — FOLD MACHINERY for efficient multi-aggregate reads |
| `reality/seed/materials/projections.js` | saveProjection | **host** | Projection updater with CAS — FOLD MACHINERY for conditional-atomic slot advancement |
| `reality/seed/materials/projections.js` | tombstoneProjection | **host** | Projection tombstone — FOLD MACHINERY for marking aggregates as released in a branch |
| `reality/seed/materials/projections.js` | toOccupant | **host** | Occupant shape converter — FOLD MACHINERY helper for slot→occupant serialization |
| `reality/seed/materials/publish/bundle.js` | assertValidBundle | **host** | Bundle structural validation gate - host machinery for verifying portable artifacts |
| `reality/seed/materials/publish/bundle.js` | BUNDLE_VERSION constant | **host** | Clone bundle structure and validation - portable artifact machinery used by all realities |
| `reality/seed/materials/publish/bundle.js` | emptyBundle | **host** | Empty bundle scaffold factory - host machinery for artifact construction |
| `reality/seed/materials/publish/bundleSig.js` | signBundle | **host** | Ed25519 cryptographic signing over bundle hash - host machinery for artifact provenance |
| `reality/seed/materials/publish/bundleSig.js` | verifyBundleSig | **host** | Self-certifying signature verification against pubkey id - host machinery for artifact validation |
| `reality/seed/materials/publish/graft.js` | assertValidGraft | **host** | Graft bundle structural validation - host machinery |
| `reality/seed/materials/publish/graft.js` | captureBeingGraft | **host** | Being-scoped identity-preserving graft capture - host machinery for being export |
| `reality/seed/materials/publish/graft.js` | captureGraft | **host** | Full reality dump (facts + acts + branches + heads) - host machinery for genome capture and serialization |
| `reality/seed/materials/publish/graft.js` | capturePartialGraft | **host** | Partial graft mechanisms (genesis-prefix, checkpoint-segment, single-branch, state-snapshot) - host machinery for incremental chain transfer |
| `reality/seed/materials/publish/graft.js` | plantGraft | **host** | Boot-time replay of captured graft chain into fresh DB with verification - host machinery for genome planting |
| `reality/seed/materials/publish/seedPlant.js` | plantTemplate | **host** | Clone bundle application logic (remap IDs, resolve refs, emit facts in order) - host machinery for bundle instantiation |
| `reality/seed/materials/publish/seedTemplate.js` | captureTemplate | **host** | Subtree snapshot capture (space+being+matter walk, Ref tagging, sentinel resolution) - host machinery for clone extraction |
| `reality/seed/materials/publish/seedTemplate.js` | computeBundleHash | **host** | Content-addressed bundle integrity hash - host machinery for artifact CAS binding |
| `reality/seed/materials/publish/templateRegistry.js` | getTemplate | **host** | Clone lookup by name - host machinery |
| `reality/seed/materials/publish/templateRegistry.js` | getTemplateCount | **host** | Diagnostic clone count - host machinery |
| `reality/seed/materials/publish/templateRegistry.js` | listTemplates | **host** | Clone catalog for portal UI - host machinery |
| `reality/seed/materials/publish/templateRegistry.js` | registerTemplate | **host** | Clone bundle registry storage by fullName - host machinery for clone lifecycle management |
| `reality/seed/materials/publish/templateRegistry.js` | unregisterTemplate | **host** | Clone bundle unregistration - host machinery |
| `reality/seed/materials/publish/templateRegistry.js` | unregisterTemplatesFromExtension | **host** | Extension-scoped clone cleanup - host machinery |
| `reality/seed/materials/qualities.js` | createQualityPrimitives | **host** | Quality read API factory — READ INTERFACE providing access to qualities (write path is fact-driven, no direct setter) |
| `reality/seed/materials/qualities.js` | qualities.being.getQuality | **host** | Being quality read accessor — HOST READ INTERFACE to projection state |
| `reality/seed/materials/qualities.js` | qualities.being.readQualityNamespace | **host** | Being quality namespace read — HOST READ INTERFACE to projection state |
| `reality/seed/materials/qualities.js` | qualities.matter | **host** | Matter quality read API — HOST READ INTERFACE to projection state |
| `reality/seed/materials/qualities.js` | qualities.space | **host** | Space quality read API — HOST READ INTERFACE to projection state |
| `reality/seed/materials/redact.js` | isSecretFieldPath | **host** | Secret path detector — HOST MACHINERY for identifying secret-bearing fact.params fields |
| `reality/seed/materials/redact.js` | REDACTED | **host** | Redaction marker — HOST MACHINERY constant for secret masking |
| `reality/seed/materials/redact.js` | redactSecrets | **host** | Secret redaction traversal — HOST MACHINERY for transport boundary enforcement (secrets stay in DB and reel, not on the wire) |
| `reality/seed/materials/redact.js` | SECRET_KEYS | **host** | Secret key set — HOST MACHINERY for identifying fields to redact by name |
| `reality/seed/materials/reducerHelpers.js` | applyConnectionState | **host** | Being inhabit projection reducer — FOLD MACHINERY for connection/release facts |
| `reality/seed/materials/reducerHelpers.js` | applyCreateBeing | **host** | Being birth reducer — FOLD MACHINERY that computes initial state from fact params |
| `reality/seed/materials/reducerHelpers.js` | applyCreateMatter | **host** | Matter birth reducer — FOLD MACHINERY that computes initial state from fact params |
| `reality/seed/materials/reducerHelpers.js` | applyCreateSpace | **host** | Space birth reducer — FOLD MACHINERY that computes initial state from fact params |
| `reality/seed/materials/reducerHelpers.js` | applyDeath | **host** | Being death reducer — FOLD MACHINERY, sets rendering-scrub state identically on replay |
| `reality/seed/materials/reducerHelpers.js` | applyMove | **host** | Move fact reducer — FOLD MACHINERY (the move rules ARE word; the fold application is host) |
| `reality/seed/materials/reducerHelpers.js` | applyPurgeContent | **host** | Purge-content reducer — FOLD MACHINERY that marks content purged |
| `reality/seed/materials/reducerHelpers.js` | applyRoleGrants | **host** | Role grant/revoke reducer — FOLD MACHINERY applier (the grant/revoke RULES are word, their application is host fold) |
| `reality/seed/materials/reducerHelpers.js` | applySetField | **host** | Scalar field reducer — FOLD MACHINERY for name/type/owner/coord/etc |
| `reality/seed/materials/reducerHelpers.js` | applySetQualities | **host** | Fact-driven qualities reducer — FOLD MACHINERY that applies facts to state identically in every reality |
| `reality/seed/materials/reducerHelpers.js` | applyTrueName | **host** | Being trueName identity reducer — FOLD MACHINERY for be:truename facts |
| `reality/seed/materials/reducerHelpers.js` | setDeepPath | **host** | Helper for deep qualities path setting — FOLD MACHINERY utility |
| `reality/seed/materials/reducers.js` | reducers.get | **host** | Reducer registry dispatch engine — the SAME fold machinery for every reality |
| `reality/seed/materials/reducers.js` | reducers.types | **host** | Reducer registry enumeration — host fold inspection utility |
| `reality/seed/materials/ref.js` | coerceRef | **host** | Ref coercion — HOST MACHINERY for legacy bare-string-to-ref conversion at boundaries |
| `reality/seed/materials/ref.js` | isAggregateRef | **host** | Aggregate ref predicate — HOST MACHINERY for discriminating aggregate refs from sentinels |
| `reality/seed/materials/ref.js` | isRef | **host** | Ref predicate — HOST MACHINERY for detecting substrate aggregate references |
| `reality/seed/materials/ref.js` | isSentinelRef | **host** | Sentinel ref predicate — HOST MACHINERY for graft/insertion-point sentinels |
| `reality/seed/materials/ref.js` | listAggregateKinds | **host** | Aggregate kinds enumeration — HOST MACHINERY introspection |
| `reality/seed/materials/ref.js` | listSentinelKinds | **host** | Sentinel kinds enumeration — HOST MACHINERY introspection |
| `reality/seed/materials/ref.js` | ref | **host** | Ref constructor — HOST MACHINERY for aggregate reference normalization (same container model across all realities) |
| `reality/seed/materials/ref.js` | refId | **host** | Ref id accessor — HOST MACHINERY for extracting aggregate id from refs or bare strings |
| `reality/seed/materials/ref.js` | refKind | **host** | Ref kind accessor — HOST MACHINERY for dispatch on ref type |
| `reality/seed/materials/refWalker.js` | collectUniqueAggregateIds | **host** | Unique ref collection — HOST MACHINERY helper for graft remap table construction |
| `reality/seed/materials/refWalker.js` | findRefs | **host** | Ref discovery traversal — HOST MACHINERY for finding all refs in deep structures (replicate/graft prep) |
| `reality/seed/materials/refWalker.js` | remapRefs | **host** | Ref remapping traversal — HOST MACHINERY for substituting refs via mapper during graft/replicate |
| `reality/seed/materials/space/ancestorCache.js` | Ancestor chain caching strategy and invalidation patterns | **host** | Performance optimization machinery (LRU, per-branch, TTL) - host caching layer |
| `reality/seed/materials/space/extensionScope.js` | Scope resolution mechanics (caching, chain walks, per-extension checks) | **host** | Implementation of scope checking - host authority machinery |
| `reality/seed/materials/space/factory.js` | Projection queries, Act/Fact joining, schema routing | **host** | Projection query machinery - host read layer |
| `reality/seed/materials/space/heavenLineage.js` | Cache mechanics, queries, root-id lookup | **host** | Implementation caching - host performance optimization |
| `reality/seed/materials/space/heavenSpaces.js` | Constants and enums (HEAVEN_SPACE, DELETED sentinel) | **host** | Infrastructure constants - host definitions |
| `reality/seed/materials/space/members.js` | Lock acquisition, database writes, fact emission | **host** | Host storage and synchronization machinery |
| `reality/seed/materials/space/ops.js` | create-space handler mechanics (fact emission, context resolution, storage) | **host** | Handler plumbing and database writes - host execution layer |
| `reality/seed/materials/space/reducer.js` | Space reducer (initial + reduce function) | **host** | State folding machinery - the host's fold engine |
| `reality/seed/materials/space/source.js` | Filesystem walks, projection updates, disk I/O | **host** | Disk reconciliation machinery - host I/O layer (SANCTIONED EXCEPTION to facts doctrine) |
| `reality/seed/materials/space/space.js` | SpaceSchema + Mongoose model | **host** | Database schema and storage structure - host persistence layer |
| `reality/seed/materials/space/spaceCircuit.js` | Health calculation, timer management, metrics collection | **host** | Monitoring and time-based machinery - host operations |
| `reality/seed/materials/space/spaceLocks.js` | Lock storage, acquisition/release, TTL expiry, deadlock avoidance | **host** | Locking machinery - host synchronization layer |
| `reality/seed/materials/space/spaces.js` | Database queries, Mongoose operations, hooks, locking mechanics | **host** | Storage layer persistence - host machinery |
| `reality/seed/materials/space/threads.js` | Severed-roots cache mechanics, Act row queries, projection reads | **host** | Caching and query machinery - host retrieval layer |
| `reality/seed/past/act/act.js` | Act (Mongoose model) | **host** | Act audit row schema; moment frame storage; machinery. |
| `reality/seed/past/act/actChain.js` | describeActChain | **host** | Act-chain read-side for explorer; newest-first iteration; machinery. |
| `reality/seed/past/act/actChainLock.js` | withActChainLock | **host** | Concurrency guard for act-chain reads; machinery. |
| `reality/seed/past/act/actHash.js` | computeActHash, canonicalActContent | **host** | Act identity hashing; content-addressed act id; machinery. |
| `reality/seed/past/act/actHead.js` | ActHead (Mongoose model) | **host** | Per-being act-head tracking; serial lane identity source; machinery. |
| `reality/seed/past/act/actSig.js` | buildActSigPayload, signAct, verifyActSig | **host** | Act signature machinery; commits to actId, p, factIds, seal time; signing infrastructure. |
| `reality/seed/past/act/crossOrigin.js` | normalizeCrossOriginAct | **host** | Cross-reality envelope normalization; transport machinery. |
| `reality/seed/past/act/crossWorldResponse.js` | recordCrossWorldResponse | **host** | Federation response tracking; machinery. |
| `reality/seed/past/act/innerFace.js` | Act.innerFace field | **host** | Act row's face closure field; projection machinery. |
| `reality/seed/past/act/status.js` | Act status enums and checks | **host** | Act lifecycle status constants; machinery. |
| `reality/seed/past/fact/chainRoots.js` | getRootHash, recordRoot, verifyRootHash | **host** | Root hash tracking for branches and realities; content-addressed identity of stored chains; machinery. |
| `reality/seed/past/fact/fact.js` | Fact (Mongoose model) | **host** | Content-addressed fact schema; storage layer for DO/BE acts; machinery. |
| `reality/seed/past/fact/facts.js` | logFact, getFacts, getFactsByBeing | **host** | Reel append and read machinery; fact writer and iterator; machinery. |
| `reality/seed/past/fact/hash.js` | computeHash, canonicalize, GENESIS_PREV | **host** | SHA-256 content-addressing machinery; deterministic canonical digest; chain linkage (p). |
| `reality/seed/past/fact/verifyReel.js` | verifyReel, verifyReelSignatures | **host** | Reel integrity checking; hash chain verification; machinery. |
| `reality/seed/past/fact/verifyReelFrom.js` | verifyReelFrom | **host** | Branch-aware reel verification; lineage walk; machinery. |
| `reality/seed/past/projections/inbox/inboxProjection.js` | InboxProjection (Mongoose model) | **host** | Inbox projection schema; summon+answer tracking; projection machinery. |
| `reality/seed/past/projections/inbox/inboxProjectionFold.js` | handleSummon, handleSever, handleActSeal | **host** | Cross-cutting fold handlers for inbox; generic projection machinery. |
| `reality/seed/past/projections/position/positionProjection.js` | PositionProjection (Mongoose model) | **host** | Position cache schema; occupant-reel indexing; projection machinery. |
| `reality/seed/past/projections/position/positionProjectionFold.js` | handleBirth, handleMove, handleDeath | **host** | Cross-cutting fold handlers for position; generic projection machinery. |
| `reality/seed/past/projections/threads/threadsProjection.js` | ThreadsProjection (Mongoose model) | **host** | Threads index schema; summon/reply threading; projection machinery. |
| `reality/seed/past/projections/threads/threadsProjectionFold.js` | noteActSealOnThread, handleThreadRoll | **host** | Cross-cutting fold handlers for threads; generic projection machinery. |
| `reality/seed/past/reel/appendLock.js` | withReelLock | **host** | Reel append concurrency guard; machinery. |
| `reality/seed/past/reel/reelHead.js` | ReelHead (Mongoose model) | **host** | Reel head tracking; seq allocation; machinery. |
| `reality/seed/past/reel/reelHeads.js` | reelKey, allocSeq, writeReelHead | **host** | Reel-head read/write and seq counter; machinery. |
| `reality/seed/present/intake/inbox.js` | getInboxSummary | **host** | Aggregation query over InboxProjection; the storage reader for inbox summary statistics |
| `reality/seed/present/intake/inbox.js` | readInbox | **host** | Query over InboxProjection; the storage reader for inbox entries |
| `reality/seed/present/intake/inboxOps.js` | my-inbox handler implementation | **host** | Handler logic: projection queries, identity resolution, renderer invocation; the engine machinery |
| `reality/seed/present/intake/inboxRenderers.js` | buildInboxRenderSpec, RENDERERS registry | **host** | Renderer dispatcher machinery that invokes registered renderers; the engine for evaluating UI rules |
| `reality/seed/present/intake/intake.js` | enqueueIntake | **host** | Intake storage: stamps summon facts and materializes InboxProjection rows; the transport-to-storage bridge |
| `reality/seed/present/intake/intake.js` | markIntakeRunning, markIntakeComplete, cancelIntakeByRoot | **host** | Retired tombstone functions; formerly storage mutation machinery, now no-ops |
| `reality/seed/present/intake/intake.js` | pickNextIntake | **host** | Intake picker: queries InboxProjection with priority ordering; the storage reader for the scheduler |
| `reality/seed/present/intake/scheduler.js` | _checkRate, _rate, RATE_LIMIT_BACKOFF_MS | **host** | Rate-limiting machinery: token bucket per being, summons-per-second backpressure; the stamper's rate control |
| `reality/seed/present/intake/scheduler.js` | _state registry | **host** | Per-being runtime state (running, controller, currentRoot, wakeQueue); the stamper's in-memory scheduler state |
| `reality/seed/present/intake/scheduler.js` | abortCurrent, abortByRootCorrelations | **host** | Abort machinery: cancels in-flight moments via AbortController; the moment lifecycle control plumbing |
| `reality/seed/present/intake/scheduler.js` | runLoop, processEntry | **host** | Intake machinery: picks entries by priority, enforces serial-per-being, routes to runMoment; the conductor |
| `reality/seed/present/intake/scheduler.js` | wake | **host** | Line orchestrator: queues a being's inbox and starts its runLoop; the dumb mechanism orchestrating moments |
| `reality/seed/present/intake/secretStash.js` | restoreSecrets, _stash | **host** | Secret restoration machinery: grafts held secrets back into moments; wire-layer security plumbing |
| `reality/seed/present/intake/secretStash.js` | stashSecrets | **host** | Cryptographic plumbing: separates secrets from durable facts via in-memory side channel; wire-layer security |
| `reality/seed/present/intake/transportAct.js` | dispatchTransportAct | **host** | Transport-to-intake seam: converts keystroke-arriving events into self-summon facts; the wire-stamper bridge |
| `reality/seed/present/roles/acquisition.js` | alreadyHoldsRole | **host** | Helper that checks if a being already holds a role; pure comparison logic, not world-specific |
| `reality/seed/present/roles/acquisitionOps.js` | emitInternalGrant (helper) | **host** | Internal machinery that emits a grant-role fact on I-AM's authority; the HOW facts are stamped |
| `reality/seed/present/roles/branch-manager/ops.js` | registerBranchManagerOps\|createBranch\|Branch.updateOne\|emitFact\|readPointers\|findPointersSpaceId\|doVerb\|invalidateBranchCache\|commonAncestor\|computeMergeResetFacts | **host** | Implementation mechanics: branch creation logic, MongoDB Branch model, fact emission, registry queries, pointer storage resolution, nested doVerb calls, cache invalidation, lineage walking; same for every reality |
| `reality/seed/present/roles/canStarResolver.js` | registerRelResolver, registerPatternResolver, registerNamedResolver | **host** | Resolver registry machinery; the engine's expansion infrastructure, runs the same for every reality |
| `reality/seed/present/roles/canStarResolver.js` | resolveCanStar (expansion) | **host** | Deterministic expansion engine that applies resolvers to can* entries; pure machinery |
| `reality/seed/present/roles/capabilities.js` | resolveBareCapabilities | **host** | Calls the resolver registry to expand can* entries; machinery for introspection. Infrastructure, not world-specific |
| `reality/seed/present/roles/cherub/role.js` | extractTargetName | **host** | Private parsing utility for address regex extraction. HOW: format string parsing; not a world semantic, not replayable in .word, purely internal to the handler's transport integration. |
| `reality/seed/present/roles/cherub/role.js` | mapSeedError | **host** | Private error mapping utility. HOW: bridge between JavaScript exception hierarchy and IbpError codes; not a world semantic, internal to handler error dispatch. |
| `reality/seed/present/roles/federation-manager/handlers.js` | readBucket\|dispatchToPeer\|completeOutbound\|completeIncomingOffer\|setQualityField\|resolveDefaultPlantParent\|summarizeTemplateResult | **host** | Helper mechanics: fact loading (loadOrFold), cross-reality dispatch (crossRealityDispatch), MongoDB writes, nested doVerb plumbing; same for every reality |
| `reality/seed/present/roles/federation-manager/ops.js` | sendIntent\|resolveSubtreeSpaceId\|cacheBundle\|writeNegotiation\|readNegotiation\|completeIncomingOffer\|completeIncomingRequest\|setQualityField | **host** | Helper functions: cross-reality dispatch plumbing (crossRealityDispatch), address resolution, state I/O mechanics; same for every reality |
| `reality/seed/present/roles/llm-assigner/ops.js` | add-llm operation (HOW) | **host** | Handler implementation: registerOperation, authentication checks, imported addLlmConnection function from llm/connect.js module |
| `reality/seed/present/roles/llm-assigner/ops.js` | assign-slot operation (HOW) | **host** | Handler implementation: registerOperation, auth checks, doVerb routing to assign-llm-slot verb |
| `reality/seed/present/roles/llm-assigner/ops.js` | delete-llm operation (HOW) | **host** | Handler implementation: registerOperation, auth, imported deleteLlmConnection function |
| `reality/seed/present/roles/llm-assigner/ops.js` | Helper functions (normalizeConnectionList, assertFlagMutex, writeLlmFields, getLlmAssigner, findTutorialMatter, assertTutorialMatter) | **host** | Plumbing utilities: data normalization, validation, Mongo access, projection loading, caching - execution machinery |
| `reality/seed/present/roles/llm-assigner/ops.js` | llm-assigner:complete-tutorial operation (HOW) | **host** | Handler implementation: registerOperation, ownership gate checks, end-matter verb dispatch |
| `reality/seed/present/roles/llm-assigner/ops.js` | llm-assigner:save-playback operation (HOW) | **host** | Handler implementation: registerOperation, Mongo lookups, ownership gates, doVerb routing through set-matter verb |
| `reality/seed/present/roles/llm-assigner/ops.js` | llm-assigner:start-tutorial operation (HOW) | **host** | Handler implementation: registerOperation call, Mongo projections, doVerb routing, matter creation mechanics, caching via _llmAssignerCache |
| `reality/seed/present/roles/llm-assigner/ops.js` | llm-chain SEE operation (HOW) | **host** | Handler implementation: registerSeeOperation, arg validation, name-to-id resolution, resolveLlmConnectionChain call, projection loading |
| `reality/seed/present/roles/llm-assigner/ops.js` | llm-connections SEE operation (HOW) | **host** | Handler implementation: registerSeeOperation, loadProjection Mongo queries, being.qualities access and mapping |
| `reality/seed/present/roles/llm-assigner/ops.js` | registerLlmAssignerOps function | **host** | Boot hook; coordinates operation registration for the subsystem; no operation semantics |
| `reality/seed/present/roles/llm-assigner/ops.js` | set-being-llm operation (HOW) | **host** | Handler implementation: registerOperation, writeLlmFields, being-specific logic |
| `reality/seed/present/roles/llm-assigner/ops.js` | set-reality-llm operation (HOW) | **host** | Handler implementation: registerOperation, hasHeavenAuthority checks, writeLlmFields helper, findRoot projection queries |
| `reality/seed/present/roles/llm-assigner/ops.js` | set-space-llm operation (HOW) | **host** | Handler implementation: registerOperation, writeLlmFields, Space.exists checks |
| `reality/seed/present/roles/registry.js` | registerRole, unregisterRole | **host** | Role registration API; the gate and validation machinery for the engine |
| `reality/seed/present/roles/registry.js` | REGISTRY (role registry machinery) | **host** | The in-memory role registry and handlers map; registration, lookup, and validation machinery that runs identically every reality |
| `reality/seed/present/roles/registry.js` | syncRolesToSubstrate, loadLiveRolesFromSubstrate | **host** | Bootstrap machinery that syncs the registry to/from substrate; engine setup, not world semantics |
| `reality/seed/present/roles/role-manager/ops.js` | delete-role operation (HOW) | **host** | Handler implementation: registerOperation machinery, Mongo queries (Being.find), removeManifestChild, unregisterRole registry calls |
| `reality/seed/present/roles/role-manager/ops.js` | Helper functions (parseLines, derivePermissions, findRoleReferences, parseSignalValue) | **host** | Plumbing utilities: string parsing, permission derivation from capabilities, Mongo scanning, JSON coercion - execution machinery |
| `reality/seed/present/roles/role-manager/ops.js` | registerRoleManagerOps function | **host** | Boot hook; no operation logic, only invocation marker for genesis.js sequencing |
| `reality/seed/present/roles/role-manager/ops.js` | set-role operation (HOW) | **host** | Handler implementation: registerOperation call, identity verification, permission checks, Mongo interactions, manifest machinery (addManifestChild), hot registration |
| `reality/seed/present/roles/role-manager/ops.js` | set-world-signal operation (HOW) | **host** | Handler implementation: registerOperation machinery, field path construction, doVerb calls, reality-root lookup via getSpaceRootId |
| `reality/seed/present/roles/role-manager/roleFlowOp.js` | set-being-roleflow operation (HOW) | **host** | Handler implementation: registerOperation call, target resolution logic, schema validation plumbing, doVerb routing through set-being verb |
| `reality/seed/present/roles/roleComposer.js` | composeStack (stack composition) | **host** | Deterministic machinery: unions role specs (capabilities, permissions, prompts). Same mechanical operation every reality |
| `reality/seed/present/roles/roleFlow.js` | computeAvailableRoles (grant-to-spec lookup) | **host** | Deterministic projection machinery; walks grants to their specs and checks reach. Engine operation, same for every reality |
| `reality/seed/present/roles/roleFlow.js` | evalWhen (condition evaluator) | **host** | Pure-function evaluator for when-clauses using operator semantics. Host machinery for condition evaluation |
| `reality/seed/present/roles/roleFlow.js` | resolveActiveStack (evaluator) | **host** | The evaluator is pure, deterministic computation that walks conditions against a context object. The HOW is host; machinery for every reality |
| `reality/seed/present/roles/spaceLookup.js` | getRoleSpecForGrant (lookup logic) | **host** | Deterministic ancestry walk machinery to find where a role is hosted; engine operation, same every reality |
| `reality/seed/present/roles/spaceLookup.js` | roleReachesTarget (reach evaluation) | **host** | Pure-function reach matcher using pattern semantics; deterministic authorization machinery |
| `reality/seed/present/stamper/1-assign.js` | assign (beat 1) | **host** | Scheduler intake dispatcher — mints actId, opens the moment frame, plans the Act row, builds summonCtx. No world-specific logic. |
| `reality/seed/present/stamper/2-fold/canSeeResolver.js` | resolveCanSee, canSeeAdmitsReel | **host** | Dispatch infrastructure for role.canSee; invokes world see operations and address resolvers; machinery not the operations themselves. |
| `reality/seed/present/stamper/2-fold/foldBeat.js` | runFoldBeat (beat 2) | **host** | Orchestrates fold beat; mounts foldedFace and innerFace on summonCtx; invokes projection machinery. |
| `reality/seed/present/stamper/2-fold/foldEngine.js` | fold, rebuild, foldEngine | **host** | Generic fold orchestrator over material types; dispatches by type to reducers; manages foldedSeq marker and CAS. |
| `reality/seed/present/stamper/2-fold/foldPlace.js` | foldPlace, foldByOrientation | **host** | Cross-reel weave orchestrator; folds being + space + occupants by orientation (forward/inward/half); fold machinery. |
| `reality/seed/present/stamper/2-fold/innerFace.js` | buildInnerFace, clampForRender | **host** | Canonical inner-face structure builder; merges orientation + role + position + capabilities + canSee blocks; defensive clamping. |
| `reality/seed/present/stamper/2-fold/orientation.js` | validateOrientation, ORIENTATION | **host** | Orientation validation and constants (forward/inward/half); machinery, not policy. |
| `reality/seed/present/stamper/2-fold/reel.js` | presenceKeyFor, reelChainFold | **host** | Durable record fold for prompts; compatibility stubs for deprecated in-memory reel cache; machinery. |
| `reality/seed/present/stamper/2-fold/reelChains.js` | findByIbpAddress, reelChainFold | **host** | Act-chain read-side over Act collection for single ibpAddress; fold input source; machinery. |
| `reality/seed/present/stamper/2-fold/weave.js` | emptyWeave, addReel, mergeWeaves | **host** | Reel-set tracking for fold weave; residue of reels read during moment; machinery. |
| `reality/seed/present/stamper/3-momentum.js` | momentum (beat 3) | **host** | Dispatches summon or transport-act by kind; normalizes cognition results; runs the being's motion through the verb dispatcher. |
| `reality/seed/present/stamper/4-stamped.js` | sealAct (beat 4) | **host** | Seals act row atomically with deltaF; fires closure side-effects (inbox, thread projections); commit boundary. |
| `reality/seed/present/wakes/subscriptions.js` | _byBeing, _byEvent, _pendingCoalesce registries | **host** | Runtime projection state (in-memory indexes and coalesce windows); the stamper's cached view for dispatch |
| `reality/seed/present/wakes/subscriptions.js` | emitToSubscribers | **host** | Event-time dispatch machinery that fires summons to matching subscribers; the engine for evaluating rules |
| `reality/seed/present/wakes/subscriptions.js` | rehydrateFromFacts | **host** | Fact-chain projector that materializes runtime subscriptions from facts; the fold for liveness |
| `reality/seed/present/wakes/wakeSchedule.js` | _defaultEmitter | **host** | Default mechanism for emitting scheduled summons; the dispatch plumbing (facts, identity resolution, summon verb) |
| `reality/seed/present/wakes/wakeSchedule.js` | _registry, _byBeing, _tickHandle | **host** | Runtime scheduler state (registry, tick handle); the stamper's cached view for cadence dispatch |
| `reality/seed/present/wakes/wakeSchedule.js` | rehydrateFromFacts | **host** | Fact-chain projector that materializes runtime schedules from facts; the fold for liveness |
| `reality/seed/present/wakes/wakeSchedule.js` | runOnce, startTickLoop | **host** | Tick machinery and cadence-driven dispatch; the engine executing scheduled wakes |
| `reality/seed/services.js` | buildRealityServices | **host** | Assembles the reality object handed to extensions - host services wiring and composition |
| `reality/seed/services.js` | getRealityServices | **host** | Retrieves last-built reality services bundle - host machinery |
| `reality/seed/sprout.js` | ensureIAm | **host** | Genesis step: I-Am's be:birth moment - bootstrap host machinery that opens the genesis sequence |
| `reality/seed/sprout.js` | ensureSpaceRoot | **host** | Genesis step: place root creation, heaven spaces, repair reconciliation - host bootstrap machinery |
| `reality/seed/sprout.js` | setIAmHomeSpace | **host** | Genesis step: point I-Am's homeSpace to heaven - bootstrap host machinery |
| `reality/seed/sprout.js` | withBeingAct | **host** | Generalized moment primitive for any being (act-chain lock, head read, seal) - bootstrap host machinery |
| `reality/seed/sprout.js` | withGenesisGuard | **host** | Singleton guard ensuring genesis runs once per process - bootstrap host machinery |
| `reality/seed/sprout.js` | withIAmAct | **host** | I-Am's moment primitive (opens act-chain lock, reads head, seals fact array) - bootstrap host machinery for genesis sequence |
| `reality/transports/http/api/content.js` | GET /api/v1/uploads/*, POST /api/v1/uploads/* | **host** | Content serving and upload handling; transport machinery. |
| `reality/transports/http/api/ibp.js` | POST /ibp/:verb/*, GET /ibp/see/* | **host** | IBP HTTP adapter; envelope fabrication and dispatch; pure transport plumbing. |
| `reality/transports/http/auth.js` | authPageRouter, authApiRouter | **host** | Authentication page and API routes; session cookie/JWT machinery. |
| `reality/transports/http/dispatch.js` | makeHttpCarrier, dispatchAndWait, sendAck | **host** | HTTP request→IBP envelope fabrication; dispatch orchestration; machinery. |
| `reality/transports/http/handler.js` | registerRoutes | **host** | HTTP route mounting and middleware stacking; pure plumbing. |
| `reality/transports/http/middleware/authenticate.js` | authenticate middleware | **host** | Token extraction and verification middleware; machinery. |
| `reality/transports/http/middleware/dbHealth.js` | dbHealth middleware | **host** | MongoDB health check; 503 on down; machinery. |
| `reality/transports/http/middleware/preUploadCheck.js` | preUploadCheck middleware | **host** | Upload precondition checks; machinery. |
| `reality/transports/http/middleware/securityHeaders.js` | securityHeaders middleware | **host** | HTTP security headers; machinery. |
| `reality/transports/http/users.js` | JWT user context helpers | **host** | User extraction from JWT; machinery. |
| `reality/transports/mcp/server.js` | attachMcp (dormant transport adapter) | **host** | Dormant MCP protocol adapter; future federation wrapper; machinery (not presently wired). |
| `reality/transports/ws/autoRelease.js` | scheduleAutoRelease, cancelAutoRelease | **host** | WebSocket idle cleanup; machinery. |
| `reality/transports/ws/websocket.js` | attachIbpHandlers, noteSocketConnected, emitToBeings, scheduleAutoRelease | **host** | WebSocket/socket.io transport layer; per-being socket tracking; push-channel registration; machinery. |
| `reality/seed/materials/being/being.js` | comparePassword | **host** | Mongoose schema method wrapping bcrypt comparison, host crypto machinery |
| `reality/seed/materials/being/beingId.js` | beingContentId | **host** | Content-addressed ID from birth spec, host crypto machinery |
| `reality/seed/materials/being/beingsCatalog.js` | describeBeingsCatalog | **host** | Global being catalog descriptor, host SEE machinery |
| `reality/seed/materials/being/closure.js` | isBeingDead | **host** | Lifecycle gate reading death projection, host liveness guard |
| `reality/seed/materials/being/closure.js` | isDeathFact | **host** | Fact classification for stamper exception, host machinery |
| `reality/seed/materials/being/identity.js` | identity (re-export module) | **host** | Public surface re-exporting identity/* functions, host module aggregator |
| `reality/seed/materials/being/identity/birth.js` | beingContentId | **host** | Content-addressed ID hash computation, host crypto machinery |
| `reality/seed/materials/being/identity/birth.js` | generateUniqueName | **host** | Name generation with collision avoidance, host machinery |
| `reality/seed/materials/being/identity/birth.js` | validateName | **host** | Input validation helper, host state-consistency enforcement |
| `reality/seed/materials/being/identity/birth.js` | validatePassword | **host** | Input validation helper, host security enforcement |
| `reality/seed/materials/being/identity/credentials.js` | decryptCredential | **host** | AES-GCM decryption for credentials, host crypto machinery |
| `reality/seed/materials/being/identity/credentials.js` | encryptCredential | **host** | AES-GCM encryption for credentials, host crypto machinery |
| `reality/seed/materials/being/identity/credentials.js` | generateToken | **host** | JWT issuance, host session auth crypto |
| `reality/seed/materials/being/identity/credentials.js` | mintCredentialSpec | **host** | Credential minting with password hashing, host security machinery |
| `reality/seed/materials/being/identity/credentials.js` | verifyPassword | **host** | Bcrypt password verification, host crypto machinery |
| `reality/seed/materials/being/identity/credentials.js` | verifyTokenStrict | **host** | JWT verification + revocation, host session machinery |
| `reality/seed/materials/being/identity/inheritation.js` | hasAuthorityOver | **host** | Authority walk up being-tree, host access-control machinery |
| `reality/seed/materials/being/identity/inheritation.js` | livePointsAt | **host** | Latest-of-two grant/revoke Fact fold, host fold machinery |
| `reality/seed/materials/being/identity/lineage.js` | findBeingParent | **host** | Lineage fold: reads be:birth Fact for parent, host fact-chain read |
| `reality/seed/materials/being/identity/lineage.js` | hasCredentialAuthority | **host** | Authority check over being-tree, host authorization machinery |
| `reality/seed/materials/being/identity/lineage.js` | isDetachedFromBeingParent | **host** | Latest-of-two Fact read for detach/attach state, host fold machinery |
| `reality/seed/materials/being/identity/lookups.js` | beingCognition | **host** | Cognition resolver from projection, host cognition read logic |
| `reality/seed/materials/being/identity/lookups.js` | findIAm | **host** | Read helper finding I-Am via projection, host lookup machinery |
| `reality/seed/materials/being/identity/lookups.js` | findRootOperator | **host** | Read helper finding first non-system being, host lookup machinery |
| `reality/seed/materials/being/identity/lookups.js` | iAmIdentity | **host** | Cache wrapper for I-Am identity, host machinery |
| `reality/seed/materials/being/identity/lookups.js` | isAncestorOf | **host** | Lineage walk helper, host tree traversal machinery |
| `reality/seed/materials/being/inheritationOps.js` | assertAuthorityOverPosition | **host** | Validation helper for authority, host access-control |
| `reality/seed/materials/being/inheritationOps.js` | assertGrantableName | **host** | Validation helper checking Name declared/not-banished, host state-consistency |
| `reality/seed/materials/being/ops.js` | assertCoordInBounds | **host** | Validation helper for spatial coordinates, host state-consistency |
| `reality/seed/materials/being/position.js` | getCurrentSpace | **host** | Position cache read, host being location access |
| `reality/seed/materials/being/position.js` | getRootIdFor | **host** | Root ID cache read, host location state access |
| `reality/seed/materials/being/position.js` | setCurrentSpace | **host** | Position cache + fact emission, host being location state management |
| `reality/seed/materials/being/positionAddress.js` | formatPositionAddress | **host** | Position string formatting, host cross-world encoding machinery |
| `reality/seed/materials/being/positionAddress.js` | isPositionCrossWorld | **host** | Cross-world detection, host routing machinery |
| `reality/seed/materials/being/positionAddress.js` | parsePositionAddress | **host** | Position string parsing, host cross-world encoding machinery |
| `reality/seed/materials/being/pullBack.js` | pullBackForeignPositions | **host** | Bootstrap safety for foreign positions, host recovery machinery |
| `reality/seed/materials/being/reducer.js` | initial | **host** | Empty initial state for reducer, host fold machinery |
| `reality/seed/materials/being/reducer.js` | reduce | **host** | Pure being projection reducer, host fold machinery |
| `reality/seed/materials/being/seedDelegates.js` | ensureSeedDelegates | **host** | Bootstrap machinery ensuring delegate rows exist, host genesis machinery |
| `reality/seed/present/roles/angel/role.js` | angelRole.name:description:reach:requiredCognition:respondMode:triggerOn | **host** | Role envelope and dispatch configuration: reach policy (extended reality-wide), message trigger, and null cognition are host infrastructure |
| `reality/seed/present/roles/birther/role.js` | birtherRole.name:description:requiredCognition:respondMode:triggerOn:permissions | **host** | Role declaration envelope: metadata, dispatch configuration, and async/messaging infrastructure are host concerns |
| `reality/seed/present/roles/birther/role.js` | birtherRole.summon | **host** | Summon function signature, message dispatch mechanism, ctx handling, and failure/act infrastructure are host patterns |
| `reality/seed/present/roles/global/role.js` | globalRole.name:description:requiredCognition:respondMode:triggerOn | **host** | Role envelope and dispatch configuration: null cognition, message trigger, reach defaults are host infrastructure for anchored-scoped roles |
| `reality/seed/present/roles/human/role.js` | humanRole.name:description:respondMode:triggerOn | **host** | Role envelope and dispatch configuration: empty triggerOn (no auto-processing) is host infrastructure that humans don't auto-dispatch |
| `reality/seed/present/roles/human/role.js` | humanRole.summon | **host** | No-op summon function: transport-layer fact that humans don't auto-process through kernel scheduler; receptive pattern is host concern |
| `reality/seed/present/roles/public/role.js` | publicRole.name:description:requiredCognition:respondMode:triggerOn | **host** | Role envelope and dispatch configuration: scripted cognition flag and no-trigger pattern are host infrastructure |
| `reality/seed/present/roles/public/role.js` | publicRole.summon | **host** | No-op summon function: permanent silent dropout is host-level dispatch behavior (messages addressed to public are dropped by kernel) |

## Zero untagged

Every walked site in scope carries exactly one **word** or **host** tag; there are no untagged, double-tagged, or undecided sites across the 580 inventoried. The files a reader is most likely to expect "pure" but which are in fact mixed at the symbol level are the per-op files where a WHAT/HOW split runs through a single module: `reality/seed/ibp/nameOps.js` (the NAME act semantics are word, but `declareHandler HOW`, `keypairFromImport`, `connectNameHandler HOW`, and `releaseNameHandler HOW` are host), `reality/seed/ibp/setRender.js` (the act is word, the validator and dispatch are host), `reality/seed/materials/matter/ops.js` and `reality/seed/materials/space/ops.js` (operation declarations word, handler mechanics host), `reality/seed/ibp/descriptor.js` (view-shaping builders word, fold/serialize machinery host), `reality/seed/ibp/authorize.js` (auth rules word, dispatch entry-point host), and every `present/roles/*/ops.js` LLM-assigner, federation, branch-manager, and role-manager file (each operation appears twice — a word "(WHAT)" row and a host "(HOW)" row). `reality/seed/present/roles/cherub/role.js` is the densest mixed file: nearly all of it is word (the BE handlers, the registration flow, the mate handler, the cherub being), with only the two private utilities `extractTargetName` and `mapSeedError` cut to host. These splits are intentional, not residue.

## The host boundary (prose statement)

The host is the engine that runs acts and keeps the chain, and nothing more: it is the stamper with its four beats (assign, fold, momentum, stamped) that opens a moment, mints an actId, and seals it; the fact and act chain with their content-addressed hashing (`computeHash`, `computeActHash`, the canonical digest and `GENESIS_PREV` linkage), reel-head sequence allocation, append locks, and chain-root tracking; the signing machinery (act signatures, bundle signatures, ed25519 key custody, password/scrypt/AES credential encryption, JWT issuance and verification) that makes every act provable; the fold and projection layer — the generic reducer registry, `loadOrFold`, branch-aware projection caches, ancestor and position caches, and the cross-cutting inbox/threads/position fold handlers — that deterministically replays facts into cached state the same way for every reality; the storage backend itself (Mongo schemas for Being, Space, Matter, Name, Fact, Act, Branch, and all projections, plus the content store and CAS blob persistence); the transports (HTTP routes and middleware, WebSocket/socket.io, the dormant MCP adapter, and the push channel) that fabricate verb envelopes and carry them in and out; the rate limiters and scheduler (the per-being token bucket, serial lanes, intake picker, abort controllers, and tick loop) that pace and serialize moments without deciding their meaning; the session channels and signing sessions (the in-memory key latch, TTL expiry, connect/release session-state plumbing); and the parser/evaluator and dispatch grammar (IBP address parse/format/expand/validate, the verb dispatchers for SEE/DO/BE/NAME/SUMMON, the operation and role registries, the canStar/roleFlow condition evaluators, and the protocol error mapping). All of this runs identically regardless of which world is loaded; it carries no reality-specific decision about who may see, do, summon, or be — those decisions are the word.

---
*This is the spec for Phase 5 (the conversion sweep). It changes no code.*
