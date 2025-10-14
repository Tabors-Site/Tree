const mongoose = require("mongoose");
require("dotenv").config();
const mongooseUri = process.env.MONGODB_URI;

mongoose
  .connect(mongooseUri, {})
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

module.exports = mongoose;
