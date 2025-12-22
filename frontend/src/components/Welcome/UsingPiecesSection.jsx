import SectionNav from "./SectionNav";
const UsingAllThePiecesSection = () => {
    return (
        <>
            <h1>The Three Core Pieces</h1>

            <p>
                There are currently three ways to access and work with your trees. Each
                serves a different purpose, and they are designed to work together.
            </p>

            <h2>1. Legacy tree app</h2>

            <p>
                The legacy tree app is the original interactive interface, hosted at{" "}
                <strong>tree.tabors.site/legacy</strong> once you are logged in.
            </p>

            <p>
                This is where full creation and editing functionality exists today.
                Actions such as building structure, editing nodes, managing schedules,
                and working with versions are most complete here.
            </p>

            <p>
                If something can’t yet be done elsewhere, it can always be done in the
                legacy app.
            </p>

            <h2>2. URL browser mode</h2>

            <p>
                URL browser mode is a newer way to explore your tree using simple,
                URL-based navigation and basic HTML.
            </p>

            <p>
                Instead of a complex UI, everything is broken into pages that can be
                navigated like... a tree.
            </p>

            <h3>Important things to know</h3>

            <ul>
                <li>
                    To access URL Browser mode, click the button URL Browser on the top left of this page. It will only appear when logged in.
                    Alternatively, look in the main menu of the legacy Tree App.
                    If a root is selected, it will open a new tab to that tree on URL mode.
                    If no root is selected, it will open to your user profile.
                </li>
                <li>
                    You must set an <strong>URL browser mode token</strong> before using
                    it. This token appears in the URL as <code>?token=</code> and acts as
                    a password for read-only access.
                </li>
                <li>
                    To set your URL browser token, go to the main menu inside of the legacy Tree app.
                    URL Browser mode WILL NOT WORK on new accounts until this is changed from 'null'.
                </li>
                <li>
                    You can change this token at any time to invalidate old links.
                </li>
                <h4>Full Parameter Details</h4>
                <ul>
                    <li>
                        <code>?token=YOURSHARETOKEN</code> — required for authenticated URL Browser read access.
                    </li>
                    <li>
                        <code>?html</code> — enables HTML viewing mode.
                    </li>

                    <li>
                        <code>&limit=NUMBER</code> — limits the number of returned items by most recent.
                    </li>
                    <li>
                        <code> &q="SEARCH"</code> allows searching for text within user notes.
                    </li>
                    <li>
                        <code>&active=true/false</code>, <code>&completed=true/false</code>,{" "}
                        <code>&trimmed=true/false</code> — filters what nodes are included.
                    </li>
                    <li>
                        Removing <code>?html</code> returns raw JSON instead of HTML.
                    </li>
                    <li>
                        The legacy app automatically appends <code>?token</code> and <code>?html</code>
                        when opening URL Browser pages from the app.
                    </li>
                    <li>
                        By default, active and completed are always shown unless implictly changed.
                    </li>

                </ul>

                <li>
                    The only URL's that dont require a token are /nodeid/version/note/noteid.
                    This is intentional so that you can share individual notes without exposing your whole tree.
                </li>


                <li>
                    Anyone with your share token can read upward through your tree, all the
                    way to your user profile, and see all of your root nodes. Be mindful of
                    what you share.
                </li>

                <li>
                    URL browser mode is also useful for discovering user IDs and node IDs.
                    It is still being built out, so some actions may still require the
                    legacy app.
                </li>

                <li>
                    Some endpoints accept submitted data as a POST request.
                    This allows the tree to act as an API for transferring data from other systems,
                    and unifying it into one.
                </li>
            </ul >

            <p>
                Overall, URL browser mode is currently the best way to read, navigate,
                and inspect data cleanly.
            </p>

            <p>
                Full Example URL: tree.tabors.site/api/nodeId/version/notes?token=YOURTOKEN&html&limit=5
            </p>

            <h2>3. ChatGPT connector</h2>

            <p>
                The third way to work with your tree is through the ChatGPT connector.
            </p>

            <p>
                This allows you to manage your tree using natural language while taking
                advantage of everything large language models are good at: planning,
                summarization, guidance, automation, and context-aware reasoning.
            </p>

            <p>
                Once connected, you simply call the entry tool and talk normally (see What to do next
                or How AI fits in for more detail). The system handles tool usage, context selection, and updates on the
                backend.
            </p>

            <p>
                This is the most flexible way to work with the tree and is where the
                system begins to feel less like software and more like an extension of
                your thinking.
            </p>
            <SectionNav currentId="pieces" />

        </>
    );
};

export default UsingAllThePiecesSection;
