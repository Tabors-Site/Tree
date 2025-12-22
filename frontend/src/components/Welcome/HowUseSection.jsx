import SectionNav from "./SectionNav";
const HowToUseSection = () => {
    return (
        <>
            <h1>How to Use It</h1>

            <p>
                Trees and nodes can be created manually, generated with AI, or built
                through a combination of both.
            </p>

            <p>
                Too much manual data input can be slow and limits how much structure you can
                explore. Too much AI can create plans that look impressive but are not
                grounded in your real goals or data.
            </p>

            <p>
                The system works best when you set direction and context, and AI builds
                from what already exists. You stay in control while AI helps expand,
                organize, and maintain the structure.
            </p>

            <h2>Create a root</h2>

            <p>
                Everything begins with a root node. This is the central idea the entire
                tree grows from.
            </p>

            <p>Examples of root nodes:</p>

            <ul>
                <li>Workout</li>
                <li>Personal diary</li>
                <li>Fiction book idea</li>
                <li>Photo album</li>
                <li>Make 20000 in one month</li>
                <li>English noun dictionary</li>
                <li>Crypto market watcher</li>
                <li>Your life</li>
            </ul>

            <p>
                The root defines direction. Everything added to the tree exists to
                support or explore that idea.
            </p>

            <h2>Build with nodes</h2>

            <p>
                From the root, you add nodes to shape the tree. Each node represents a single
                idea, decision, question, or piece of work. Nodes act as subsections that break
                a larger idea into manageable parts.
            </p>

            <p>
                You can think of nodes as a natural hierarchy, similar to chapters in a book,
                folders on a computer, or branches in a family tree. For example, a book moves
                from title to chapters, then to sections, paragraphs, sentences, and words.
            </p>


            <p>
                Nodes are always created as a child to a parent node(the root node is the origin). Each new node
                grows from another node, adding detail while keeping everything connected to
                its original context thus supported.
            </p>

            <p>
                You can keep the tree shallow and store more inside each node, or let it grow
                deeper by breaking ideas into smaller steps across many nodes. Both approaches
                work and can be mixed freely.
            </p>

            <p>
                Some people think in broader strokes, while others prefer every detail written
                out. The system is designed to support both without forcing a single way of
                working.
            </p>


            <h2>Versions and change over time</h2>

            <p>
                Every node starts at version zero. Versions allow a node to evolve
                without losing what came before.
            </p>

            <p>Each version can include:</p>

            <ul>
                <li>Notes or files</li>
                <li>Values and goals stored as numbers</li>
                <li>A schedule</li>
                <li>Recorded contributions or actions</li>
                <li>Scripts for automation or custom behavior</li>
            </ul>

            <p>
                Versions make change visible. Instead of overwriting work, you can see
                progress, adjustments, and outcomes over time.
            </p>

            <h2>Completing and repeating work</h2>

            <p>
                If a node represents something that is done once, you can mark it as
                complete.
            </p>

            <p>
                If a node represents a repeating activity such as a habit, routine, or
                ongoing process, you can prestige it.
            </p>

            <p>
                Prestiging creates a new version of the node while keeping previous
                versions intact. This allows repetition without losing history.
            </p>

            <p>
                The re effect time controls when the next version becomes active. For a
                daily task, this would typically be twenty four hours.
            </p>

            <h2>Trimming and revising structure</h2>

            <p>
                If a branch stops being useful, you can trim it.
            </p>

            <p>
                Trimming removes a branch from active consideration without deleting its
                data. Trimmed branches are ignored by AI but can be restored at any time.
            </p>

            <p>
                This makes it easy to revise structure while preserving history and
                context.
            </p>

            <h2>How structure usually evolves</h2>

            <p>
                As a tree grows, the root and main branches tend to hold the high level
                structure. Their role is to organize and reveal what matters.
            </p>

            <p>
                The outer nodes usually become the most actionable. These hold the
                concrete steps, decisions, and outputs.
            </p>

            <p>
                The goal of structure is not complexity. It is clarity. The tree exists
                to make the work visible and reachable.
            </p>



            <h1>Be Mode</h1>

            <p>
                The real value of the system appears when you enter <strong>Be mode</strong>.
            </p>

            <p>
                In Be mode, you stop managing the tree and start moving through it. You
                interact in natural language with ChatGPT, focusing only on what needs attention right
                now.
            </p>

            <p>
                The AI moves through your tree from leaf to leaf, using your plans, progress,
                and existing data to guide you forward and handle the details along the way.
            </p>

            <p>
                The structure stays in the background, supporting the work while you focus on
                what matters most and move toward your root goal.
            </p>
            <SectionNav currentId="workflow" />

        </>
    );
};

export default HowToUseSection;
