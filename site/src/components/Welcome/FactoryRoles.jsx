import { Link } from "react-router-dom";
import "./IbpPage.css";

/**
 * FactoryRoles. The roles page in the Factory section.
 *
 * Core framing: roles are the IDE for building in reality. Extensions
 * ship the parts (new matter types, space types, world signals, role
 * definitions). Operators mix and match in role-manager — assembling
 * extension parts into per-being behavior, declaring world conditions
 * that activate them.
 *
 * Visual rhythm matches FactoryBeingTypes.jsx — code blocks for shape,
 * ns-doc-aside for one-line rules, short paragraphs, lots of
 * subheadings.
 */
const FactoryRoles = () => {
  return (
    <article className="ns-doc">
      <header className="ns-doc-header">
        <p className="ns-doc-eyebrow">Roles</p>
        <h1 className="ns-doc-title">
          Roles are the IDE for building in reality
        </h1>
        <p className="ns-doc-lede">
          Extensions ship the parts — new matter types, new space types,
          world signals, role definitions. Roles are where you mix and
          match those parts to make a being do what you want, when you
          want, in the conditions you want. The role-manager is the
          editor.
        </p>
      </header>

      {/* ───────────────────────────────────────────────────────── */}
      <section>
        <h2>The pieces, and where they come from</h2>

        <p>
          A reality has two kinds of inhabitants. <strong>Extensions</strong>{" "}
          define what's <em>possible</em>. <strong>Operators</strong>{" "}
          decide what actually <em>happens</em>.
        </p>

        <ul className="ns-list">
          <li>
            <strong>Extensions ship:</strong> new matter types
            (food-log, fitness-set, document), new space types
            (court, library, dojo), world signals (
            <code>harmony.tick.alive</code>,{" "}
            <code>weather.condition</code>), DO operations (
            <code>operate-lathe</code>,{" "}
            <code>publish-post</code>), and reusable role definitions
            (<code>emotions:bored</code>, <code>judge</code>,{" "}
            <code>greeter</code>).
          </li>
          <li>
            <strong>Operators assemble:</strong> they pick which role
            their being wears at any moment, in any condition. They
            stack a "bored" role on a worker when the worker has been
            idle for a minute. They flip a being to "judge" only when
            it's in the court space and the court is in session. They
            do this in the role-manager panel; no code edits.
          </li>
        </ul>

        <aside className="ns-doc-aside">
          <p>
            <strong>If extensions are a standard library, roles are
            the IDE.</strong> Extensions ship the building blocks.
            Roles are how operators wire them together into something
            that runs.
          </p>
        </aside>
      </section>

      {/* ───────────────────────────────────────────────────────── */}
      <section>
        <h2>A single role, in one breath</h2>

        <p>
          A role is six fields. Four describe a capability surface;
          one is a system prompt; one is the name.
        </p>

        <pre className="ns-code">{`{
  name:      "factory-worker",

  canSee:    ["station", "conveyor", "qa-dashboard"],
  canDo:     ["operate-lathe", "attach-trucks", "log-defect"],
  canSummon: ["supervisor"],
  canBe:     [],

  prompt: () => "You're a worker at SkateCo's main factory. The line moves at...",
}`}</pre>

        <p>The four <code>can*</code> lists ARE the body.</p>

        <ul className="ns-list">
          <li>
            <code>canSee</code> — addresses this role can read.
          </li>
          <li>
            <code>canDo</code> — DO actions this role can invoke. Each
            entry is a registered operation, usually shipped by an
            extension.
          </li>
          <li>
            <code>canSummon</code> — beings this role can speak to.
          </li>
          <li>
            <code>canBe</code> — identity operations (birth, connect,
            release, switch, death). Most roles leave this empty;
            global ships <code>release</code> so every being can log
            out and <code>switch</code> so every being can change
            their branch frame.
          </li>
        </ul>

        <p>
          The system prompt describes intent. Who this role IS. Author
          writes the intent; the seed assembles the actual LLM prompt
          by rendering identity + resolved capabilities + this body +
          the current time, fresh every moment.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>Permissions are additive, never subtractive.</strong>{" "}
            A role can only add capabilities. Constraint comes from the
            prompt body (in language), not from substrate deny rules.
            This is what makes roles compose cleanly when stacked.
          </p>
        </aside>
      </section>

      {/* ───────────────────────────────────────────────────────── */}
      <section>
        <h2>The three kinds of cognition</h2>

        <p>
          A role doesn't carry cognition. Cognition lives on the
          being. Three closed values; the substrate runs the same role
          primitive against all three.
        </p>

        <ol className="ns-flow">
          <li className="ns-flow-step">
            <span className="ns-flow-num">1</span>
            <div>
              <h3>LLM</h3>
              <p>
                The being's moment runs through a language model. The
                seed builds the prompt, hands it the wake's content as
                the user message, and the model emits one tool call,
                prose, both, or neither.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">2</span>
            <div>
              <h3>Human</h3>
              <p>
                The being's moment lands in a person's inbox. They
                read it through a portal and act through the same four
                verbs. Latency is minutes, not milliseconds; the
                substrate does not care.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">3</span>
            <div>
              <h3>Scripted</h3>
              <p>
                Cognition is a function. The being is summoned, the
                function reads the fold, the function decides what to
                do. No model, no prompt, no inference.
              </p>
            </div>
          </li>
        </ol>

        <aside className="ns-doc-aside">
          <p>
            <strong>Roles are cognition-agnostic.</strong> A
            "factory-worker" role is a factory-worker whether an LLM
            or a human is doing the thinking. The role's{" "}
            <code>can*</code> describes the job; the cognition
            describes who's filling the seat. Switch the cognition on
            a being and the same role keeps working.
          </p>
        </aside>

        <p className="ns-small">
          A few roles semantically require a specific cognition (a
          "human-conversationalist" only makes sense when a human is
          driving). Those declare <code>requiredCognition: "human"</code>{" "}
          and the substrate drops them from the stack when the being's
          cognition doesn't match.
        </p>
      </section>

      {/* ───────────────────────────────────────────────────────── */}
      <section>
        <h2>One being, many roles — the stack and the flow</h2>

        <p>
          A being doesn't wear one role at a time. It wears a stack,
          and the stack is recomputed at every moment from the world's
          current state.
        </p>

        <p>
          The being carries a <strong>roleFlow</strong>: an ordered
          list of clauses. Each clause says <em>"when this world
          condition is true, use this role."</em>
        </p>

        <pre className="ns-code">{`qualities.roleFlow = [
  // Primary clauses — first match wins.
  { when: { verb: "summon", "caller.role": "human" },
    role: "human-conversationalist" },

  { when: { "space.name": "court", "world.court.in-session": true },
    role: "judge" },

  { role: "court-watcher" },   // terminal default

  // Stacked clauses — all matching ones append on top.
  { stack: true, when: { "time.sinceLastMoment": { gte: 60 } },
    role: "emotions:bored" },

  { stack: true, when: { "world.court.recent-disturbance": true },
    role: "emotions:alert" },
];`}</pre>

        <p>The walk produces:</p>

        <ul className="ns-list">
          <li>
            <strong>A primary role.</strong> The first non-stacked
            clause whose <code>when</code> matches. If none match, the
            being's <code>defaultRole</code> takes over as the floor.
          </li>
          <li>
            <strong>A modifier stack.</strong> Every <code>stack:
            true</code> clause whose <code>when</code> matches gets
            added.
          </li>
        </ul>

        <p>
          The seed composes the stack into one effective role: the
          four <code>can*</code> lists union, the system prompts
          concatenate with named framing ("Additionally, you are
          currently in this mode — emotions:bored: …"). The LLM reads
          a layered prompt; the substrate runs the moment against the
          composed surface.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>The stack is fixed for the moment.</strong> If the
            world changes mid-moment, that affects the <em>next</em>{" "}
            moment, not this one. One moment, one frame.
          </p>
        </aside>
      </section>

      {/* ───────────────────────────────────────────────────────── */}
      <section>
        <h2>The when system, in simple terms</h2>

        <p>
          A <code>when</code> reads the moment's open-context. You
          write it like a small condition object — keys are paths into
          what the being knows about this moment, values are what
          you're checking for.
        </p>

        <h3>The most common things to check</h3>

        <ul className="ns-list">
          <li>
            <code>verb</code> — what kind of wake this is. One of
            "see" | "do" | "summon" | "be".
          </li>
          <li>
            <code>caller.role</code> — the role of whoever's summoning
            me.
          </li>
          <li>
            <code>caller.cognition</code> — is the asker a human, an
            LLM, or a script.
          </li>
          <li>
            <code>space.name</code> — the name of the space I'm in
            right now.
          </li>
          <li>
            <code>inHomeSpace</code> — am I at home? (true / false)
          </li>
          <li>
            <code>time.hour</code> — hour of day, 0–23.
          </li>
          <li>
            <code>time.dayOfWeek</code> — 0 = Sunday, 6 = Saturday.
          </li>
          <li>
            <code>time.sinceLastMoment</code> — seconds since my last
            sealed moment.
          </li>
          <li>
            <code>me.previousRole</code> — the role I wore in my
            previous moment.
          </li>
          <li>
            <code>world.&lt;ns&gt;.&lt;key&gt;</code> — a signal
            someone published on the reality root.
          </li>
          <li>
            <code>space.quality.&lt;ns&gt;.&lt;k&gt;</code> — a
            quality on the space I'm in.
          </li>
          <li>
            <code>me.quality.&lt;ns&gt;.&lt;k&gt;</code> — a quality
            on my own being.
          </li>
        </ul>

        <h3>The operators</h3>

        <p>
          Bare values mean equals. Operator objects let you check
          ranges and membership.
        </p>

        <pre className="ns-code">{`{ verb: "summon" }                   // verb equals "summon"
{ "time.hour": { gte: 9, lt: 17 } }  // between 9am and 5pm
{ "space.name": { in: ["court", "library"] } }   // one of these
{ "world.factory.broken": { present: true } }    // signal exists
{ not: { inHomeSpace: true } }       // I'm NOT at home
{ or: [ { verb: "do" }, { verb: "be" } ] }       // either verb`}</pre>

        <h3>Three simple examples</h3>

        <p><strong>"When a human pings me, switch to a friendly voice."</strong></p>

        <pre className="ns-code">{`{ when: { "caller.cognition": "human" },
  role: "friendly" }`}</pre>

        <p><strong>"When I've been idle for a minute, get bored."</strong></p>

        <pre className="ns-code">{`{ stack: true,
  when: { "time.sinceLastMoment": { gte: 60 } },
  role: "emotions:bored" }`}</pre>

        <p><strong>"When the drum is alive, dance."</strong></p>

        <pre className="ns-code">{`{ when: { "world.harmony.tick.alive": true },
  role: "dancer" }`}</pre>

        <aside className="ns-doc-aside">
          <p>
            <strong>Top-level keys in a <code>when</code> are AND.</strong>{" "}
            <code>{`{ verb: "summon", "caller.role": "human" }`}</code>{" "}
            reads as "verb is summon AND the caller's role is human."
            You almost never write <code>and:</code> by hand.
          </p>
        </aside>

        <h3>Determinism is the contract</h3>

        <p>
          The when language is a pure function. Same world, same role
          flow, same result — every time. No random, no clock leak, no
          out-of-band reads. This is what makes the chain replay-able:
          walk a being's reel from genesis and you reconstruct every
          moment's role stack byte-identical to live.
        </p>
      </section>

      {/* ───────────────────────────────────────────────────────── */}
      <section>
        <h2>Birth a being, then inhabit it to configure it</h2>

        <p>
          Roles aren't only for AI. Any operator can mint a child
          being, inhabit it to drive its first moments, and use that
          access to wire it up.
        </p>

        <ol className="ns-flow">
          <li className="ns-flow-step">
            <span className="ns-flow-num">1</span>
            <div>
              <h3>Birth</h3>
              <p>
                Click @birther at the reality root. Fill in a name and
                pick a cognition. Optionally paste a starting roleFlow.
                The child is minted with you as its parent on the
                being-tree.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">2</span>
            <div>
              <h3>Inhabit</h3>
              <p>
                Click the new being and choose "Inhabit (new tab)." A
                second portal tab opens. You're now driving the child.
                The substrate authenticates you via lineage — you can
                inhabit any descendant you parented.
              </p>
              <p className="ns-small">
                Your effective cognition on the child becomes "human"
                for the duration. Close the parent tab and the
                inheriter releases.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">3</span>
            <div>
              <h3>Configure from inside</h3>
              <p>
                Walk the child to @role-manager and act through it —
                author a role, publish a world signal, edit the child's
                own roleFlow. You're doing the work as the child,
                because you ARE it for the duration.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">4</span>
            <div>
              <h3>Release</h3>
              <p>
                Close the inheriter tab. The connection-tracking
                reducer clears the inhabit projection. The child
                reverts to its declared cognition and starts running
                its own moments.
              </p>
            </div>
          </li>
        </ol>

        <aside className="ns-doc-aside">
          <p>
            <strong>This is how a tree of beings gets built.</strong>{" "}
            An operator births a child, inhabits it, uses that child
            to birth grandchildren, configures them, releases. One
            human can be in many places at once across many tabs,
            each driving a different being. The being-tree is the
            structure; inhabit is how a human reaches inside it.
          </p>
        </aside>
      </section>

      {/* ───────────────────────────────────────────────────────── */}
      <section>
        <h2>Permissions are earned by exploring</h2>

        <p>
          A being doesn't arrive with all their permissions handed to
          them. They arrive with a floor — the <code>global</code>{" "}
          role, which every authenticated being carries — and grow
          their reach by encountering spaces, petitioning roles, and
          accumulating grants. The floor is on purpose minimal: see
          where you are, move yourself, ask for more.
        </p>

        <p>
          The two verbs that grow you live on the floor itself, so
          every being has the tools to climb without anyone giving
          them special access first.
        </p>

        <pre className="ns-code">{`// seed/present/roles/global/role.js
canDo: [
  { action: "move",               description: "move yourself in space" },
  { action: "set-being:position", description: "walk to another space" },
  { action: "ask-role",           description: "petition for a role from its host" },
  { action: "take-role",          description: "self-grant a role that admits it" },
]`}</pre>

        <h3>Three ways a role admits a newcomer</h3>

        <p>
          The role itself declares how it's acquired. The operator
          who authored the role decides the gate, not the visitor.
        </p>

        <ul className="ns-list">
          <li>
            <strong>Auto on entry.</strong>{" "}
            <code>acquisition.autoOnEntry: true</code> — the role
            grants silently on the visitor's first SEE inside its
            reach. This is the <code>@public</code> visitor pattern.
            Walking in IS the petition.
          </li>
          <li>
            <strong>Grabbable.</strong>{" "}
            <code>acquisition.grabbed: true</code> — anyone may{" "}
            <code>take-role</code> on it without asking. Useful for
            "anyone who shows up can wear this hat" roles (factory
            worker, library reader, dance-floor dancer).
          </li>
          <li>
            <strong>Asked.</strong> Neither flag set — the visitor
            runs <code>ask-role</code>; a being whose own role
            licenses <code>grant-role:&lt;X&gt;</code> decides
            whether to grant. This is the only path that requires
            another being's consent.
          </li>
        </ul>

        <h3>Foreign beings climb the same ladder</h3>

        <p>
          A foreign being — one arriving from another reality.branch
          through a portal, through canopy dispatch, or through the
          mate-vessel path — is not architecturally distinct from a
          local newcomer. Both walk in with their home identity
          intact. Both carry their home grants. Both encounter the
          same role-acquisition surface here and earn their way up
          through the same verbs.
        </p>

        <p>
          Each grant they earn lands in <em>this</em> reality.branch's
          projection of their being row, in{" "}
          <code>qualities.rolesGranted</code>. Their home reality
          doesn't know or care; their home identity is unchanged.
          They've become a local citizen by doing local things, while
          remaining sovereign in their origin world.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>The only structural privilege a local being holds
            is what the operator put in <code>global</code>.</strong>{" "}
            Past that floor, locals and foreigners are on the same
            ladder. Federation citizenship isn't a separate concept
            in the substrate — it's just a sufficiently-progressed
            visit. The substrate distinguishes "what grants you've
            accumulated here," not "where you came from."
          </p>
        </aside>

        <h3>Growth compounds</h3>

        <p>
          Once a being holds a role, that role's <code>canDo</code>{" "}
          may itself include <code>grant-role:&lt;X&gt;</code> for
          further roles, or unlock spaces whose own roles are then
          petitionable. Early grants are the rungs to later grants.
          The operator authors the climb by deciding which roles are
          auto-on-entry, which are grabbable, which are gated, and
          which can grant which others.
        </p>

        <p>
          The substrate provides the verbs; the reality's role graph
          defines the shape of progression. A being grows by doing,
          and doing makes more doing possible.
        </p>
      </section>

      {/* ───────────────────────────────────────────────────────── */}
      <section>
        <h2>The world is the codebase</h2>

        <p>
          A normal orchestration system gets complex by accreting
          code: <code>if</code>/<code>else</code> branches, fragile
          chains of calls, hand-tuned prompts per use case, tool
          registries injected per agent. Every new requirement is a
          new conditional, a new wrapper, a new template. Complexity
          grows in the code; code grows in the orchestrator.
        </p>

        <p>
          TreeOS pushes it the other way. Behavior gets complex by
          changing the <em>world</em>, not the code.
        </p>

        <ul className="ns-list">
          <li>
            Instead of hard-coding "the worker behaves differently at
            night," you write a roleFlow that reads{" "}
            <code>time.hour</code> and stacks <code>tired</code> after
            5pm.
          </li>
          <li>
            Instead of injecting a tool registry into a new agent, you
            write a role with the <code>can*</code> lists you want and
            register it once.
          </li>
          <li>
            Instead of message-passing between agents to coordinate,
            you publish a world signal and let every being whose flow
            reads it react.
          </li>
          <li>
            Instead of conditionals deciding which prompt to use, you
            stack roles whose <code>when</code> clauses match the
            current conditions.
          </li>
        </ul>

        <h3>Orchestration falls out of the structure</h3>

        <p>
          Each being's job is small: role declares what it can touch,
          prompt declares what it's for, roleFlow declares when.
          There's no top-level orchestrator deciding who acts. Beings
          wake when summoned or when a signal they read changes; their
          stack composes automatically; the moment runs.
        </p>

        <p>
          A "library" space stacks <code>library-voice</code> on every
          being inside it (their roleFlows read{" "}
          <code>space.quality.ambient.tone</code>). Walk in, beings
          speak quietly. Walk out, they speak normally. The library
          configures behavior of beings that don't know about
          libraries specifically.
        </p>

        <pre className="ns-code">{`// The library space's qualities:
space.quality.ambient.tone = "quiet"

// Every being's roleFlow:
{ stack: true,
  when: { "space.quality.ambient.tone": "quiet" },
  role: "library-voice" }`}</pre>

        <p>
          This pattern scales. A "battle" space stacks{" "}
          <code>combat-ready</code>. An "office" stacks{" "}
          <code>professional</code>. Each space programs the beings
          inside it without those beings knowing about the space's
          purpose.
        </p>

        <aside className="ns-doc-aside">
          <p>
            <strong>Roles + world signals + spaces with qualities form
            a small language for programming beings.</strong> Stacking
            gives combinatorial expressiveness from a small library of
            role definitions. World signals enable coordination
            without message-passing. Spaces with qualities program
            their inhabitants. Every existing being's behavior changes
            when the world changes — no code edit, no redeploy.
          </p>
        </aside>

        <h3>The chain is the program; replay is the debugger</h3>

        <p>
          Because the evaluator is pure and every input comes from
          stored substrate (the being's row, the inbox entry, the
          stored time, the previous Act, the world's qualities at
          moment-open), you can replay a being's history and
          reconstruct every role stack it ever wore. The chain isn't
          just an audit log. It's the program text. Running it forward
          is the program executing; running it again from genesis is
          the debugger.
        </p>
      </section>

      {/* ───────────────────────────────────────────────────────── */}
      <section className="ns-doc-aside">
        <h2>Where this lives in the seed</h2>
        <ul className="ns-list">
          <li>
            Role registry: <code>seed/present/roles/registry.js</code>
          </li>
          <li>
            RoleFlow evaluator: <code>seed/present/roles/roleFlow.js</code>
          </li>
          <li>
            Stack composer: <code>seed/present/roles/roleComposer.js</code>
          </li>
          <li>
            Live role authoring + world signals:{" "}
            <code>seed/present/roles/role-manager/ops.js</code>
          </li>
          <li>
            Where the stack lands on the moment:{" "}
            <code>seed/present/beats/1-assign.js</code>
          </li>
          <li>
            Modifier roles (the emotions extension):{" "}
            <code>extensions/emotions/</code>
          </li>
          <li>
            The full doctrine + build plan:{" "}
            <code>seed/role-manager.md</code>
          </li>
        </ul>
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

export default FactoryRoles;
