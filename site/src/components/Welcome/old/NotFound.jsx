const NotFound = () => {
    return (
        <><style>{`
            @keyframes heroGrow {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.06); }
            }
        `}</style>
        <div style={{
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif",
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: "20px",
            margin: 0,
        }}>
            <div style={{
                background: "rgba(255,255,255,0.12)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "20px",
                padding: "48px 40px",
                maxWidth: "480px",
                width: "100%",
                textAlign: "center",
                boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
            }}>
                <div style={{
                    display: "inline-block",
                    marginBottom: "12px",
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#dc2626",
                    letterSpacing: "1px",
                    background: "rgba(255,255,255,0.18)",
                    borderRadius: "10px",
                    padding: "6px 16px",
                }}>404</div>
                <a href="/" style={{ textDecoration: "none" }}>
                    <div style={{ fontSize: "48px", marginBottom: "8px", animation: "heroGrow 4.5s ease-in-out infinite" }}>🌳</div>
                    <div style={{
                        fontSize: "28px",
                        fontWeight: 700,
                        marginBottom: "20px",
                        color: "white",
                    }}>TreeOS</div>
                </a>
                <h1 style={{
                    fontSize: "22px",
                    fontWeight: 700,
                    marginBottom: "12px",
                    color: "white",
                }}>Page Not Found</h1>
                <p style={{
                    fontSize: "15px",
                    lineHeight: 1.6,
                    color: "rgba(255,255,255,0.75)",
                    marginBottom: "28px",
                }}>This page doesn't exist or may have been moved.</p>
                <a href="/" style={{
                    display: "inline-block",
                    padding: "12px 32px",
                    borderRadius: "980px",
                    background: "rgba(255,255,255,0.18)",
                    border: "1px solid rgba(255,255,255,0.25)",
                    color: "white",
                    fontSize: "14px",
                    fontWeight: 600,
                    textDecoration: "none",
                }}>Back to Home</a>
            </div>
        </div>
        </>
    );
};

export default NotFound;
