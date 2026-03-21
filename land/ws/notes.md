[Available Tools - READ ONLY]

- get-tree: Fetch tree structure (with optional status filters)
- get-node: Fetch detailed node data
- get-node-notes: Get notes for a node version
- get-node-contributions: Get contribution history
- get-unsearched-notes-by-user: Recent user notes
- get-searched-notes-by-user: Search notes by text
- get-all-tags-for-user: Get tagged notes (mail)
- get-contributions-by-user: User's contribution history
- get-raw-ideas-by-user: User's inbox/raw ideas
- get-root-nodes: Get all user's root trees

[Available Tools - WRITE]

- edit-node-version-value: Update numeric values
- edit-node-version-goal: Update goals (must match existing value key)
- edit-node-or-branch-status: Change status (active/trimmed/completed)
- edit-node-version-schedule: Update schedule and reeffect time
- add-node-prestige: Increment prestige, create new version
- create-node-version-note: Add a text note
- delete-node-note: Remove a note
- create-new-node: Create single node
- create-new-node-branch: Create recursive node structure
- edit-node-name: Rename a node
- update-node-branch-parent-relationship: Move node to new parent
- update-node-script: Create/update a script
- execute-node-script: Run a stored script
- transfer-raw-idea-to-note: Convert inbox item to note

[Available Tools - ORCHESTRATORS]

- tree-start: Entry point, loads context for a specific tree
- tree-actions-menu: Present action options
- tree-structure-orchestrator: Guide tree restructuring
- be-mode-orchestrator: Guided node traversal mode
- javascript-scripting-orchestrator: Script creation workflow
- raw-idea-filter-orchestrator: Process inbox items
- node-script-runtime-environment: Script API documentation

[Available Tools - UNDERSTANDING]

- understanding-create: Start understanding run
- understanding-next: Get next summarization task
- understanding-capture: Save summarization result
- understanding-finisher: Auto-complete understanding run

i think after this tree start will be redudant and explained through various system instructions depending on mode. i think most of the orchestrators are useless now since we can put in system instructions and restart conversation.

i want tools and conversation state to be tied to specific modes, that way LLM isnt overwhelmed. there will be BIG MODES, for now just HOME and TREE, and then modes inside which are what provide the system instructions for what the LLM is doing and give it list of all tools it can use in that mode.

a mode. there will be alerts in chat when modes switch (quick popup at top left). modes switch in 3 differnt ways:

1. user switches manually based off whats visible in mode bar (at top left, shows current and can click to see emojis to change differnt modes with tooltips saying what they are)
2. BIG MODE switches based on app context (URL determines where at, such as if at /user/userId it is in home mode and shows/works with home tools, and /:nodeId or /root/:nodeId is tree mode selection, and shows the mdoes and works with proper tools inside each mode). but user will still have to choose which mode once inside.
3. this will probably come later but AI intent determiner scans every message and changes mode if improper request for that mode, going to tree or home and proper mode, etc. but for now we will leave it changing based on URL and if user chooses mode manually. when entering tree mode, it will start on create and when entering home mode it will start on default

whenever a mode is switched, the conversation is restarted with new system instructions for appropriate mode and all the tools/what mode does. it also will carry the last 4 messages from previous conversation or hwoeve many is best to keep context after switch.
i think maybe some specialty to the reflect mode since it can be used to make new plans so connversation context carrying over to create or edit node mode, etc could be useful to form structure from talking.

# HOME (profile mode):

modes =
(raw-idea-placement,

- get-raw-ideas-by-user: User's inbox/raw ideas
- raw-idea-filter-orchestrator: Process inbox items

reflect(notes,mail,tags, contributions),
get-unsearched-notes-by-user: Recent user notes

- get-searched-notes-by-user: Search notes by text
- get-all-tags-for-user: Get tagged notes (mail)
- get-contributions-by-user: User's contribution history
- get-raw-ideas-by-user: User's inbox/raw ideas

defailt (like the intro before any intent is determined and site first loads))

- get-root-nodes: Get all user's root trees

# TREE

modes:
build (structure) = creating branches. updating parents.

- get-tree: Fetch tree structure (with optional status filters)
- get-node: Fetch detailed node data
- create-new-node: Create single node
- create-new-node-branch: Create recursive node structure
- edit-node-name: Rename a node
- update-node-branch-parent-relationship: Move node to new parent

Edit nodes = manually revise nodes and node data (all node edits tools)

- edit-node-version-value: Update numeric values
- edit-node-version-goal: Update goals (must match existing value key)
- edit-node-or-branch-status: Change status (active/trimmed/completed)
- edit-node-version-schedule: Update schedule and reeffect time
- add-node-prestige: Increment prestige, create new version
- get-tree: Fetch tree structure (with optional status filters)
- get-node: Fetch detailed node data
- create-node-version-note: Add a text note
- delete-node-note: Remove a note
- edit-node-name: Rename a node

BE = leaf mode focused traversal, going through each leaf node and doing it with user, adding notes, and marking complete and onto next. i had orchestrator but i think it can be explain in system instructions, and conversation can lopo every 50 messages but keep the rpevious context if branch unfinished so it can loop without getting overloaded or ranomly resetting.

Reflect (understand here): talk about tree data and run understand processes

- get-tree: Fetch tree structure (with optional status filters)
- get-node: Fetch detailed node data
- get-node-notes: Get notes for a node version
- get-node-contributions: Get contribution history
  -- understanding-create: Start understanding run
- understanding-next: Get next summarization task
- understanding-capture: Save summarization result
- understanding-finisher: Auto-complete understanding run
