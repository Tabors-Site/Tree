import React, { useState } from 'react';
import Cookies from "js-cookie";
import AiCreate from './AiCreate'; // Import AiCreate component

const CreateNodeForm = ({ nodeSelected, onComplete }) => {
  const [name, setName] = useState('');
  const [schedule, setSchedule] = useState('');
  const [reeffectTime, setReeffectTime] = useState('');
  const [useAI, setUseAI] = useState(false); // Toggle between manual and AI creation
  const apiUrl = import.meta.env.VITE_API_URL;

  // Handle form submission for manual creation
  const handleSubmit = async (e) => {
    e.preventDefault();

    const token = Cookies.get("token");
    if (!token) {
      console.error('No JWT token found!');
      return;
    }

    // Split the name field into an array of names, trim white spaces, and filter out empty names
    const names = name
      .split(',')
      .map(n => n.trim())
      .filter(n => n.length > 0); // Remove empty strings

    try {
      for (const singleName of names) {
        const response = await fetch(`${apiUrl}/add-node`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            parentId: nodeSelected._id,
            name: singleName, // Use each name individually
            schedule,
            reeffectTime,
            isRoot: false,
          }),
          credentials: 'include',
        });

        const data = await response.json();
        if (!response.ok) {
          console.error('Error creating node:', data);
          throw new Error('Failed to create node');
        }
      }

      // Reset state after all nodes are created
      setName('');
      setSchedule('');
      setReeffectTime('');
      onComplete();
    } catch (error) {
      console.error('Error creating node:', error.message);
    }
  };

  // Automatically adjust the height of the textarea
  const handleInput = (e) => {
    e.target.style.height = 'auto'; // Reset the height
    e.target.style.height = `${e.target.scrollHeight}px`; // Set it to the scrollHeight
  };

  return (
    <div>
      <h1>Create Node</h1>

      {/* Switch between Manual and AI */}
      <div>
        <label>
          <input
            type="checkbox"
            checked={useAI}
            onChange={(e) => setUseAI(e.target.checked)}
          />
          Use AI Assistance
        </label>
      </div>

      {/* Manual Node Creation Form */}
      {!useAI ? (
        <form onSubmit={handleSubmit}>
          <div>
            <label>Node Name:</label>
            <textarea
              value={name}
              onChange={(e) => setName(e.target.value)}
              onInput={handleInput}
              rows={1}
              style={{ resize: 'none' }}
              required
            />
            
          </div>
          <small>Separate names by commas to create multiple nodes simultaneously.</small>
          <div>
            <label>Schedule:</label>
            <input
              type="datetime-local"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
            />
          </div>

          <div>
            <label>Reeffect Time:</label>
            <input
              type="number"
              value={reeffectTime}
              onChange={(e) => setReeffectTime(e.target.value)}
            />
          </div>

          <button type="submit">Start Creation</button>
        </form>
      ) : (
        /* AI-Assisted Node Creation */
        <AiCreate nodeSelected={nodeSelected}/>
      )}
    </div>
  );
};

export default CreateNodeForm;
