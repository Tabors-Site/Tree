import { useState } from "react";
import Cookies from "js-cookie";
import "./HTMLShareTokenEditor.css";

const apiUrl = import.meta.env.VITE_TREE_API_URL;

export default function HtmlShareTokenEditor({
    initialValue = "",
    onClose,
    onSaved,
}) {
    const authToken = Cookies.get("token");

    const [value, setValue] = useState(
        initialValue || Cookies.get("HTMLShareToken") || ""
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const save = async () => {
        try {
            setSaving(true);
            setError(null);

            const res = await fetch(`${apiUrl}/setHTMLShareToken`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${authToken}`,
                },
                body: JSON.stringify({ htmlShareToken: value }),
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.message || "Save failed");

            if (data.htmlShareToken) {
                Cookies.set("HTMLShareToken", data.htmlShareToken, {
                    expires: 7,
                    sameSite: "None",
                    secure: true,
                });
            } else {
                Cookies.remove("HTMLShareToken");
            }

            onSaved?.(data.htmlShareToken);
            onClose?.();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="html-token-overlay" onClick={onClose}>
            <div
                className="html-token-modal"
                onClick={(e) => e.stopPropagation()}
            >
                <h3>HTML Share Token</h3>

                <input
                    type="text"
                    placeholder="Enter HTML share token"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    style={{ width: "100%", padding: 8 }}
                />

                {error && (
                    <div style={{ color: "red", fontSize: 12, marginTop: 6 }}>
                        {error}
                    </div>
                )}

                <div className="html-token-actions">
                    <button onClick={save} disabled={saving}>
                        {saving ? "Saving…" : "Save"}
                    </button>
                    <button onClick={onClose}>Cancel</button>
                </div>
            </div>
        </div>
    );
}
