import "./AuthPages.css";

const MustLogin = () => {
    return (
        <div className="auth-container">
            <h2>You must be logged in to access this feature</h2>

            <p className="auth-subtext">
                This section requires an active tabors.site account.
            </p>

            <div className="auth-actions">
                <button
                    className="primary-btn"
                    onClick={() => (window.location.href = "https://tabors.site")}
                >
                    Go to tabors.site & Register
                </button>
                <button
                    className="primary-btn"
                    onClick={() => (window.location.href = "https://tree.tabors.site/login")}
                >
                    Login
                </button>

                <button
                    className="secondary-btn"
                    onClick={() => (window.location.href = "/")}
                >
                    Back
                </button>
            </div>
        </div>
    );
};

export default MustLogin;
