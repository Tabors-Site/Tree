import React, { useState, useEffect, useRef } from "react";
import Cookies from "js-cookie";

const formatDate = (dateString) => {
  const date = new Date(dateString);

  // Format the date as 'MM/DD/YYYY @ hh:mm a'
  return date
    .toLocaleString("en-US", {
      month: "2-digit",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true, // 12-hour clock (AM/PM)
    })
    .replace(",", " @"); // Replace the comma with an @ symbol
};

const Notes = ({ nodeSelected, userId, nodeVersion }) => {
  const [notes, setNotes] = useState([]);
  const [noteContent, setNoteContent] = useState("");
  const [isReflection, setIsReflection] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const notesEndRef = useRef(null);
  const apiUrl = import.meta.env.VITE_API_URL;

  const token = Cookies.get("token");

  // Function to fetch notes
  const fetchNotes = async () => {
    if (!nodeSelected) return;
    setNotes([]);
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/get-notes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nodeId: nodeSelected._id,
          version: nodeVersion,
        }),
        credentials: "include",
      });

      const result = await response.json();
      if (response.ok) {
        setNotes(result.notes || []);
      } else {
        setMessage(result.message || "Error retrieving the notes.");
      }
    } catch (error) {
      console.error("Error fetching notes:", error);
      setMessage("An error occurred while fetching the notes.");
    } finally {
      setLoading(false);
    }
  };

  // Fetch notes when the component mounts or when nodeSelected or nodeVersion changes
  useEffect(() => {
    fetchNotes();
  }, [nodeSelected, nodeVersion, token]);

  // Scroll to the bottom of the notes box when notes update
  useEffect(() => {
    notesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [notes]);

  // Function to render note content (either text or file)
  const renderNoteContent = (note) => {
    if (note.contentType === "text") {
      return <div>{note.content}</div>; // Changed to div to avoid nested <p>
    } else if (note.contentType === "file") {
      // Check if it's an image or video based on the file type
      const videoExtensions = ["mp4", "mov", "avi"]; // Add other video types if needed
      const imageExtensions = ["jpg", "jpeg", "png", "gif"]; // Add other image types if needed

      const fileType = note.content.split(".").pop().toLowerCase();

      if (imageExtensions.includes(fileType)) {
        // Render image for supported image formats
        return (
          <img
            src={`${apiUrl}/uploads/${note.content}`}
            alt="Note"
            style={{ maxWidth: "300px", display: "block", marginTop: "10px" }}
          />
        );
      } else if (videoExtensions.includes(fileType)) {
        // Render video for supported video formats
        return (
          <video
            controls
            style={{ maxWidth: "300px", display: "block", marginTop: "10px" }}
          >
            <source
              src={`${apiUrl}/uploads/${note.content}`}
              type={`video/${fileType}`}
            />
            Your browser does not support the video tag.
          </video>
        );
      }
      return null; // Return null if file type is not recognized
    }
    return null;
  };

  const handleTextSubmit = async (e) => {
    e.preventDefault();

    if (!nodeSelected) {
      setMessage("No Node Selected.");
      return;
    }

    if (!noteContent.trim()) {
      setMessage("Please write a note before submitting.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/create-Note`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          content: noteContent,
          contentType: "text",
          userId,
          nodeId: nodeSelected._id,
          version: nodeVersion,
          isReflection,
        }),
        credentials: "include",
      });

      const result = await response.json();
      if (response.ok) {
        setMessage(result.message);
        setNoteContent("");
        setIsReflection(false);
        fetchNotes(); // Refetch notes after successful submission
      } else {
        setMessage(result.message || "Error creating the note.");
      }
    } catch (error) {
      console.error("Error:", error);
      setMessage("An error occurred while creating the note.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this note? This action cannot be undone."
    );

    if (!confirmDelete) {
      return; // If the user cancels, do nothing
    }
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/delete-note`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          noteId: noteId,
        }),
        credentials: "include",
      });

      const result = await response.json();
      if (response.ok) {
        setMessage(result.message);
        fetchNotes(); // Refetch notes after successful deletion
      } else {
        setMessage(result.message || "Error deleting the note.");
      }
    } catch (error) {
      console.error("Error:", error);
      setMessage("An error occurred while deleting the note.");
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    if (!nodeSelected) {
      setMessage("No Node Selected.");
      return;
    }

    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("contentType", "file");
    formData.append("userId", userId);
    formData.append("nodeId", nodeSelected._id);
    formData.append("version", nodeVersion);
    formData.append("isReflection", isReflection);

    try {
      const response = await fetch(`${apiUrl}/create-Note`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
        credentials: "include",
      });

      const result = await response.json();
      if (response.ok) {
        setMessage(result.message);
        fetchNotes(); // Refetch notes after successful upload
      } else {
        setMessage(result.message || "Error uploading the file.");
      }
    } catch (error) {
      //console.error("Error:", error); shows if no notes
      setMessage("An error occurred while uploading the file.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h3>Notes and Reflections</h3>

      {/* Display Notes */}
      <div
        style={{
          maxHeight: "400px",
          overflowY: "scroll",
          border: "1px solid #ccc",
          marginTop: "20px",
          textAlign: "left",

          marginBottom: "5px",
        }}
      >
        {loading ? (
          <p>Loading notes...</p>
        ) : (
          <div>
            {notes.length > 0
              ? notes.map((note) => (
                  <div
                    key={note._id}
                    style={{
                      marginBottom: "11px",
                      border: "1px solid black",
                      backgroundColor: "white",
                    }}
                  >
                    <div>
                      <strong>
                        {note.username}
                        {note.isReflection && <span> (Reflection)</span>}:
                      </strong>
                      {formatDate(note.createdAt)}
                      {/* X Button to Delete the Note */}
                      <button
                        onClick={() => handleDeleteNote(note._id)}
                        style={{
                          float: "right",
                          backgroundColor: "red",
                          color: "white",
                          border: "none",
                          borderRadius: "50%",
                          padding: "5px 10px",
                          cursor: "pointer",
                          opacity: "0.6",
                        }}
                      >
                        X
                      </button>
                    </div>
                    <div
                      style={{
                        backgroundColor: note.isReflection
                          ? "#98FB98"
                          : "white",
                        padding: "10px",
                        borderRadius: "5px",
                      }}
                    >
                      {renderNoteContent(note)}
                    </div>
                  </div>
                ))
              : null}
            <div ref={notesEndRef} />
          </div>
        )}
      </div>

      {!nodeSelected ? (
        <p>No Node Selected.</p>
      ) : (
        <>
          {/* Text Input for Notes */}
          <form onSubmit={handleTextSubmit}>
            <div>
              <textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Write your note here..."
                rows={5}
                style={{ width: "100%" }}
              />
            </div>

            {/* Reflection Checkbox */}
            <div>
              <label>
                <input
                  type="checkbox"
                  checked={isReflection}
                  onChange={(e) => setIsReflection(e.target.checked)}
                />
                Is this a reflection?
              </label>
            </div>

            {/* Submit Button for Text */}
            <button type="submit" disabled={loading}>
              {loading ? "Submitting..." : "Submit"}
            </button>
          </form>

          {/* File Upload */}
          <div>
            <input
              type="file"
              accept="image/*,video/*"
              onChange={handleFileUpload}
              disabled={loading}
            />
          </div>

          {/* Status Message */}
          {message && <p>{message}</p>}
        </>
      )}
    </div>
  );
};

export default Notes;
