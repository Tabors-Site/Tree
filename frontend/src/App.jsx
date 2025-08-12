import React, { useState, useEffect } from "react";
import Cookies from "js-cookie";
import Login from "./components/Login.jsx";
import Tree from "./Tree.jsx";
import "./App.css";

const App = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [userId, setUserId] = useState("");

  useEffect(() => {
    const storedUsername = Cookies.get("username");
    const storedUserId = Cookies.get("userId");
    const loggedIn = Cookies.get("loggedIn");

    if (loggedIn) {
      setIsLoggedIn(true);
      setUsername(storedUsername || "");
      setUserId(storedUserId || "");
    }
  }, []);

  return (
    <div className="app-container">
      {!isLoggedIn ? (
        <Login
          setIsLoggedIn={setIsLoggedIn}
          setUsername={setUsername}
          setUserId={setUserId}
        />
      ) : (
        <Tree
          username={username}
          userId={userId}
          setIsLoggedIn={setIsLoggedIn}
          setUsername={setUsername}
          setUserId={setUserId}
        />
      )}
    </div>
  );
};

export default App;
