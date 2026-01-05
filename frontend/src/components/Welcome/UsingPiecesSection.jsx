import SectionNav from "./SectionNav";

const UsingAllThePiecesSection = () => {
    return (
        <>
            <h1>Interaction Methods</h1>

            <p>
                There are currently two ways to access and work with your trees. Each
                serves a different purpose, and they are designed to work together.
            </p>

            <h2>1. App mode</h2>

            <p>
                App mode is a way to explore your tree using simple, URL-based
                navigation and basic HTML.
            </p>

            <p>
                Instead of a complex UI, everything is broken into pages that can be
                navigated like... a tree.
            </p>

            <h3>Important things to know</h3>

            <ul>


                <li>
                    You must set a <strong>share token</strong> before
                    accessing. This token appears in the URL as <code>?token=</code>{" "}
                    and acts as a password for read-only access.
                </li>

                <li>
                    App mode will not work for shared access until this token is
                    set. You can change the token at any time to invalidate old links.
                </li>

                <h4>Full Parameter Details</h4>

                <ul>
                    <li>
                        <code>?token=YOURSHARETOKEN</code> — required for unauthenticated
                        read-only access.
                    </li>
                    <li>
                        <code>?html</code> — enables HTML viewing mode.
                    </li>
                    <li>
                        <code>&limit=NUMBER</code> — limits the number of returned items by
                        most recent.
                    </li>
                    <li>
                        <code>&q="SEARCH"</code> — allows searching for text within user
                        notes.
                    </li>
                    <li>
                        <code>&active=true/false</code>,{" "}
                        <code>&completed=true/false</code>,{" "}
                        <code>&trimmed=true/false</code> — filters nodes by status.
                    </li>
                    <li>
                        <code>&startDate=YYYY-MM-DD</code>
                    </li>
                    <li>
                        <code>&endDate=YYYY-MM-DD</code>
                    </li>
                    <li>
                        Dates are interpreted in <strong>UTC</strong>, so they may be slightly
                        off depending on timezone.
                    </li>
                    <li>
                        Removing <code>?html</code> returns raw JSON instead of HTML.
                    </li>
                    <li>
                        By default, active and completed are always shown unless explicitly
                        changed.
                    </li>
                </ul>

                <li>
                    The only URLs that don’t require a token are{" "}
                    <code>/nodeId/version/note/noteId</code>. This allows sharing individual
                    notes without exposing your entire tree.
                </li>

                <li>
                    Anyone with your share token can read upward through your tree, all the
                    way to your user profile, and see all of your root nodes. Be mindful of
                    what you share.
                </li>

                <li>
                    App mode is also useful for discovering user IDs and node IDs.
                </li>

                <li>
                    Some endpoints accept submitted data as a POST request. This allows the
                    tree to act as an API for transferring data from other systems and
                    unifying it into one.
                </li>
            </ul>

            <p>
                Overall, App mode is currently the best way to read, navigate,
                and inspect data cleanly.
            </p>

            <p>
                Full example URL:
                <br />
                <code>
                    tree.tabors.site/api/nodeId/version/notes?token=YOURTOKEN&html&limit=5
                </code>
            </p>

            <h2>2. ChatGPT connector</h2>

            <p>
                The second way to work with your tree is through the ChatGPT connector.
            </p>

            <p>
                This allows you to manage your tree using natural language while taking
                advantage of everything large language models are good at: planning,
                summarization, guidance, automation, and context-aware reasoning.
            </p>

            <p>
                The ChatGPT connector uses OAuth for authentication. You connect by
                logging in through the platform, which securely authorizes ChatGPT to
                access your tree without sharing credentials.
            </p>

            <h3>Watch: Connecting with OAuth</h3>

            <div style={{ margin: "24px 0", aspectRatio: "16 / 9" }}>
                <iframe
                    width="100%"
                    height="100%"
                    src="https://www.youtube.com/embed/28khvCzTMdY"
                    title="ChatGPT OAuth connection walkthrough"
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                />
            </div>

            <p>
                Once connected, you simply call the entry tool and talk normally (see
                “Getting Started” or “How AI fits in” for more detail). The system handles
                tool usage, context selection, and updates on the backend.
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
