const User = require("../db/models/user");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";

const register = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required" });
    }

    // Check if username (case-insensitive) is already taken
    const existingUser = await User.findOne({
      username: { $regex: `^${username}$`, $options: "i" },
    });
    if (existingUser) {
      return res.status(400).json({ message: "Username already taken" });
    }

    // Save username with original casing
    const newUser = new User({ username, password });

    await newUser.save();
    res.status(201).json({ message: "User registered successfully" });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ message: "Username and password are required" });
    }

    // Find user case-insensitively
    const user = await User.findOne({
      username: { $regex: `^${username}$`, $options: "i" },
    });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.cookie("token", token, {
      httpOnly: false,
      secure: false,
      sameSite: "None",
      maxAge: 604800000, // 7 days in milliseconds
    });

    res
      .status(200)
      .json({ message: "Login successful", token, userId: user.id });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Server is down" });
  }
};

module.exports = { register, login };
