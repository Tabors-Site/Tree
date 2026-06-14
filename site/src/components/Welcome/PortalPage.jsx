import { Link } from "react-router-dom";
import SiteHeader from "./SiteHeader.jsx";
import SiteFooter from "./SiteFooter.jsx";
import "./IbpPage.css";
import "./PortalPage.css";

/**
 * PortalPage. Introductory page about the Portal . the renderer that
 * turns a reality into something you can see, walk, and act on.
 *
 * Order. What the portal is, then the things it surfaces (spaces,
 * coords, matter, beings, render blocks, sensory channels), then the
 * things you can do in it (seeds, the move tool, the IBP console, the
 * action menu), then the doctrine point: every interaction in the
 * portal is one of the four verbs.
 *
 * Source-of-truth files (kept accurate at copy-edit time):
 *   /reality/portal/3d-app/src/scene.js               3D renderer
 *   /reality/portal/3d-app/src/factDispatcher.js      sensory dispatch
 *   /reality/portal/3d-app/src/actionRenderer.js      action menu / form
 *   /reality/portal/flat-app/                         2D renderer
 *   /reality/seed/ibp/descriptor.js                   wire shape SEE returns
 *   /reality/resources/assets.md                     sensory pipeline doctrine
 */
const PortalPage = () => {
  return (
    <div className="ns-page ns-portal">
      <SiteHeader />

      <article className="ns-doc">
        <header className="ns-doc-header">
          <p className="ns-doc-eyebrow">Client</p>
          <h1 className="ns-doc-title">Portal</h1>
          <p className="ns-doc-lede">
            The browser for a reality. 3D when you want a world,
            2D when you want a page, raw data when you want the wire.
            Same protocol underneath. Same chain underneath.
          </p>
        </header>

        <section>
          <h2>What the portal is</h2>

          <figure className="ns-figure">
            <img
              src="/portal.png"
              alt="Inside the 3D portal. A walkable grid space with characters, props, and a sky horizon. The view a person sees when they step into a TreeOS reality."
            />
            <figcaption>
              Inside the 3D portal . the walkable view of one space in a
              running reality.
            </figcaption>
          </figure>

          <p>
            A reality is a substrate. It holds the facts, the beings, the
            spaces, the matter, the chain that makes the world replayable.
            But the substrate doesn't draw anything . it's pure storage and
            protocol. The portal is what reads the substrate and renders it.
          </p>
          <p>
            Three portals ship today and they're siblings, not generations.
            The 3D portal turns spaces into walkable scenes with characters
            and props. The 2D flat portal turns the same descriptor into
            inspector-shaped HTML . panels, lists, action buttons. The IBP
            console gives you raw access to the four verbs and the wire
            shapes they return. Pick the one that fits what you're doing in
            this moment. They all speak the same protocol, so a fact you
            stamp from one shows up in the others as soon as they refetch.
          </p>
          <p>
            Think of it as a browser. The reality is the site; the portal
            is Chrome. The substrate doesn't care which portal is rendering
            it; the portal doesn't care which reality it's pointed at. The
            only contract between them is IBP.
          </p>
        </section>

        <section>
          <h2>What the portal renders</h2>

          <h3>Spaces</h3>
          <p>
            A space is a position in the tree . a place beings stand and
            things happen. The 3D portal renders the current space as a
            grid you walk on. Every space can declare a{" "}
            <code>size</code> (its bounding box) and every space has a{" "}
            <code>coord</code> (where it sits in its parent). With size
            set, you get a green walkable plane sized to the cells; without
            it the renderer falls back to the infinite outdoor scene.
          </p>
          <p>
            Child spaces of the current space appear as trees on the grid,
            placed at their coord inside the parent. Walking up to one and
            entering navigates into that space . suddenly you're inside
            and its children are now your trees.
          </p>

          <h3>Coords</h3>
          <p>
            The same idea threads through everything that has a position.
            A being walking is a <code>coord</code> on its current space's
            grid. A drum sitting on the dance floor is a <code>coord</code>{" "}
            on the dance floor's grid. A tree appearing as a child of the
            reality root is a <code>coord</code> on the root's grid. Same
            word, same clamp, same renderer math.
          </p>
          <p>
            Coords are 2D by default (<code>{`{x, y}`}</code>) with z
            available when a space cares about height. Writes are clamped
            against the containing space's size; out-of-bounds throws and
            the cognition refaces. Silent clamping was a lie the chain
            couldn't replay; throwing keeps the chain honest.
          </p>

          <h3>Beings</h3>
          <p>
            A being is an identity instance. Humans, AI agents, scripted
            cognition. The portal renders each being whose home is the
            current space, plus transient occupants (humans walking
            through). Each being's appearance comes from its render block
            (next section). Walking up to a being gives you an action menu;
            sending a message opens a chat thread.
          </p>

          <h3>Matter</h3>
          <p>
            Matter is stuff inside a space. A drum, a sign, a piece of
            artwork, a video screen. Each matter has its own coord on the
            space's grid and its own render block. The move tool lets you
            pick matter up and drop it elsewhere; the substrate records the
            move as one fact on the chain.
          </p>
        </section>

        <section>
          <h2>The render block</h2>
          <p>
            Every matter, space, and being can carry a{" "}
            <code>qualities.render</code> block that declares its sensory
            representation. This is the surface the portal reads to decide
            how to draw it, what sounds it plays, what animations fire.
          </p>
          <pre className="ns-code">
{`qualities.render = {
  model:      "harmony:drum",
  scale:      0.015,
  rotation:   { x: 0, y: 0, z: 0 },
  animations: { "harmony:tick": "bounce" },
  sounds:     { "harmony:tick": "harmony:drum-hit" },
}`}
          </pre>

          <h3>Models</h3>
          <p>
            Models are glTF (<code>.glb</code>) files . the standard 3D
            format for the web. Extensions ship their own models bundled
            in an <code>assets/models/</code> directory; the loader mounts
            them at <code>/assets/&lt;ext&gt;/...</code> on the reality's
            server. A render block references one as{" "}
            <code>"&lt;ext&gt;:&lt;name&gt;"</code> . the portal resolves
            that against the extension's manifest, fetches the file, parses
            it, and instances it at the entity's position.
          </p>
          <p>
            Models can carry skeletal animations . a Mixamo character with
            walk, idle, dance clips baked in. The portal wires a three.js
            AnimationMixer per loaded character so each clip can be played
            on demand.
          </p>

          <h3>Animations</h3>
          <p>
            Animation isn't something the portal decides . it's something
            the chain decides. The render block's <code>animations</code>{" "}
            map says "when a fact with this action lands on a reel I'm
            watching, play this clip." The drummer's tick fact stamps with
            action <code>harmony:tick</code>; every entity in the scene
            whose render block names <code>harmony:tick</code> in its
            animations reacts in parallel. The drum bounces, the drummer
            strikes, the dancers shuffle . one fact, one beat, every
            entity responds according to its own declaration.
          </p>
          <p>
            This is the doctrinal piece worth seeing clearly. The portal
            is a renderer of fact streams across multiple sensory channels.
            Animation is one channel. Sound is another. The chain says
            what happened; the portal renders the consequence in every
            modality the rendered thing declares.
          </p>

          <h3>Sounds</h3>
          <p>
            Sounds work identically to animations . an MP3 or OGG file
            shipped in the extension's <code>assets/sounds/</code>{" "}
            directory, referenced as <code>"&lt;ext&gt;:&lt;name&gt;"</code>,
            played by the portal through Web Audio when the named fact
            arrives. The first time the portal needs to play, it asks for
            a click ("tap to enable sound") . browser autoplay policy.
            After that the audio plays without interruption.
          </p>
        </section>

        <section>
          <h2>Seeds</h2>
          <p>
            A seed is a plantable scaffold . a recipe for a structure that
            an operator drops at a position to spawn it in one act. Plant
            the harmony seed at the reality root, and a dance floor space,
            a drum matter, a drummer being, and five dancer beings all
            appear at their starting positions, all wired with subscriptions
            and schedules, all under one moment on the chain.
          </p>
          <p>
            Seeds are how a resource pack becomes a real world. A pack
            bundles what its beings ARE (roles), what they can DO (code and
            ops), and what assets they ship (models, sounds). The seed describes
            how to assemble those into a working scene . one drum here,
            five dancers around it, one schedule waking the drummer every
            tick. The operator decides when to plant; the substrate stamps
            the facts; the portal renders the result.
          </p>
          <p>
            In the 3D portal, seeds show up in your hotbar . the bar at
            the bottom of the screen. Select a seed slot, click a position,
            and the scaffold unfolds. Every world built in TreeOS so far
            started as a seed.
          </p>
        </section>

        <section>
          <h2>What you can do above the seed</h2>
          <p>
            The portal isn't just a viewer . it's a workbench. The four
            verbs (<Link to="/ibp" className="ns-inline-link">SEE / DO / SUMMON / BE</Link>)
            are exposed through three interaction surfaces.
          </p>

          <h3>The action menu</h3>
          <p>
            Click a being and you get a menu of actions . one entry per
            BE op the role licenses, one entry per DO op declared on the
            being's <code>canDo</code>. Each entry knows its arg schema
            (text fields, password fields, checkboxes, dropdowns), so the
            portal renders the form generically . no hardcoded UI per
            being. The cherub's "Register" form, the llm-assigner's
            connection setup, your own extension's submit form . same
            renderer.
          </p>
          <p>
            This is the custom GUI doctrine: extensions don't ship HTML.
            They declare actions with arg schemas. The portal turns
            declarations into menus and forms. Add a new being, add a new
            action, and the portal renders it automatically the next time
            someone walks up.
          </p>

          <h3>The move tool</h3>
          <p>
            Slot one in the hotbar. Click a child space (a tree) or a
            matter to pick it up; click a cell on the floor to drop it
            there; click a different tree to put it inside as a child. Move
            stamps one <code>do:move</code> fact . the substrate records
            both halves (where it came from, where it went), and the chain
            replays perfectly.
          </p>

          <h3>The IBP console</h3>
          <p>
            Press the backtick key (<code>`</code>) anywhere in the portal
            to toggle a small developer console. Pick a verb, enter an
            address, paste a payload, fire. The same socket the portal
            uses for everything else . your calls show up on the chain
            indistinguishably from any other fact.
          </p>
          <p>
            This is the "view source" of TreeOS. When you want to know
            what a SEE actually returns, fire it from the console. When
            you want to wake a being from raw IBP, send a SUMMON. When
            you want to configure the reality (allowed LLM domains, default
            space size), fire a <code>set-config</code> through DO.
          </p>
        </section>

        <section>
          <h2>The "browser" metaphor, finished</h2>
          <p>
            Every interaction in the portal is one of the four verbs. Walk
            into a space . that's SEE. Click a being's "Log in" button .
            that's BE. Send a chat message . that's SUMMON. Pick something
            up and put it down . that's DO. The portal looks like a game
            UI but it's really a protocol surface. There's nothing it can
            do that you couldn't do from a terminal with the IBP console
            open.
          </p>
          <p>
            That symmetry is the point. The portal is a renderer of the
            chain across sensory channels . models, sounds, animations,
            menus, forms. The chain is the world; the portal is one of
            many possible views into it. A VR portal could speak the same
            protocol. A text-adventure portal could speak the same
            protocol. A screen reader for accessibility could speak the
            same protocol. The substrate stays one chain; the experience
            of that chain can be rendered in any modality.
          </p>
        </section>

        <section>
          <h2>Where to next</h2>
          <p>
            For the protocol underneath, read{" "}
            <Link to="/ibp" className="ns-inline-link">IBP</Link>. For the
            five-beat lifecycle every moment runs through . intake, assign,
            fold, momentum, stamped . read{" "}
            <Link to="/factory" className="ns-inline-link">Factory</Link>.
            When you're ready to run one,{" "}
            <Link to="/start" className="ns-inline-link">Get Started</Link>{" "}
            walks you through the two paths in.
          </p>
        </section>
      </article>

      <SiteFooter />
    </div>
  );
};

export default PortalPage;
