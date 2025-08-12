import React, { useState } from 'react';
import Cookies from 'js-cookie';

const TrimNodeForm = ({ nodeSelected, nodeVersion, onComplete }) => {
  const [showMenu, setShowMenu] = useState(true); // To control the visibility of the menu
  const [confirmation, setConfirmation] = useState(null); // Store user confirmation (Yes/No)
  const apiUrl = import.meta.env.VITE_API_URL;
  // Handle the action on menu confirmation
  const handleConfirmation = async (confirm) => {
    setConfirmation(confirm); // Store user confirmation (Yes/No)

    if (confirm) {
      const token = Cookies.get('token');
      if (!token) {
        console.error('No JWT token found!');
        return;
      }

      try {
        const response = await fetch(`${apiUrl}/edit-status`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
      
          body: JSON.stringify({
            nodeId: nodeSelected._id, // Pass the selected node's ID
            status: "trimmed", // Trim the status before sending
            version: nodeVersion,
            isInherited: true,
          }),
        });
      
        const data = await response.json();
        if (!response.ok) {
          console.error('Error trimming node:', data);
          throw new Error('Failed to trim node');
        }

        setShowMenu(false); // Hide the menu after confirmation
        onComplete();
      } catch (error) {
        console.error('Error trimming node:', error.message);
      }
    }
  };

  return (
    <div>
      {showMenu && (
        <div>
          <h2>Trim Node and All Its Children?</h2>
          <button onClick={() => handleConfirmation(true)}>Yes</button>
          <button onClick={() => handleConfirmation(false)}>No</button>
        </div>
      )}

     
    </div>
  );
};

export default TrimNodeForm;
