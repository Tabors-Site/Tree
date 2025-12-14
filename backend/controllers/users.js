import User from "../db/models/user.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
const JWT_SECRET = process.env.JWT_SECRET || "your_secret_key";
const USER_REGISTRATION_KEY = process.env.USER_REGISTRATION_KEY;

const register = async (req, res) => {
  try {
    const { username, password, registrationKey } = req.body;

    if (!username || !password || !registrationKey) {
      return res.status(400).json({
        message: "Username, password and registration key are required",
      });
    }

    if (registrationKey !== USER_REGISTRATION_KEY) {
      return res.status(400).json({ message: "Registration key is invalid" });
    }

    // Check if username (case-insensitive) is already taken
    const existingUser = await User.findOne({
      username: { $regex: `^${username}$`, $options: "i" },
    });
    if (existingUser) {
      return res.status(400).json({ message: "Username already taken" });
    }

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

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    res.cookie("token", token, {
      httpOnly: false,
      secure: true, // true if HTTPS
      sameSite: "None", // required for cross-site cookies in modern browsers
      domain: ".tabors.site", // note leading dot to allow all subdomains
      maxAge: 604800000,
    });

    res
      .status(200)
      .json({ message: "Login successful", token, userId: user.id });
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({ message: "Server is down" });
  }
};

const getHtmlShareToken = async (req, res, next) => {
  try {
    const userId = req.userId;

    const user = await User.findById(userId)
      .select("htmlShareToken")
      .lean()
      .exec();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    req.HTMLShareToken = user.htmlShareToken ?? null;

    next();
  } catch (err) {
    console.error("[getHtmlShareToken]", err);
    res.status(500).json({ message: "Failed to fetch HTML share token" });
  }
};

const URL_SAFE_REGEX = /^[A-Za-z0-9\-_.~]+$/;

const setHtmlShareToken = async (req, res) => {
  try {
    const userId = req.userId;
    let { htmlShareToken } = req.body;

    if (!userId) {
      return res.status(401).json({
        message: "Not authenticated",
      });
    }

    if (typeof htmlShareToken !== "string") {
      return res.status(400).json({
        message: "htmlShareToken must be a string",
      });
    }

    htmlShareToken = htmlShareToken.trim();

    if (htmlShareToken.length > 128 || htmlShareToken.length < 1) {
      return res.status(400).json({
        message: "htmlShareToken must be 1–128 characters",
      });
    }

    if (!URL_SAFE_REGEX.test(htmlShareToken) && htmlShareToken.length > 0) {
      return res.status(400).json({
        message:
          "htmlShareToken may only contain URL-safe characters (A–Z a–z 0–9 - _ . ~)",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    user.htmlShareToken = htmlShareToken;
    await user.save();

    return res.json({
      htmlShareToken: user.htmlShareToken,
    });
  } catch (err) {
    console.error("[setHtmlShareToken]", err);
    res.status(500).json({
      message: "Failed to set html share token",
    });
  }
};

export { register, login, getHtmlShareToken, setHtmlShareToken };
