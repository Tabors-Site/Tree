const HowToUseSection = () => {
    return (
        <>
            <h1>How to Use It</h1>

            <p>
                Trees and nodes can be created and maintained manually, generated and
                maintained by AI, or — most effectively — a mix of both.
            </p>

            <p>
                Too much manual input wastes time and underuses AI’s ability to generate
                structure and surface ideas. Too much AI, on the other hand, produces
                inflated plans that aren’t grounded in your real data or intentions.
            </p>

            <p>
                The system works best when AI builds from what already exists.
                You provide the direction and reality; AI helps expand, refine, and
                maintain the structure.
            </p>

            <h2>Create a root node</h2>

            <p>
                Everything starts by creating a root node. The name you give it is the
                idea the entire tree grows out of.
            </p>

            <p>Examples of root nodes:</p>

            <ul>
                <li>Workout</li>
                <li>Personal diary</li>
                <li>Fiction book idea</li>
                <li>Photo album</li>
                <li>Make $20,000 in one month</li>
                <li>English Noun Dictionary</li>
                <li>Crypto Market Watcher/Trader</li>
                <li>*your name*'s Life</li>
            </ul>

            <p>
                The root node defines the direction of the tree. All structure that grows
                exists to serve that idea.
            </p>

            <h2>Build structure with nodes</h2>

            <p>
                From the root, you create new nodes as needed to build out structure.
                Every new node should expand or branch from something that already
                exists.
            </p>

            <p>
                You can create shallow structures with fewer nodes and keep most of the
                information inside a single node, or you can build deeper branching to
                break things into smaller steps.
            </p>


            <h2>Versions and evolution</h2>

            <p>
                Every node starts at version 0. Versions allow a node to evolve over
                time instead of being overwritten.
            </p>

            <p>
                Each version can contain:
            </p>

            <ul>
                <li>Notes (text or files)</li>
                <li>Values and goals (numeric data)</li>
                <li>A schedule</li>
                <li>Contributions (actions that have already happened)</li>
                <li>Scripts (for automation, REST API interaction, and custom node functionality)</li>
            </ul>

            <p>
                Without versions, a node couldn’t track change or improvement. Versions
                are what make progress visible.
            </p>

            <h2>Completing and prestiging nodes</h2>

            <p>
                If a node represents something that is done once and finished, you can complete it.
            </p>

            <p>
                If a node represents a repeating activity — such as a weekly workout,
                habit, or recurring process — you can prestige it.
            </p>

            <p>
                Prestiging creates a new version of the node, allowing you to repeat the
                task while keeping previous versions intact for comparison.
            </p>

            <p>
                The re-effect time determines when the new schedule begins. For example,
                a daily task would typically use a re-effect time of 24 hours.
            </p>

            <h2>Trimming and revising structure</h2>

            <p>
                If a branch of the tree stops serving you, you can trim it.
            </p>

            <p>
                Trimming removes the branch from active consideration without deleting
                its data. Trimmed branches are ignored by AI, but can be reactivated at
                any time.
            </p>

            <p>
                This allows you to revise structure without losing history or context.
            </p>

            <h2>How structure usually evolves</h2>

            <p>
                As a tree grows, the root, trunk, and main branches usually form the
                high-level structure. These exist primarily to organize and expose what
                matters.
            </p>

            <p>
                The leaves — the outer nodes — tend to hold the details and actionable
                steps. The goal of structure is not complexity, but clarity.
            </p>

            <p>
                The tree exists to make the fruit visible and reachable.
            </p>
        </>
    );
};

export default HowToUseSection;
