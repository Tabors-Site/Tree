import React, { useState } from "react";
import Cookies from "js-cookie"; // Import js-cookie
import "./Login.css";

const Login = ({ setIsLoggedIn, setUsername, setUserId, userId }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsernameInput] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const apiUrl = import.meta.env.VITE_API_URL;

  // Handle login logic
  const handleLogin = async () => {
    try {
      const response = await fetch(`${apiUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });

      const data = await response.json();
      if (response.ok) {
        // Store JWT token in a cookie
        console.log(data);
        Cookies.set("token", data.token, { expires: 7, secure: false });

        // Store additional user data in cookies if necessary
        Cookies.set("username", username, { expires: 7, secure: false });
        Cookies.set("userId", data.userId, { expires: 7, secure: false });
        Cookies.set("loggedIn", true, { expires: 7, secure: false });

        // Update state in parent component
        setUsername(username);
        setUserId(data.userId);
        setIsLoggedIn(true);
      } else {
        setMessage(data.message || "Login failed.");
      }
    } catch (error) {
      console.error("Error during login:", error);
      setMessage("An error occurred. Please try again.");
    }
  };

  // Handle register logic
  const handleRegister = async () => {
    try {
      const response = await fetch(`${apiUrl}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        credentials: "include",
      });

      const data = await response.json();
      if (response.ok) {
        setMessage("Registration successful! You can now log in.");
        setIsRegistering(false);
      } else {
        setMessage(data.message || "Registration failed.");
      }
    } catch (error) {
      console.error("Error during registration:", error);
      setMessage("An error occurred. Please try again.");
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isRegistering) {
      handleRegister();
    } else {
      handleLogin();
    }
  };

  return (
    <div className="login-container">
      <div className="logo-container">
        <img src="../../tree.png" alt="Logo" className="logo" />
      </div>
      <h2>{isRegistering ? "Register" : "Login"}</h2>
      <form onSubmit={handleSubmit}>
        <div>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsernameInput(e.target.value)}
          />
        </div>
        <div>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit">{isRegistering ? "Register" : "Login"}</button>
      </form>
      <p>{message}</p>
      <p>
        {isRegistering
          ? "Already have an account?"
          : "Don't have an account yet?"}
        <button onClick={() => setIsRegistering(!isRegistering)}>
          {isRegistering ? "Login" : "Register"}
        </button>
      </p>
    </div>
  );
};

export default Login;
