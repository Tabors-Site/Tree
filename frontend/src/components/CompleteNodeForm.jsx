import React, { useState } from 'react';
import Cookies from 'js-cookie';

const CompleteNodeForm = ({ nodeSelected, nodeVersion, onComplete }) => {
  const [showMenu, setShowMenu] = useState(true); // To control the visibility of the menu
  const [status, setStatus] = useState(null); // Store the selected status
  const [loading, setLoading] = useState(false); // Indicate request in progress
  const [isInherited, setIsInherited] = useState(true); // State for checkbox (defaults to true)
  const apiUrl = import.meta.env.VITE_API_URL;
  // Handle the action when a status is chosen
  const handleStatusChange = async (selectedStatus) => {
    setStatus(selectedStatus); // Store the selected status
    setLoading(true); // Start loading while the request is sent

    const token = Cookies.get('token');
    if (!token) {
      console.error('No JWT token found!');
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`${apiUrl}/edit-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nodeId: nodeSelected._id, // Pass the selected node's ID
          status: selectedStatus, // Pass the selected status
          version: nodeVersion,
          isInherited: isInherited, // Include isInherited in the request
        }),
        credentials: 'include',
      });

      const data = await response.json();
      if (!response.ok) {
        console.error('Error updating status:', data);
        throw new Error('Failed to update status');
      }

      setShowMenu(false); // Hide the menu after confirmation

      onComplete();
    } catch (error) {
      console.error('Error updating node status:', error.message);
    } finally {
      setLoading(false); // Stop loading after the request completes
    }
  };

  // Handle checkbox change
  const handleCheckboxChange = (event) => {
    setIsInherited(event.target.checked); // Update state based on checkbox
  };

  return (
    <div>
      {showMenu && (
        <div>
          <h2>Set Node Status</h2>
          <button onClick={() => handleStatusChange('completed')}>Complete</button>
          <button onClick={() => handleStatusChange('active')}>Active</button>
          
          <div>
            <label>
              Apply to all children:
              <input
                type="checkbox"
                checked={isInherited}
                onChange={handleCheckboxChange}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompleteNodeForm;
