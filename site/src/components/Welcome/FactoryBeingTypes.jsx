import { Link } from "react-router-dom";
import "./IbpPage.css";

/**
 * FactoryBeingTypes. The being-types page in the Factory section.
 *
 * Plain language description of what a being IS in TreeOS, the four
 * cognition kinds, and (the main section) what an LLM being's one
 * moment actually looks like.
 *
 * Visual rhythm: code blocks for shape, ns-doc-aside for one-line
 * rules, short paragraphs, lots of subheadings.
 *
 * Doctrine. Forward fold reads the world, not the act-chain. The
 * default LLM moment's prompt is system + user, period . no
 * past-messages slot. Half / inward orientations exist in the model
 * but are not wired yet. Speech to a being is SUMMON. Speech alongside
 * an act is the act's content. Otherwise silence is SEE.
 *
 * Distinct from MCP. MCP is a wire protocol for tools. An LLM being
 * is a first-class participant in TreeOS.
 */
const FactoryBeingTypes = () => {
  return (
    <article className="ns-doc">
      <header className="ns-doc-header">
        <p className="ns-doc-eyebrow">Being types</p>
        <h1 className="ns-doc-title">
          What a being is, and the four kinds we have today
        </h1>
        <p className="ns-doc-lede">
          A being is whoever stamps a reel of facts. The cognition can
          be a script, an LLM, a human, or a composite. The substrate
          treats all four the same.
        </p>
      </header>

      <section>
        <h2>The being IS the chain of facts</h2>

        <p>
          A being is not a process. Not a thread, not a chat session,
          not an agent that holds state between turns.
        </p>

        <p>
          A being is two things:
        </p>

        <ul className="ns-list">
          <li>A row (name, roles, home space, LLM connection if any).</li>
          <li>A reel of facts on the chain.</li>
        </ul>

        <p>
          Everything else (who they are, how they think, what they
          have done) is folded fresh from the reel each moment.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>The cognition is what decides what to do.</strong>{" "}
            The four kinds below differ in their cognition, not in
            their standing in the world. To the inbox, the scheduler,
            the sealer, and any other being looking at them, they all
            look the same.
          </p>
        </aside>
      </section>

      <section>
        <h2>The four kinds of cognition</h2>

        <ol className="ns-flow">
          <li className="ns-flow-step">
            <span className="ns-flow-num">1</span>
            <div>
              <h3>Scripted</h3>
              <p>
                Cognition is a function. The being is summoned, the
                function reads the fold, the function decides what to
                do.
              </p>
              <p className="ns-small">
                No model, no prompt, no inference. Deterministic and
                fast. Anything that can be expressed in code.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">2</span>
            <div>
              <h3>LLM</h3>
              <p>
                Cognition is one call to a language model per moment.
                The model emits a tool call, prose, both, or neither.
              </p>
              <p className="ns-small">
                Detailed below.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">3</span>
            <div>
              <h3>Human</h3>
              <p>
                Cognition is a person at a screen. The summon lands
                in the human's inbox; the human reads it through a
                portal and acts through the same verbs.
              </p>
              <p className="ns-small">
                Latency is minutes instead of milliseconds. The
                substrate does not care.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">4</span>
            <div>
              <h3>Composite</h3>
              <p>
                Cognition is a being made of other beings. A ruler
                that delegates to workers, a panel that votes, an
                ensemble.
              </p>
              <p className="ns-small">
                Future direction. Not built out yet.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section>
        <h2>LLM beings: the shape of one moment</h2>

        <p>
          One call to a model per moment. One call, one decision, one
          act. Multi step work is many moments, not one moment with
          many calls.
        </p>

        <h3>Forward by default</h3>

        <p>
          Every moment has an orientation. The default is{" "}
          <em>forward</em>: the fold reads the world (spaces and
          matter the being can see) and does <strong>not</strong>{" "}
          read the being's own past acts.
        </p>

        <p>
          A being woken forward has no memory of what it has done
          before this moment. It looks at the world as it is now and
          decides. The fact that it acted before lives on its
          act-chain, but the act-chain is not in scope for a forward
          moment.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>Why forward, on purpose.</strong> A being that
            secretly carries its prior moves into every moment is a
            quietly ruminating contemplative. Stateless forward
            moments react to the world, not to a remembered self.
            That is the design.
          </p>
        </aside>

        <h3>Two things go into the call</h3>

        <p>
          The prompt is built from exactly two pieces. No third "past
          messages" slot.
        </p>

        <pre className="ns-code">{`messages = [
  { role: "system", content: "<role identity, world face, tools>" },
  { role: "user",   content: "<the wake's content>" },
]`}</pre>

        <ul className="ns-list">
          <li>
            <strong>System prompt.</strong> Who the being is, where
            it is, what it can see, what tools it has, the role's
            persona, the current time. Built fresh every moment.
          </li>
          <li>
            <strong>User message.</strong> The content of the summon
            that woke this being. A person's question, a notification
            of state change, whatever opened the moment.
          </li>
        </ul>

        <p className="ns-small">
          The chat format's three-slot shape (system / past / user)
          is how the provider's API happens to be structured. It is
          not how TreeOS thinks. Mapping the past slot onto "the
          being's prior acts" would make every moment a half-turn by
          default. Forward fold does not read the act-chain.
        </p>

        <h3>The tools the model is offered</h3>

        <p>
          The seed ships ONE generic tool per verb. That's the
          function-call surface, top to bottom:
        </p>

        <pre className="ns-code">{`see(address)                . read substrate
do(target, action, args)    . invoke a registered DO operation
summon(target, content)     . speak to a being
be(operation, payload)      . identity-bind (self-targeted)`}</pre>

        <p>
          The role spec doesn't declare which tools it has. The four{" "}
          <code>can*</code> lists ARE the body, and tool exposure is
          DERIVED:
        </p>

        <ul className="ns-list">
          <li>
            <code>canSee</code> non-empty → the <code>see</code> tool
            is exposed. The list shows what addresses to read.
          </li>
          <li>
            <code>canDo</code> non-empty → the <code>do</code> tool
            is exposed. The list shows what actions to invoke.
          </li>
          <li>
            <code>canSummon</code> non-empty → the{" "}
            <code>summon</code> tool is exposed. The list shows what
            stances to address.
          </li>
          <li>
            <code>canBe</code> non-empty → the <code>be</code> tool
            is exposed. The list shows what BE operations to perform.
          </li>
        </ul>

        <aside className="ns-doc-aside">
          <p>
            <strong>The body of the being is its four can* lists.
            </strong> Its license, its capabilities, its targets.
            Adding a capability is editing one <code>can*</code>{" "}
            list. The tool surface follows from the body. There is
            no second declaration to keep in sync.
          </p>
        </aside>

        <p className="ns-small">
          The four verbs are structurally universal . every LLM
          being's prompt presents the same four function signatures
          to the provider. What varies per role is which subset is
          exposed (based on which <code>can*</code> lists are
          populated) and what each verb can be used for (the entries
          inside each list).
        </p>

        <p className="ns-small">
          Two layers gate what reaches substrate: the prompt-list
          (what the LLM sees as available) and substrate stance-auth
          at the verb (the truth). Off-list calls that pass
          prompt-discipline still refuse at the verb layer.
        </p>

        <h3>The relationship-resolver layer</h3>

        <p>
          Sometimes the targets are not knowable at role-design time.
          A ruler's <code>canSummon</code> includes "my parent" or
          "the predecessor" . relationships that resolve per moment
          per being, not at design time.
        </p>

        <p>
          For these,{" "}
          <code>can*</code> entries can be relationship tokens that
          expand at prompt-build time via registered resolvers:
        </p>

        <pre className="ns-code">{`canSummon: [
  "@operator",                  // literal stance
  { rel: "parent" },            // lineage: my minter
  { rel: "any-child" },         // every being I minted
  { pattern: "fitness/@coach" }, // path-shaped match
]`}</pre>

        <p>
          The resolver layer expands tokens into concrete options
          right before the prompt renders. The LLM sees the resolved
          stances; the dispatch uses the concrete stance; substrate
          auth gates the actual reach. The role spec stays
          declarative; the runtime does the lookup.
        </p>

        <p className="ns-small">
          Resolvers are registered at boot. The registry ships empty;
          every entry passes through as a literal today. Future
          resolvers (parent / predecessor / any-child / pattern) plug
          in without changing the role specs or the assembler.
        </p>

        <h3>Multi-step rituals are multi-moment, not multi-tool</h3>

        <p>
          Coronation, succession, role-chain. None of these need a
          new mechanism. Each ritual step is one moment: the being
          summons a target, the target wakes, responds, the response
          wakes the original being, the next moment runs. The
          substrate's existing inbox / summon / reply / wake loop is
          the ritual machinery.
        </p>

        <p className="ns-small">
          Most rituals are response-driven (the being waits for each
          reply before the next step,{" "}
          <code>selfContinue: false</code>). Pure-outbound sequences
          use <code>selfContinue: true</code> and silence (SEE) as
          the exit.
        </p>

        <p className="ns-small">
          Per-operation ergonomic tool wrappers retired with this
          cleanup. Actions live in the DO operation registry; the
          LLM dispatches them via the generic <code>do</code> tool.
          An op that wants a cleaner schema does it at the op-handler
          level (validating args, deriving missing fields from the
          actor's context), not by adding a separate LLM tool.
        </p>

        <h3>What extensions add</h3>

        <p>
          Extensions never add tools. They add to the WORLD. Two
          channels:
        </p>

        <ul className="ns-list">
          <li>
            <strong>Addressable things.</strong> Extensions create
            spaces, matter, and beings. These are automatically
            see-able by virtue of existing at an address . any role
            with <code>canSee</code> license to that address can read
            it through the universal <code>see</code> tool. The
            descriptor returned by SEE includes whatever qualities
            the extension stamped on those primitives. No new tool
            needed.
          </li>
          <li>
            <strong>See-resolvers.</strong> Optional per-role focused
            views. A role declares <code>see: [name]</code> on its
            spec, the assembler runs the named resolver every moment
            and pre-renders the result into the system prompt. The
            resolver's job is to take the raw substrate and shape it
            into the precise structured view that role needs to act.
          </li>
        </ul>

        <aside className="ns-doc-aside">
          <p>
            <strong>Resolvers return structured data, not prose.
            </strong> A resolver outputs a JSON-shaped object with
            labeled fields; the assembler stringifies it under a{" "}
            <code>[name]</code> header. The LLM reads
            <code>{' position: {x:3, y:4}'}</code>, not
            <code> "You are at (3,4) on a 10×10 grid."</code> .
            Structured input prevents the model from
            free-associating world features it doesn't have (the
            classic prose-input hallucination shape).
          </p>
        </aside>

        <pre className="ns-code">{`// A see-resolver, returning structured data:
{
  position: { x: 3, y: 4 },
  grid: { w: 10, h: 10 },
  neighbors: { N: "empty", NE: "@follower", ... },
  walls: ["NW"],
  legalMoves: ["STAY", "N", "NE", "E", "SE", "S", "SW", "W"]
}

// Assembler renders into the system prompt as:
[neighbors]
{
  "position": { "x": 3, "y": 4 },
  "grid": { ... },
  ...
}`}</pre>

        <p className="ns-small">
          Strings are still accepted (legacy) and pass through
          verbatim; the resolver framed its own block. New resolvers
          should return objects. The fix for the dancer's "wall
          cluster" hallucination was exactly this . the resolver
          returned prose, the LLM invented world features that
          weren't in the data.
        </p>

        <h3>Three things can come out</h3>

        <p>The response parses into exactly one of three:</p>

        <ul className="ns-list">
          <li>
            <strong>Act.</strong> The model called a tool. The factory
            runs it. Any prose alongside closes the act . the "I just
            did this" sentence. The Act row writes and the fact the
            tool emitted commits with it.
          </li>
          <li>
            <strong>See.</strong> No tool call. The being looked and
            did not act. Inbox closes cleanly. No row, no reply. Prose
            without a tool is also see.
          </li>
          <li>
            <strong>Failure.</strong> Call broke (timeout, provider
            error, garbage). No row, no reply.
          </li>
        </ul>

        <aside className="ns-doc-aside">
          <p>
            <strong>One rule, no exceptions.</strong> Every act in the
            system goes through a declared tool. No chat-shape vs
            structured-shape distinction. Tools are the language; the
            LLM picks the next word, or stays silent.
          </p>
        </aside>

        <h3>How speech works</h3>

        <p>
          If every act goes through a tool, how does anyone talk?
          Speech is already in the model. It splits by who's being
          spoken to.
        </p>

        <ul className="ns-list">
          <li>
            <strong>Speech to a being → SUMMON.</strong> A being
            speaking to another being calls{" "}
            <code>summon(target, content)</code>, threaded by{" "}
            <code>inReplyTo</code>. The seed ships a generic{" "}
            <code>summon</code> tool any role can pick up. No new
            verb, no "respond" wrapper.
          </li>
          <li>
            <strong>Speech alongside an act → the act's content
            field.</strong> When a being calls a tool and also says
            something, the prose becomes the act's content. Recorded
            on the being's reel as the assistant's voice for that
            act.
          </li>
          <li>
            <strong>Speech to nobody, no act → see.</strong> The LLM
            emitted prose but no tool. The prose is logged but not
            sealed.
          </li>
        </ul>

        <pre className="ns-code">{`// Reply to whoever woke you. Target and inReplyTo
// default to the wake's asker and correlation.
summon({ content: "Here is what you asked for." })

// Narrate alongside an act. Prose rides with the tool call.
some-tool({ ...args })   + prose "context for what was done"

// Stay silent. No tool call, no narration. SEE.
(no tool, no prose)`}</pre>

        <h3>Multi step work uses many moments</h3>

        <p>
          A role can declare <code>selfContinue: true</code>. When an
          act seals, the sealer enqueues a fresh summon to the same
          being. The next moment folds the world AFTER this act and
          decides again.
        </p>

        <p>
          The loop ends naturally when the model has nothing left to
          do and emits a see. Silence is the exit.
        </p>

        <p>
          Most beings default to <code>selfContinue: false</code> and
          rely on something external to wake them again. One summon,
          one moment, done until the next summon.
        </p>

        <h3>Half and inward (not yet wired)</h3>

        <p>
          A being can request that its next moment NOT be forward, by
          self-summoning with an explicit orientation:
        </p>

        <ul className="ns-list">
          <li>
            <strong>Half.</strong> Fold reads the world AND structured
            recall of the being's own prior acts. Recall is causal,
            not chronological . past acts stitched to entities
            currently changing in the face. A being considering its
            trajectory turns half.
          </li>
          <li>
            <strong>Inward.</strong> Fold reads only the being's own
            act-chain. The world drops away. Pure reflection. A being
            asking "who have I been" turns inward.
          </li>
        </ul>

        <p className="ns-small">
          Neither is wired yet. A misrouted half/inward summon is
          accepted, logged, and downgraded to forward so it cannot
          silently inject past before the recall primitives land. The
          orientation parameter is present on every moment so when
          half and inward come online they slot in cleanly.
        </p>

        <h3>The complete role spec</h3>

        <p>
          Everything above is one thing in author code. An LLM role
          file's complete declaration is its four <code>can*</code>{" "}
          lists plus optional see resolvers, the orientation, the
          continuation flag, and the prompt body. Everything else .
          permissions, respond mode, the wrapped <code>summon</code>{" "}
          dispatcher, the system-prompt assembler . is derived by the
          registry at registration. Authors write what the role IS;
          the seed fills in everything derivable.
        </p>

        <pre className="ns-code">{`// Every LLM role's complete spec is its four can* lists
// + optional see resolvers.
{
  name: "...",
  canSee:    [...],            // optional, populates the see tool
  canDo:     [...],            // optional, populates the do tool
  canSummon: [...],            // optional, populates the summon tool
  canBe:     [...],            // optional, populates the be tool
  see: ["name"],               // optional, structured resolver outputs in prompt
  selfContinue: bool,          // optional, one-act vs many-acts-via-many-moments
  defaultOrientation: "...",   // optional, forward by default
  prompt(ctx) { ... },         // role-intent only; no verb syntax explanation
}`}</pre>

        <ul className="ns-list">
          <li>
            <strong><code>name</code>.</strong> Kebab-case identifier.
            A SUMMON's <code>activeRole</code> resolves through it.
          </li>
          <li>
            <strong>The four <code>can*</code> lists.</strong> Address /
            action / target / operation entries. Non-empty list → the
            matching verb's tool is exposed and the matching permission
            is added. Empty / absent → the verb is not on this role's
            surface.
          </li>
          <li>
            <strong><code>see</code>.</strong> Names of registered
            see-resolvers. The assembler runs each one every moment
            and pre-renders the structured result under <code>[name]</code>{" "}
            in the system prompt. NOT a tool the LLM calls . it's the
            being's eyes for the moment, baked into the face.
          </li>
          <li>
            <strong><code>selfContinue</code>.</strong>{" "}
            <code>true</code> means: after this act seals, the sealer
            enqueues a fresh summon to the same being so the next
            moment runs. Default <code>false</code>: one summon, one
            moment, done until something external wakes it again.
          </li>
          <li>
            <strong><code>defaultOrientation</code>.</strong>{" "}
            <code>"forward"</code> (default), <code>"half"</code>, or
            <code> "inward"</code>. Controls what the fold reads.
            Half and inward are accepted-and-downgraded today; the
            slot is reserved for when the recall primitives land.
          </li>
          <li>
            <strong><code>prompt(ctx)</code>.</strong> Returns the
            role-intent text. Describes WHO the role is and WHAT it
            does. Does NOT explain verb syntax . that is auto-assembled
            from the <code>can*</code> lists by the seed.
          </li>
        </ul>

        <p>What the seed derives (so authors don't write it):</p>

        <ul className="ns-list">
          <li>
            <code>permissions</code> from <code>can*</code> (and{" "}
            <code>see</code> when there are preloaded resolvers).
          </li>
          <li>
            <code>respondMode</code> defaults to <code>"async"</code>.
          </li>
          <li>
            <code>triggerOn</code> defaults to <code>["message"]</code>.
            Override for scheduled or hook-fired roles.
          </li>
          <li>
            <code>summon(message, ctx)</code> auto-wraps to{" "}
            <code>defaultSummon</code>, which runs the LLM moment.
            Scripted roles attach their own and skip the LLM apparatus
            entirely.
          </li>
          <li>
            The system prompt: identity, preloaded <code>see</code>{" "}
            resolvers, capabilities rendered from <code>can*</code>,
            the role's <code>prompt(ctx)</code> body, the current
            time. Built fresh every moment.
          </li>
        </ul>

        <aside className="ns-doc-aside">
          <p>
            <strong>The role is a static declaration.</strong> No
            state, no per-being override, no runtime mutation. The
            persona that varies per being lives in that being's
            qualities, read inside <code>prompt(ctx)</code>. The role
            template is one; the personas are many.
          </p>
        </aside>
      </section>

      <section>
        <h2>An LLM being is not an MCP client</h2>

        <p>
          MCP (the Model Context Protocol) is a wire format for
          letting a model reach a server full of tools. It is one
          shape of bridge between a model and a toolbox.
        </p>

        <p>
          An LLM being is not that. An LLM being is a participant in
          the world:
        </p>

        <ul className="ns-list">
          <li>It has a name and a home space.</li>
          <li>It has a reel of its own facts.</li>
          <li>It has an inbox where summons arrive.</li>
          <li>It has a position in the tree that changes what it sees.</li>
          <li>Other beings can summon it by address.</li>
          <li>It can summon them back.</li>
        </ul>

        <p>
          Its acts join the chain of facts the rest of the world
          reads from. Structurally, it is the same kind of thing as a
          scripted being or a human being. The only difference is how
          its cognition happens.
        </p>

        <p className="ns-small">
          The tools the LLM reaches for inside its moment come from
          the factory's tool registry and dispatch through the same
          four verbs (SEE / DO / SUMMON / BE) every other being uses.
          The model never sees the verbs directly; the tools wrap
          them. MCP can be added as a transport at the edge for
          outside model runtimes, but the being inside the world is
          unchanged either way.
        </p>
      </section>

      <section className="ns-doc-aside">
        <h2>Where this lives in the seed</h2>
        <ul className="ns-list">
          <li>
            One-moment LLM cognition:{" "}
            <code>seed/present/cognition/llm/llmMoment.js</code>
          </li>
          <li>
            Role registry & dispatcher:{" "}
            <code>seed/present/roles/</code> +{" "}
            <code>seed/present/cognition/defaultSummon.js</code>
          </li>
          <li>
            Discriminated result (act / see / failure):{" "}
            <code>seed/present/cognition/cognitionResult.js</code>
          </li>
          <li>
            The four seed verb-tools:{" "}
            <code>seed/present/cognition/llm/seedSeeTool.js</code>,{" "}
            <code>seedDoTool.js</code>,{" "}
            <code>seedSummonTool.js</code>,{" "}
            <code>seedBeTool.js</code>
          </li>
          <li>
            The relationship resolver layer:{" "}
            <code>seed/present/cognition/llm/canStarResolver.js</code>
          </li>
          <li>
            Fold doctrine (forward / half / inward):{" "}
            <code>philosophy/MODEL.md</code>,{" "}
            <code>philosophy/INNER-FOLD.md</code>
          </li>
        </ul>
        <p>
          <Link to="/factory/momentum" className="ns-inline-link">
            Beat 4 (momentum)
          </Link>{" "}
          is the beat where this all happens inside one moment.
        </p>
      </section>

      <nav className="ns-doc-aside">
        <p>
          Next.{" "}
          <Link to="/factory/intake" className="ns-inline-link">
            1. Intake
          </Link>
          . A summon arrives in the being's inbox and the cycle
          begins.
        </p>
      </nav>
    </article>
  );
};

export default FactoryBeingTypes;
