import React, { useEffect, useState } from "react";
import Cookies from "js-cookie";

const Invites = () => {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const apiUrl = import.meta.env.VITE_API_URL;
  const token = Cookies.get("token");

  // Fetch the pending invites from the server
  useEffect(() => {
    const fetchInvites = async () => {

      try {
        const response = await fetch(`${apiUrl}/pending-invites`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
        });

        const data = await response.json();

        if (response.ok) {
          setInvites(data.invites);
        } else {
          setError(data.message || "Failed to fetch invites.");
        }
      } catch (error) {
        setError("Error fetching invites");
      } finally {
        setLoading(false);
      }
    };

    fetchInvites();
  }, [token]);

  // Handle accepting or declining an invite
  const handleInviteResponse = async (inviteId, acceptInvite) => {
    try {
      const response = await fetch(`${apiUrl}/invite/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          inviteId,
          acceptInvite,
        }),
        credentials: 'include',
      });

      const data = await response.json();

      if (response.ok) {
        // Update the invites list after successful acceptance/decline
        setInvites((prevInvites) =>
          prevInvites.filter((invite) => invite._id !== inviteId)
        );
      } else {
        setError(data.message || "Failed to respond to invite.");
      }
    } catch (error) {
      setError("Error responding to invite");
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div>
      <h3>Your Pending Invites</h3>
      {invites.length === 0 ? (
        <p>No pending invites</p>
      ) : (
        <ul>
          {invites.map((invite) => (
            <li key={invite._id}>
              From: {invite.userInviting.username}, root: {invite.rootId.name}{" "}
              (Status: {invite.status})
              <div>
                <button onClick={() => handleInviteResponse(invite._id, true)}>
                  Accept
                </button>
                <button onClick={() => handleInviteResponse(invite._id, false)}>
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default Invites;
